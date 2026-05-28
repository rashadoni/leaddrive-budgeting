/**
 * Phase 7.G Turn CX (Phase 7.B v2 Day 4 — multi-sheet apply) —
 * `/staging/[id]/apply-multi` endpoint.
 *
 * Companion to `/analyze-multi` (CIX). Reads the saved `MultiSheetProposal`
 * from `ImportStaging.proposal`, runs `applyMultiSheetProposal()` on the
 * re-uploaded workbook, then performs a transactional flat-aggregate insert
 * of all sheets' `ParsedBudgetLine[]` rows into BudgetLine.
 *
 * **Why a separate route from /apply:** keeps the production single-sheet
 * path untouched (mirrors the analyze/analyze-multi split from CIX).
 * Multi-sheet adds proposal-shape detection + per-sheet error reporting +
 * cross-sheet aggregate write — easier as a dedicated handler.
 *
 * Auth: `manager` role + org-scoped (same as /apply).
 *
 * Per-sheet error isolation at apply time: if a sheet errors during
 * `applyProposal`, the failure is recorded BUT the transaction proceeds
 * with the OTHER sheets' lines. Rationale: caller shouldn't lose 4 good
 * sheets to 1 bad one. Caller can re-analyze the failed sheet via
 * `/analyze-multi?sheetNames=<bad>` and re-apply.
 *
 * **v1 simplifications (deferred to v1.1+):**
 *   - No dry-run support (single-sheet `/apply` has it; mirror in v1.1)
 *   - No cross-sheet line dedup — duplicate `code`s across sheets are
 *     written N times (last-write-wins in BudgetLine). Future: dedup
 *     by code with explicit conflict flag in response.
 *   - Single shared `targetYear` derived from the FIRST sheet's proposal.
 *     Multi-year multi-sheet rejected. (Same constraint as single-sheet.)
 *   - One BudgetPlan for the whole batch (matches single-sheet contract).
 *
 * Status transitions enforced (same as single-sheet):
 *   pending  → applied (happy path)
 *   pending  → expired (auto-flip if past expiresAt)
 *   applied  → 409
 *   discarded/expired → 410
 */

import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger for this
// 1000-LOC multi-sheet apply route. 8 console.* calls → logger calls
// with scoped child loggers per phase (root / kpi / bs / recompute).
const log = getLogger("api:apply-multi")
const kpiLog = getLogger("api:apply-multi:kpi")
const bsLog = getLogger("api:apply-multi:bs")
const recomputeLog = getLogger("api:apply-multi:recompute")
import {
  applyMultiSheetProposal,
  isMultiSheetProposal,
  detectProposalYear,
  type MultiSheetProposal,
} from "@/lib/onboarding/ai-mapper/applier"
import type { ParseResult, ParsedBudgetLine } from "@/lib/onboarding/adapters/azmade-sopl"
import { currentBakuYearNumber } from "@/lib/risk/periods"
import type { MappingProposal } from "@/lib/onboarding/ai-mapper/types"
// Phase 7.I Turn — Workbook-shape deterministic fallback. When AI Mapper
// produces a structurally-valid proposal but extraction returns 0 leaves
// (typical for multi-year sheets where AI Mapper picked the wrong year's
// columns), run the proven `parsePlfPlSheet` adapter as a deterministic
// retry using the requested targetYear as preferYear hint.
import {
  parsePlfPlSheet,
  type ParsedPlfLine,
} from "@/lib/onboarding/adapters/azseker-plf"
import {
  classifyWorkbookSheetFamily,
  resolveEntityFromSheetName,
} from "@/lib/onboarding/azseker-workbook-mapping"
// Phase 7.I Turn — KPI sheet dispatcher. Scans every workbook sheet
// (regardless of AI Mapper's filter) and writes OperationalFact rows
// from KPI families.
import {
  parseWorkbookFarmingKpiSheet,
  parseWorkbookProcessingKpiSheet,
  type ParsedKpiFact,
} from "@/lib/onboarding/adapters/azseker-workbook-kpi"
// Phase 7.I Turn — BS (balance sheet) dispatcher. Same scan-every-
// sheet pattern as KPI; writes BalanceSheetLine rows.
import { parseWorkbookBsSheet } from "@/lib/onboarding/adapters/azseker-workbook-bs"

export const maxDuration = 120 // larger than single-sheet — N parallel writes

const MAX_FILE_SIZE = 10 * 1024 * 1024
const RATE_LIMIT = { name: "onboarding-apply-multi", max: 5, windowMs: 60_000 }

interface PerSheetSuccess {
  sheetName: string
  inserted: number
  warnings: number
  parentRollupsDropped: number
  parentRollupsUnallocated: number
}

interface PerSheetFailure {
  sheetName: string
  error: string
}

type PerSheetResult = PerSheetSuccess | PerSheetFailure

function isFailure(r: PerSheetResult): r is PerSheetFailure {
  return "error" in r
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(`${orgId}:${getClientIp(request)}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  const { id: stagingId } = await params
  if (typeof stagingId !== "string" || stagingId.trim() === "") {
    return NextResponse.json({ error: "Invalid staging id" }, { status: 400 })
  }

  const staging = await prisma.importStaging.findFirst({
    where: { id: stagingId, organizationId: orgId },
    select: {
      id: true,
      companyId: true,
      status: true,
      sourceSheet: true,
      proposal: true,
      expiresAt: true,
      appliedAt: true,
    },
  })
  if (!staging) {
    return NextResponse.json({ error: "Staging not found" }, { status: 404 })
  }

  // Status gating (mirrors single-sheet apply route).
  if (staging.status === "pending" && staging.expiresAt < new Date()) {
    await prisma.importStaging.updateMany({
      where: { id: staging.id, status: "pending" },
      data: { status: "expired" },
    })
    return NextResponse.json(
      { error: "Staging proposal has expired", status: "expired" },
      { status: 410 },
    )
  }
  if (staging.status === "applied") {
    return NextResponse.json(
      {
        error: "Staging already applied",
        status: "applied",
        appliedAt: staging.appliedAt?.toISOString() ?? null,
      },
      { status: 409 },
    )
  }
  if (staging.status === "discarded" || staging.status === "expired") {
    return NextResponse.json(
      { error: `Staging is ${staging.status}; cannot apply`, status: staging.status },
      { status: 410 },
    )
  }

  // Validate proposal shape — must be MultiSheetProposal. Single-sheet
  // proposals from /analyze should be sent to /apply, not here.
  const rawProposal = staging.proposal as unknown
  const isMulti =
    rawProposal !== null && typeof rawProposal === "object" && isMultiSheetProposal(rawProposal as MultiSheetProposal | MappingProposal)
  if (!isMulti) {
    return NextResponse.json(
      {
        error:
          "Staging proposal is not a MultiSheetProposal. Use /api/onboarding/import/staging/[id]/apply for single-sheet proposals.",
      },
      { status: 422 },
    )
  }
  const multi = rawProposal as MultiSheetProposal

  // Parse multipart body
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data body" }, { status: 400 })
  }
  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing file. Re-upload the same xlsx that was analyzed." },
      { status: 400 },
    )
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes, max ${MAX_FILE_SIZE})` },
      { status: 413 },
    )
  }
  const filename = (file as Blob & { name?: string }).name ?? ""
  if (!filename || !/\.xlsx$/i.test(filename)) {
    return NextResponse.json(
      { error: "Only .xlsx files are accepted by the AI Data Mapper." },
      { status: 415 },
    )
  }

  let workbook: XLSX.WorkBook
  try {
    const arrayBuffer = await file.arrayBuffer()
    workbook = XLSX.read(Buffer.from(arrayBuffer), {
      type: "buffer",
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      dense: true,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }

  // Apply the multi-sheet proposal to the workbook.
  const multiResult = applyMultiSheetProposal(workbook, multi, XLSX)

  // Year resolution. Order of precedence:
  //   1. `?year=YYYY` query override — explicit user intent. Skips
  //      `detectProposalYear` rejection on multi-year workbooks.
  //   2. First successful sheet's proposal — single-year inference.
  //   3. `currentBakuYearNumber()` fallback when no AI-Mapper proposal
  //      survived (e.g. all sheets fell to applier errors and Workbook
  //      adapter will rescue them).
  let targetYear = currentBakuYearNumber()
  const yearOverrideRaw = request.nextUrl.searchParams.get("year")
  const yearOverride = yearOverrideRaw != null ? Number(yearOverrideRaw) : null
  const yearOverrideValid =
    yearOverride !== null && Number.isInteger(yearOverride) && yearOverride >= 2020 && yearOverride <= 2031
  if (yearOverrideValid) {
    targetYear = yearOverride
  } else {
    const firstSuccessForYear = multiResult.perSheet.find(
      (s): s is { sheetName: string; result: ParseResult } => "result" in s,
    )
    const firstSheetProposalForYear = firstSuccessForYear
      ? multi.sheets.find((s) => s.sheetName === firstSuccessForYear.sheetName)?.proposal
      : undefined
    if (firstSheetProposalForYear) {
      const yearHint = detectProposalYear(firstSheetProposalForYear.columns)
      if (typeof yearHint === "number") {
        targetYear = yearHint
      } else if (yearHint && typeof yearHint === "object" && "conflict" in yearHint) {
        return NextResponse.json(
          {
            error: `First sheet has columns referencing multiple years (${yearHint.conflict.join(", ")}). MVP requires single-year workbooks or a ?year=YYYY override.`,
          },
          { status: 400 },
        )
      }
    }
  }

  // Workbook-shape deterministic fallback — runs BEFORE the all-failed
  // gate so it can rescue 422-style applier errors that the multi-year
  // Workbook Fin xlsx triggers ("Multiple columns mapped to month jan").
  //
  // Two rescue paths:
  //   - Sheet errored in applier (typically duplicate-month-column
  //     rejection): replace the error entry with a synthetic success
  //     entry built from the deterministic adapter.
  //   - Sheet returned 0 leaves (year-mismatch case): swap in the
  //     adapter's lines.
  //
  // Only PLF/PL sheets are rescued today. CF rescue + BS routing are
  // separate adapter wiring tasks.
  const plfToBudgetLine = (line: ParsedPlfLine): ParsedBudgetLine => ({
    code: line.code,
    label: line.label,
    accountType: line.accountType,
    plannedAnnual: line.totalAnnual,
    perMonth: line.perMonth,
  })
  for (let i = 0; i < multiResult.perSheet.length; i++) {
    const entry = multiResult.perSheet[i]
    const sheetName = entry.sheetName
    const family = classifyWorkbookSheetFamily(sheetName)
    if (family !== "PLF") continue

    const hasError = "error" in entry
    const hasZeroLines = !hasError && entry.result.lines.length === 0
    if (!hasError && !hasZeroLines) continue

    const fallback = parsePlfPlSheet(workbook, sheetName, XLSX, {
      preferYear: targetYear,
    })
    if (fallback.lines.length === 0) continue

    if (hasError) {
      // Replace the error with a synthetic ParseResult so downstream
      // counters + the all-failed gate count this sheet as a success.
      const synth: ParseResult = {
        sheetName,
        lines: fallback.lines.map(plfToBudgetLine),
        warnings: [
          {
            row: 0,
            reason: `AI Mapper applier errored ("${(entry as { sheetName: string; error: string }).error}"); deterministic Workbook adapter recovered ${fallback.lines.length} leaves for year ${targetYear}.`,
          },
        ],
        skippedRowCount: 0,
        parentRollupsDropped: [],
        parentRollupsUnallocated: [],
      }
      multiResult.perSheet[i] = { sheetName, result: synth }
    } else {
      entry.result.lines = fallback.lines.map(plfToBudgetLine)
      entry.result.warnings.push({
        row: 0,
        reason: `AI Mapper produced 0 leaves; deterministic Workbook adapter recovered ${fallback.lines.length} for year ${targetYear}.`,
      })
    }
  }

  // All-failed gate runs AFTER Workbook rescue.
  const firstSuccess = multiResult.perSheet.find(
    (s): s is { sheetName: string; result: ParseResult } => "result" in s,
  )
  if (!firstSuccess) {
    return NextResponse.json(
      {
        error: "All sheets failed to apply",
        perSheet: multiResult.perSheet,
      },
      { status: 422 },
    )
  }

  const orgIdLocal = orgId
  const companyId = staging.companyId

  const companyForCurrency = await prisma.company.findUnique({
    where: { id: companyId },
    select: { baseCurrencyCode: true },
  })
  const baseCurrencyCode = companyForCurrency?.baseCurrencyCode ?? "AZN"

  // Aggregate per-sheet success/failure stats + flat-concat ParsedBudgetLine[]
  const perSheet: PerSheetResult[] = []
  const allLines: ParsedBudgetLine[] = []
  for (const sheetResult of multiResult.perSheet) {
    if ("error" in sheetResult) {
      perSheet.push({ sheetName: sheetResult.sheetName, error: sheetResult.error })
      continue
    }
    const r = sheetResult.result
    perSheet.push({
      sheetName: sheetResult.sheetName,
      inserted: r.lines.length,
      warnings: r.warnings.length,
      parentRollupsDropped: r.parentRollupsDropped.length,
      parentRollupsUnallocated: r.parentRollupsUnallocated.length,
    })
    allLines.push(...r.lines)
  }

  const successCount = perSheet.filter((r) => !isFailure(r)).length
  const failureCount = perSheet.filter(isFailure).length

  // Phase C.5 / D follow-up — drift diff preview. When ?dryRun=true,
  // skip the transaction entirely and return aggregated totals (revenue
  // / cogs / expense) for the parsed xlsx vs the existing DB state for
  // the same plan + company. UI calls this before flipping the user's
  // "are you sure?" confirmation so wrong-file or wrong-year imports
  // surface BEFORE the destructive delete-then-insert lands.
  if (request.nextUrl.searchParams.get("dryRun") === "true") {
    const planName = `AI-Imported ${targetYear} Budget`
    const existingPlan = await prisma.budgetPlan.findFirst({
      where: { organizationId: orgIdLocal, year: targetYear, name: planName, deletedAt: null },
      select: { id: true },
    })
    const currentLines = existingPlan
      ? await prisma.budgetLine.findMany({
          where: { organizationId: orgIdLocal, planId: existingPlan.id, companyId },
          select: { plannedAmount: true, lineType: true, account: { select: { code: true } } },
        })
      : []
    // Phase L7 — track D&A separately so we can surface EBITDA on the
    // drift preview. EBITDA = GrossProfit + D&A_in_COGS + D&A_in_OpEx,
    // because COGS and OpEx already have D&A subtracted via 703-11 /
    // 721-11 account-code rows. Mirrors src/lib/budgeting/da-codes.ts.
    const { isDaCode } = await import("@/lib/budgeting/da-codes")
    type Tot = { revenue: number; cogs: number; expense: number; daInCogs: number; daInOpex: number }
    const zero = (): Tot => ({ revenue: 0, cogs: 0, expense: 0, daInCogs: 0, daInOpex: 0 })
    // Normalize cogs/expense to absolute values so gross-profit math
    // works regardless of whether the importer stored them as positive
    // (debit convention) or negative (credit convention). Revenue
    // stays signed.
    const current: Tot = zero()
    for (const bl of currentLines) {
      const lt = bl.lineType as "revenue" | "cogs" | "expense"
      const isDA = bl.account?.code && isDaCode(bl.account.code)
      if (lt === "revenue") current.revenue += bl.plannedAmount
      else if (lt === "cogs") {
        current.cogs += Math.abs(bl.plannedAmount)
        if (isDA) current.daInCogs += Math.abs(bl.plannedAmount)
      } else if (lt === "expense") {
        current.expense += Math.abs(bl.plannedAmount)
        if (isDA) current.daInOpex += Math.abs(bl.plannedAmount)
      }
    }
    const incoming: Tot = zero()
    for (const line of allLines) {
      const lt: "revenue" | "cogs" | "expense" =
        line.accountType === "revenue" || line.accountType === "cogs"
          ? line.accountType
          : "expense"
      const total = line.perMonth.reduce((a, v) => a + (v ?? 0), 0)
      const isDA = isDaCode(line.code)
      if (lt === "revenue") incoming.revenue += total
      else {
        incoming[lt] += Math.abs(total)
        if (isDA && lt === "cogs") incoming.daInCogs += Math.abs(total)
        if (isDA && lt === "expense") incoming.daInOpex += Math.abs(total)
      }
    }
    const pct = (cur: number, inc: number): number =>
      cur === 0 ? (inc === 0 ? 0 : 100) : ((inc - cur) / Math.abs(cur)) * 100
    // EBITDA = Revenue - COGS - OpEx + (D&A in COGS) + (D&A in OpEx).
    // Equivalently: Revenue - (COGS - DA_COGS) - (OpEx - DA_OpEx).
    const ebitdaOf = (t: Tot) =>
      t.revenue - (t.cogs - t.daInCogs) - (t.expense - t.daInOpex)
    return NextResponse.json({
      dryRun: true,
      stagingId: staging.id,
      year: targetYear,
      planExisted: !!existingPlan,
      currentLineCount: currentLines.length,
      incomingLineCount: allLines.length * 12, // 12 months per line
      sheetCount: { success: successCount, failure: failureCount },
      totals: {
        revenue: { current: current.revenue, incoming: incoming.revenue, deltaPct: pct(current.revenue, incoming.revenue) },
        cogs:    { current: current.cogs,    incoming: incoming.cogs,    deltaPct: pct(current.cogs, incoming.cogs) },
        expense: { current: current.expense, incoming: incoming.expense, deltaPct: pct(current.expense, incoming.expense) },
      },
      gross_profit: {
        current: current.revenue - current.cogs,
        incoming: incoming.revenue - incoming.cogs,
      },
      ebitda: {
        current: ebitdaOf(current),
        incoming: ebitdaOf(incoming),
        deltaPct: pct(ebitdaOf(current), ebitdaOf(incoming)),
      },
    })
  }

  // Transactional delete-then-insert. Identical to single-sheet — operates
  // on flat aggregate from all successful sheets.
  let totalInserted = 0
  let totalDeleted = 0
  try {
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const planName = `AI-Imported ${targetYear} Budget`
        let plan = await tx.budgetPlan.findFirst({
          where: { organizationId: orgIdLocal, year: targetYear, name: planName, deletedAt: null },
          select: { id: true },
        })
        if (!plan) {
          plan = await tx.budgetPlan.create({
            data: {
              organizationId: orgIdLocal,
              name: planName,
              year: targetYear,
              periodType: "yearly",
              status: "active",
            },
            select: { id: true },
          })
        }

        const del = await tx.budgetLine.deleteMany({
          where: { organizationId: orgIdLocal, planId: plan.id, companyId },
        })

        const coaCache = new Map<string, string>()
        let inserted = 0
        for (const line of allLines) {
          let coaId = coaCache.get(line.code)
          if (!coaId) {
            const existing = await tx.chartOfAccount.findUnique({
              where: { organizationId_code: { organizationId: orgIdLocal, code: line.code } },
              select: { id: true },
            })
            if (existing) {
              coaId = existing.id
            } else {
              const created = await tx.chartOfAccount.create({
                data: {
                  organizationId: orgIdLocal,
                  code: line.code,
                  name: line.label || line.code,
                  nameEn: line.label || line.code,
                  accountType: line.accountType,
                  sortOrder: 0,
                  isActive: true,
                },
                select: { id: true },
              })
              coaId = created.id
            }
            coaCache.set(line.code, coaId)
          }
          if (!coaId) {
            throw new Error(`Internal: coaId not resolved for code ${line.code}`)
          }

          const lineType: "revenue" | "cogs" | "expense" =
            line.accountType === "revenue" || line.accountType === "cogs"
              ? line.accountType
              : "expense"

          for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
            const monthlyAmount = line.perMonth[monthIdx] ?? 0
            const data: Prisma.BudgetLineUncheckedCreateInput = {
              organizationId: orgIdLocal,
              planId: plan.id,
              companyId,
              accountId: coaId,
              department: null,
              lineType,
              plannedAmount: monthlyAmount,
              sortOrder: monthIdx,
              monthIndex: monthIdx,
              isAutoPlanned: false,
              isAutoActual: false,
              currencyCode: baseCurrencyCode,
            }
            await tx.budgetLine.create({ data })
          }
          inserted += 1
        }

        await tx.importStaging.update({
          where: { id: staging.id },
          data: { status: "applied", appliedAt: new Date() },
        })

        return { inserted, deleted: del.count }
      },
      { timeout: 120_000 },
    )
    totalInserted = result.inserted
    totalDeleted = result.deleted
  } catch (err) {
    log.error("transaction failed", {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    return NextResponse.json(
      {
        error: `Transaction failed: ${err instanceof Error ? err.message : String(err)}`,
        perSheet,
      },
      { status: 500 },
    )
  }

  // Phase 7.I follow-up — auto-transition Company.status pending → active
  // on first data arrival. The C.3 terminal gate hides indicators for
  // `status='pending'` companies; once budget lines land the company is
  // ready to surface. Catches the "Aze Sheker-MALT was seeded but never
  // populated → terminal shows ◇9? on every column" failure mode that
  // required manual psql intervention before.
  if (totalInserted > 0) {
    try {
      await prisma.company.updateMany({
        where: { id: companyId, status: "pending" },
        data: { status: "active" },
      })
    } catch (err) {
      // Non-fatal — already-active is the common case; don't roll back
      // the import for a status-flip failure.
      log.warn("Company.status flip failed", {
        companyId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Phase 7.I follow-up — KPI sheet dispatcher. Scans EVERY workbook
  // sheet (not just AI-Mapper-targeted) for KPI families; deterministic
  // adapters emit ParsedKpiFact[] which lands in OperationalFact. Runs
  // in its own try/catch — KPI failures don't roll back budget data
  // already committed above.
  //
  // Three families covered today:
  //   - KPI_FARMING   → multi-entity Farming KPI sheet (per-row
  //                     resolution via cost-center prefix map)
  //   - KPI_PROCESSING → "<ENTITY> KPI" sheet (entity from sheet name)
  //   - PLF/BS/CF      → handled by AI Mapper applier above; no-op here
  //
  // The dispatcher operates org-wide (multi-entity): a single Farming
  // KPI sheet writes facts for EDEN+AZSF+FARM simultaneously, so the
  // route's `companyId` (staging target) is NOT a filter for this pass.
  interface KpiPerSheetResult {
    sheetName: string
    family: "KPI_FARMING" | "KPI_PROCESSING"
    factsInserted: number
    entitiesTouched: string[]
    warnings: number
    error?: string
  }
  const kpiResults: KpiPerSheetResult[] = []
  const kpiTouchedCompanyIds = new Set<string>()
  try {
    for (const sheetName of workbook.SheetNames) {
      const family = classifyWorkbookSheetFamily(sheetName)
      if (family !== "KPI_FARMING" && family !== "KPI_PROCESSING") continue

      const parsed =
        family === "KPI_FARMING"
          ? parseWorkbookFarmingKpiSheet(workbook, sheetName, XLSX, { preferYear: targetYear })
          : parseWorkbookProcessingKpiSheet(workbook, sheetName, XLSX, { preferYear: targetYear })
      if (parsed.facts.length === 0) {
        kpiResults.push({
          sheetName,
          family,
          factsInserted: 0,
          entitiesTouched: [],
          warnings: parsed.warnings.length,
        })
        continue
      }

      // Resolve all company codes mentioned in the facts to ids.
      const codes = Array.from(new Set(parsed.facts.map((f) => f.companyCode)))
      const companies = await prisma.company.findMany({
        where: { organizationId: orgIdLocal, code: { in: codes } },
        select: { id: true, code: true, status: true },
      })
      const idByCode = new Map<string, string>()
      for (const c of companies) idByCode.set(c.code, c.id)
      const unresolvedCodes = codes.filter((c) => !idByCode.has(c))
      if (unresolvedCodes.length > 0) {
        kpiLog.warn("entities not in DB — skipping", {
          sheetName,
          unresolvedCount: unresolvedCodes.length,
          unresolvedCodes,
        })
      }
      const resolvedFacts = parsed.facts.filter((f) => idByCode.has(f.companyCode))

      // Idempotent delete-then-insert per (companyId × metric × date).
      // Same-sheet re-applies must produce identical state.
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const code of codes) {
          const companyIdResolved = idByCode.get(code)
          if (!companyIdResolved) continue
          kpiTouchedCompanyIds.add(companyIdResolved)
          const metricsForThisCompany = Array.from(
            new Set(resolvedFacts.filter((f) => f.companyCode === code).map((f) => f.metric)),
          )
          if (metricsForThisCompany.length === 0) continue
          // Per-(company × metric × date) idempotency: delete same-sheet
          // facts then re-insert. Only narrow the date window to what
          // this sheet emits to avoid touching unrelated entries.
          const datesForThisCompany = Array.from(
            new Set(
              resolvedFacts
                .filter((f) => f.companyCode === code)
                .map((f) => f.date),
            ),
          ).map((d) => new Date(d))
          await tx.operationalFact.deleteMany({
            where: {
              organizationId: orgIdLocal,
              companyId: companyIdResolved,
              metric: { in: metricsForThisCompany },
              date: { in: datesForThisCompany },
              source: "xlsx_import",
            },
          })
        }
        const rows: Array<{
          organizationId: string
          companyId: string
          metric: string
          date: Date
          value: number
          unit: string
          source: string
        }> = []
        for (const fact of resolvedFacts) {
          const companyIdResolved = idByCode.get(fact.companyCode)
          if (!companyIdResolved) continue
          rows.push({
            organizationId: orgIdLocal,
            companyId: companyIdResolved,
            metric: fact.metric,
            date: new Date(fact.date),
            value: fact.value,
            unit: fact.unit,
            source: "xlsx_import",
          })
        }
        if (rows.length > 0) await tx.operationalFact.createMany({ data: rows })
      })

      const entitiesTouched = Array.from(
        new Set(resolvedFacts.map((f) => f.companyCode)),
      )
      kpiResults.push({
        sheetName,
        family,
        factsInserted: resolvedFacts.length,
        entitiesTouched,
        warnings: parsed.warnings.length,
      })
    }
  } catch (err) {
    // KPI dispatch failure is non-fatal — budget data is already
    // committed. Log + surface in response so the user knows the agro
    // indicators won't have data this round.
    kpiLog.error("dispatcher failed", {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    kpiResults.push({
      sheetName: "<dispatcher>",
      family: "KPI_FARMING",
      factsInserted: 0,
      entitiesTouched: [],
      warnings: 0,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Auto-flip Company.status for KPI-touched companies too — same logic
  // as the BudgetLine path. New entities seeded with status='pending'
  // get flipped once first operational data lands.
  if (kpiTouchedCompanyIds.size > 0) {
    try {
      await prisma.company.updateMany({
        where: {
          id: { in: Array.from(kpiTouchedCompanyIds) },
          status: "pending",
        },
        data: { status: "active" },
      })
    } catch (err) {
      kpiLog.warn("Company.status flip failed", {
        companyIds: Array.from(kpiTouchedCompanyIds),
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Phase 7.I follow-up — BS sheet dispatcher. Same scan-every-sheet
  // pattern as KPI. For each "BS <ENTITY>" sheet in the workbook,
  // run parseWorkbookBsSheet → BalanceSheetLine rows. The Workbook file
  // covers partial-year BS data (e.g. only Jan-Mar 2026 for Malt);
  // adapter writes only the months present in the sheet.
  //
  // Each leaf × month → one BalanceSheetLine row, idempotent per
  // (planId × accountCode × year × month).
  interface BsPerSheetResult {
    sheetName: string
    companyCode: string | null
    rowsInserted: number
    leavesTouched: number
    warnings: number
    error?: string
  }
  const bsResults: BsPerSheetResult[] = []
  const bsTouchedCompanyIds = new Set<string>()
  try {
    // Ensure the BalanceSheetLine plan exists. Reuse the same
    // AI-Imported plan id created by the BudgetLine transaction
    // above; if it doesn't exist yet (all-error path that the
    // Workbook rescue happened to miss) create a "BS-Imported" plan.
    const planName = `AI-Imported ${targetYear} Budget`
    let bsPlanId: string | null = null
    for (const sheetName of workbook.SheetNames) {
      const family = classifyWorkbookSheetFamily(sheetName)
      if (family !== "BS") continue

      const entityCode = resolveEntityFromSheetName(sheetName)
      if (!entityCode) {
        bsResults.push({
          sheetName,
          companyCode: null,
          rowsInserted: 0,
          leavesTouched: 0,
          warnings: 1,
          error: `Cannot resolve entity from sheet name "${sheetName}"`,
        })
        continue
      }
      const company = await prisma.company.findFirst({
        where: { organizationId: orgIdLocal, code: entityCode },
        select: { id: true, baseCurrencyCode: true },
      })
      if (!company) {
        bsResults.push({
          sheetName,
          companyCode: entityCode,
          rowsInserted: 0,
          leavesTouched: 0,
          warnings: 1,
          error: `Company ${entityCode} not in DB`,
        })
        continue
      }

      const parsed = parseWorkbookBsSheet(workbook, sheetName, XLSX, { preferYear: targetYear })
      if (parsed.lines.length === 0) {
        bsResults.push({
          sheetName,
          companyCode: entityCode,
          rowsInserted: 0,
          leavesTouched: 0,
          warnings: parsed.warnings.length,
        })
        continue
      }

      if (!bsPlanId) {
        const existing = await prisma.budgetPlan.findFirst({
          where: { organizationId: orgIdLocal, year: targetYear, name: planName, deletedAt: null },
          select: { id: true },
        })
        if (existing) bsPlanId = existing.id
        else {
          const created = await prisma.budgetPlan.create({
            data: {
              organizationId: orgIdLocal,
              name: planName,
              year: targetYear,
              periodType: "yearly",
              status: "active",
            },
            select: { id: true },
          })
          bsPlanId = created.id
        }
      }

      let rowsInserted = 0
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Idempotent: delete same (planId × accountCode × year ×
        // month) rows for this entity then re-insert.
        const codesInSheet = parsed.lines.map((l) => l.code)
        const monthsInSheet = Array.from(
          new Set(
            parsed.lines.flatMap((l) => Object.keys(l.monthlyAmounts)),
          ),
        ).map((k) => Number(k.split("-")[1]))
        await tx.balanceSheetLine.deleteMany({
          where: {
            organizationId: orgIdLocal,
            planId: bsPlanId!,
            accountCode: { in: codesInSheet },
            year: targetYear,
            month: { in: monthsInSheet },
          },
        })
        // Ensure CoA entries exist for each BS code (prefixed by
        // entity to avoid cross-entity overwrite, same pattern as
        // PLF import).
        const coaCache = new Map<string, string>()
        const rows: Array<{
          organizationId: string
          planId: string
          accountCode: string
          accountName: string
          accountId: string
          lineType: string
          subType: string | null
          year: number
          month: number
          amount: number
        }> = []
        for (const line of parsed.lines) {
          const codeKey = `${entityCode}-${line.code}`
          let coaId: string | null = coaCache.get(codeKey) ?? null
          if (!coaId) {
            const existingCoa = await tx.chartOfAccount.findUnique({
              where: { organizationId_code: { organizationId: orgIdLocal, code: codeKey } },
              select: { id: true },
            })
            if (existingCoa) coaId = existingCoa.id
            else {
              const created = await tx.chartOfAccount.create({
                data: {
                  organizationId: orgIdLocal,
                  code: codeKey,
                  name: line.label || line.code,
                  nameEn: line.label || line.code,
                  accountType: line.lineType,
                  sortOrder: 0,
                  isActive: true,
                },
                select: { id: true },
              })
              coaId = created.id
            }
            coaCache.set(codeKey, coaId)
          }
          if (!coaId) throw new Error(`Internal: coaId not resolved for BS code ${codeKey}`)
          for (const [periodKey, amount] of Object.entries(line.monthlyAmounts)) {
            const [yStr, mStr] = periodKey.split("-")
            rows.push({
              organizationId: orgIdLocal,
              planId: bsPlanId!,
              accountCode: codeKey,
              accountName: line.label || line.code,
              accountId: coaId,
              lineType: line.lineType,
              subType: line.subType,
              year: Number(yStr),
              month: Number(mStr),
              amount,
            })
          }
        }
        if (rows.length > 0) await tx.balanceSheetLine.createMany({ data: rows })
        rowsInserted = rows.length
      })

      bsResults.push({
        sheetName,
        companyCode: entityCode,
        rowsInserted,
        leavesTouched: parsed.lines.length,
        warnings: parsed.warnings.length,
      })
      bsTouchedCompanyIds.add(company.id)
    }
  } catch (err) {
    bsLog.error("dispatcher failed", {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    bsResults.push({
      sheetName: "<dispatcher>",
      companyCode: null,
      rowsInserted: 0,
      leavesTouched: 0,
      warnings: 0,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Auto-flip Company.status for BS-touched companies — same logic
  // as the BudgetLine + KPI paths.
  if (bsTouchedCompanyIds.size > 0) {
    try {
      await prisma.company.updateMany({
        where: {
          id: { in: Array.from(bsTouchedCompanyIds) },
          status: "pending",
        },
        data: { status: "active" },
      })
    } catch (err) {
      bsLog.warn("Company.status flip failed", {
        companyIds: Array.from(bsTouchedCompanyIds),
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Phase 7.G Turn CXI — recompute trigger + audit emit. Mirrors single-
  // sheet `/apply` route's post-transaction wiring. Recompute runs on the
  // (companyId, year) the apply-multi just touched; failures surface as
  // `indicatorsStale: true` instead of aborting the already-committed
  // transaction. Audit failure surfaces as `auditStale: true`.
  //
  // Phase 7.I follow-up — also recompute every KPI-touched company. The
  // Farming KPI sheet writes facts for EDEN/AZSF/FARM in one pass, so the
  // recompute pair set fans out beyond the staging target.
  const recomputePairs = new Set<string>([`${companyId}:${targetYear}`])
  for (const kpiCompanyId of kpiTouchedCompanyIds) {
    recomputePairs.add(`${kpiCompanyId}:${targetYear}`)
  }
  for (const bsCompanyId of bsTouchedCompanyIds) {
    recomputePairs.add(`${bsCompanyId}:${targetYear}`)
  }
  const { runRecomputeForCompanies } = await import("@/lib/risk/recompute-trigger")
  const recomputeResult = await runRecomputeForCompanies(
    prisma,
    orgIdLocal,
    Array.from(recomputePairs).map((key) => {
      const [cid, y] = key.split(":")
      return { companyId: cid, year: Number(y) }
    }),
    {
      pairError: (label, err) => recomputeLog.error(label, {
        err: err instanceof Error ? err.message : String(err),
      }),
    },
  )
  const indicatorsStale = recomputeResult.failed > 0

  const { logAuditEvent, buildAuditContext } = await import("@/lib/audit/log")
  const auditResult = await logAuditEvent(prisma, {
    organizationId: orgIdLocal,
    actorUserId: session.userId,
    event: {
      action: "import_staging_apply",
      entityType: "ImportStaging",
      entityId: staging.id,
      metadata: {
        companyId,
        year: targetYear,
        inserted: totalInserted,
        deleted: totalDeleted,
        // Aggregate per-sheet warnings + parent-rollup counts. Per-sheet
        // breakdown lives in the response body (perSheet[]); audit metadata
        // keeps the aggregate for spend-tracking + compliance summaries.
        warnings: perSheet
          .filter((r): r is PerSheetSuccess => !isFailure(r))
          .reduce((s, r) => s + r.warnings, 0),
        parentRollupsDropped: perSheet
          .filter((r): r is PerSheetSuccess => !isFailure(r))
          .reduce((s, r) => s + r.parentRollupsDropped, 0),
        parentRollupsUnallocated: perSheet
          .filter((r): r is PerSheetSuccess => !isFailure(r))
          .reduce((s, r) => s + r.parentRollupsUnallocated, 0),
        recompute: {
          ok: recomputeResult.ok,
          unknown: recomputeResult.unknown,
          failed: recomputeResult.failed,
          targets: recomputeResult.targets,
        },
        // Multi-sheet discriminator + per-sheet outcome counts. Allows
        // admin queries to filter `import_staging_apply` rows by
        // `metadata.multiSheet = true` without a separate enum value.
        multiSheet: true,
        sheetCount: perSheet.length,
        successCount,
        failureCount,
      },
    },
    context: buildAuditContext({
      route: "/api/onboarding/import/staging/[id]/apply-multi",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  })
  const auditStale = !auditResult.ok

  const kpiTotalFacts = kpiResults.reduce((s, r) => s + r.factsInserted, 0)
  const bsTotalRows = bsResults.reduce((s, r) => s + r.rowsInserted, 0)
  return NextResponse.json(
    {
      stagingId: staging.id,
      status: "applied",
      year: targetYear,
      inserted: totalInserted,
      deleted: totalDeleted,
      successCount,
      failureCount,
      perSheet,
      // Phase 7.I — per-sheet outcome for sector adapter pass (KPI
      // dispatcher). Empty when no Workbook-shape KPI sheets found.
      sectorSheets: kpiResults,
      sectorFactsInserted: kpiTotalFacts,
      bsSheets: bsResults,
      bsRowsInserted: bsTotalRows,
      recompute: recomputeResult,
      indicatorsStale,
      auditStale,
    },
    { status: 200 },
  )
}
