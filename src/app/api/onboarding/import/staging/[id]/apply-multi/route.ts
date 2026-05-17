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
import {
  applyMultiSheetProposal,
  isMultiSheetProposal,
  detectProposalYear,
  type MultiSheetProposal,
} from "@/lib/onboarding/ai-mapper/applier"
import type { ParseResult, ParsedBudgetLine } from "@/lib/onboarding/adapters/azmade-sopl"
import { currentBakuYearNumber } from "@/lib/risk/periods"
import type { MappingProposal } from "@/lib/onboarding/ai-mapper/types"
// Phase 7.I Turn — Guvven-shape deterministic fallback. When AI Mapper
// produces a structurally-valid proposal but extraction returns 0 leaves
// (typical for multi-year sheets where AI Mapper picked the wrong year's
// columns), run the proven `parsePlfPlSheet` adapter as a deterministic
// retry using the requested targetYear as preferYear hint.
import {
  parsePlfPlSheet,
  type ParsedPlfLine,
} from "@/lib/onboarding/adapters/azseker-plf"
import { classifyGuvvenSheetFamily } from "@/lib/onboarding/azseker-guvven-mapping"

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

  // Year resolution: derive from FIRST sheet's columns; if any other sheet
  // disagrees, reject (same constraint as single-sheet). Use the first
  // SUCCESSFUL sheet's proposal for year hint.
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
  const firstSheetProposal = multi.sheets.find(
    (s) => s.sheetName === firstSuccess.sheetName,
  )?.proposal
  let targetYear = currentBakuYearNumber()
  // Year override via `?year=2026` query param. The wizard form passes
  // this when the workbook is known to span multiple years (e.g. Guvven
  // Fin file has 2022-2026 columns; the user is uploading their 2026
  // budget plan, not 2022 actuals). Override skips `detectProposalYear`
  // so multi-year sheets don't reject with a "conflict" 400.
  const yearOverrideRaw = request.nextUrl.searchParams.get("year")
  const yearOverride = yearOverrideRaw != null ? Number(yearOverrideRaw) : null
  const yearOverrideValid =
    yearOverride !== null && Number.isInteger(yearOverride) && yearOverride >= 2020 && yearOverride <= 2031
  if (yearOverrideValid) {
    targetYear = yearOverride
  } else if (firstSheetProposal) {
    const yearHint = detectProposalYear(firstSheetProposal.columns)
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

  // Guvven-shape deterministic fallback. After AI Mapper applier runs,
  // any sheet that yielded 0 leaves AND looks Guvven-shaped (PLF.* code
  // family in sheet name like "PLF CPC" / "PL Malt") gets re-parsed via
  // the proven `parsePlfPlSheet` adapter with preferYear=targetYear.
  // This recovers the multi-year case where AI Mapper structurally
  // succeeded (12 monthly columns proposed) but picked the wrong year.
  const plfToBudgetLine = (line: ParsedPlfLine): ParsedBudgetLine => ({
    code: line.code,
    label: line.label,
    accountType: line.accountType,
    plannedAnnual: line.totalAnnual,
    perMonth: line.perMonth,
  })
  for (const sheetResult of multiResult.perSheet) {
    if ("error" in sheetResult) continue
    if (sheetResult.result.lines.length > 0) continue
    const family = classifyGuvvenSheetFamily(sheetResult.sheetName)
    if (family !== "PLF") continue
    const fallback = parsePlfPlSheet(workbook, sheetResult.sheetName, XLSX, {
      preferYear: targetYear,
    })
    if (fallback.lines.length === 0) continue
    sheetResult.result.lines = fallback.lines.map(plfToBudgetLine)
    sheetResult.result.warnings.push({
      row: 0,
      reason: `AI Mapper produced 0 leaves; deterministic Guvven adapter recovered ${fallback.lines.length} for year ${targetYear}.`,
    })
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
          select: { plannedAmount: true, lineType: true, category: true },
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
      const isDA = bl.category && isDaCode(bl.category)
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
              category: line.code,
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
    console.error("[apply-multi] transaction failed:", err)
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
      console.warn("[apply-multi] Company.status flip failed:", err)
    }
  }

  // Phase 7.G Turn CXI — recompute trigger + audit emit. Mirrors single-
  // sheet `/apply` route's post-transaction wiring. Recompute runs on the
  // (companyId, year) the apply-multi just touched; failures surface as
  // `indicatorsStale: true` instead of aborting the already-committed
  // transaction. Audit failure surfaces as `auditStale: true`.
  const { runRecomputeForCompanies } = await import("@/lib/risk/recompute-trigger")
  const recomputeResult = await runRecomputeForCompanies(
    prisma,
    orgIdLocal,
    [{ companyId, year: targetYear }],
    {
      pairError: (label, err) => console.error(`[apply-multi/recompute] ${label}:`, err),
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
      recompute: recomputeResult,
      indicatorsStale,
      auditStale,
    },
    { status: 200 },
  )
}
