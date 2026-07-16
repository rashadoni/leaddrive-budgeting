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
 * Commit policy (2026-06-20, Codex P1 #2): ALL-OR-NONE. A sheet that errors
 * is first given a deterministic Workbook-adapter rescue; if it STILL fails,
 * the whole commit is blocked (409) rather than committing the successful
 * subset — otherwise the delete-then-insert would replace the company's full
 * P&L with a partial set (silent data loss). Caller fixes/re-analyzes the
 * failed sheet via `/analyze-multi?sheetNames=<bad>` and re-applies. (The old
 * behaviour proceeded with the good sheets and blocked only when ALL failed.)
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
// rls-scan-ignore: staged multi-sheet apply (maxDuration 120). Commits N sheets
// through the production import handlers then runRecomputeForCompanies — nested
// transactions + recompute can't fit one 5s interactive withOrgScope tx.
// orgId-scoped in code; runs on the BYPASSRLS `prismaAdmin` client.
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
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
import { extractMapperInput } from "@/lib/onboarding/ai-mapper/extract"
import { computeStructureHash } from "@/lib/onboarding/ai-mapper/structure-hash"
import { verifyStagedWorkbookContent } from "@/lib/onboarding/ai-mapper/workbook-content-hash"
import { computeControlTotals } from "@/lib/onboarding/ai-mapper/control-totals"
import { validateImport } from "@/lib/onboarding/ai-mapper/validate-import"
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
import { runKpiDispatcher, runBsDispatcher } from "./apply-multi-dispatchers"
import { MAX_IMPORT_UPLOAD_BYTES } from "@/lib/import/upload-limits"

export const maxDuration = 120 // larger than single-sheet — N parallel writes

const MAX_FILE_SIZE = MAX_IMPORT_UPLOAD_BYTES // shared cap — see src/lib/import/upload-limits.ts
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

  let workbookBytes: Buffer
  try {
    workbookBytes = Buffer.from(await file.arrayBuffer())
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }

  const contentVerification = verifyStagedWorkbookContent(staging.proposal, workbookBytes)
  if (contentVerification !== "match") {
    return NextResponse.json(
      {
        error:
          contentVerification === "missing"
            ? "Сохранённый анализ не содержит точный отпечаток файла. Для безопасного импорта повторите анализ этого файла."
            : "Загруженный файл отличается от файла, который был проанализирован. Повторите анализ изменённого файла перед импортом.",
        integrityError: contentVerification,
      },
      { status: 409 },
    )
  }

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(workbookBytes, {
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

  // Optional per-sheet user overrides — JSON map { sheetName: Partial<MappingProposal> }
  // produced by the review UI's edits. applyMultiSheetProposal merges them.
  let userOverridesBySheet: Record<string, Partial<MappingProposal>> | undefined
  const overridesRaw = form.get("userOverrides")
  if (typeof overridesRaw === "string" && overridesRaw.trim() !== "") {
    try {
      userOverridesBySheet = JSON.parse(overridesRaw)
    } catch (err) {
      return NextResponse.json(
        { error: `Invalid userOverrides JSON: ${err instanceof Error ? err.message : err}` },
        { status: 400 },
      )
    }
  }

  // Structure-hash guard (Phase 2 #5): reject a file edited since analyze —
  // the multi proposal maps columns by index per sheet. Stored hash is the
  // per-sheet hashes joined with "|". This semantic shape check complements
  // the mandatory byte check above.
  const storedHash = (staging.proposal as { __structureHash?: string }).__structureHash
  if (storedHash) {
    // Re-extract with the SAME company industry analyze used (computeStructureHash
    // includes it) — bug fix 2026-06-21: omitting it rejected every legit
    // re-upload for a company that has an industry.
    const anchorCompany = await prisma.company.findUnique({
      where: { id: staging.companyId },
      select: { name: true, industry: true },
    })
    const currentHash = multi.sheets
      .map((s) => {
        const mi = extractMapperInput(workbook, s.sheetName, XLSX, {
          companyName: anchorCompany?.name ?? undefined,
          industry: anchorCompany?.industry ?? undefined,
        })
        return "error" in mi ? "" : computeStructureHash(mi)
      })
      .join("|")
    if (currentHash !== storedHash) {
      return NextResponse.json(
        {
          error:
            "Файл изменился после анализа (структура листов не совпадает). Загрузите тот же файл или повторите анализ.",
        },
        { status: 409 },
      )
    }
  }

  // Year resolution FIRST (Codex P0 #4) — must precede the parse so the applier
  // selects the right year's columns on a multi-year sheet. Derived from the
  // proposals' column roles (no parse needed). Order of precedence:
  //   1. `?year=YYYY` query override — explicit user intent.
  //   2. First sheet proposal whose roles carry a single embedded year.
  //   3. `currentBakuYearNumber()` fallback.
  let targetYear = currentBakuYearNumber()
  const yearOverrideRaw = request.nextUrl.searchParams.get("year")
  const yearOverride = yearOverrideRaw != null ? Number(yearOverrideRaw) : null
  const yearOverrideValid =
    yearOverride !== null && Number.isInteger(yearOverride) && yearOverride >= 2020 && yearOverride <= 2031
  if (yearOverrideValid) {
    targetYear = yearOverride
  } else {
    for (const s of multi.sheets) {
      const yearHint = detectProposalYear(s.proposal.columns)
      if (typeof yearHint === "number") {
        targetYear = yearHint
        break
      }
      if (yearHint && typeof yearHint === "object" && "conflict" in yearHint) {
        return NextResponse.json(
          {
            error: `Sheet "${s.sheetName}" references multiple years (${yearHint.conflict.join(", ")}). Use a ?year=YYYY override to pick one.`,
          },
          { status: 400 },
        )
      }
    }
  }
  // Optional target currency (multi-currency sheet).
  const curOverrideRaw = request.nextUrl.searchParams.get("currency")
  const preferCurrency =
    typeof curOverrideRaw === "string" && /^[A-Za-z]{3}$/.test(curOverrideRaw.trim())
      ? curOverrideRaw.trim().toUpperCase()
      : undefined

  // Apply the multi-sheet proposal to the workbook (with reviewer overrides),
  // now selecting the resolved year/currency.
  const multiResult = applyMultiSheetProposal(workbook, multi, XLSX, userOverridesBySheet, {
    preferYear: targetYear,
    preferCurrency,
  })

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
  // Control-total reports computed PER SHEET (not on a flat cross-sheet
  // concat). Codex re-review P1 (2026-06-20): two sheets can reuse the same
  // parent code; concatenating drops them into one Map<code,total> where a
  // large stated total on sheet B masks a RED mismatch on sheet A. Keep them
  // separate and take the WORST verdict across sheets.
  const sheetControls: Array<{
    sheetName: string
    report: ReturnType<typeof computeControlTotals>
  }> = []
  // Per-sheet FULL validation-engine block (Codex P0 #3, 2026-06-20: the
  // multi-sheet path must hard-block on ANY `blocked` verdict — zero-revenue
  // coverage AND wrong/ambiguous cost-sign — not just sign, otherwise a
  // mis-mapped (no-revenue) sheet would delete the company's full P&L and write
  // a partial set. Mirrors single /apply + apply-multi-entity.
  const blockedSheets: Array<{ sheetName: string; findings: ReturnType<typeof validateImport>["findings"] }> = []
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
    const controlReport = computeControlTotals(r.parentRollupsDropped, r.parentRollupsUnallocated)
    sheetControls.push({ sheetName: sheetResult.sheetName, report: controlReport })
    const validation = validateImport(r, controlReport)
    if (validation.verdict === "blocked") {
      blockedSheets.push({
        sheetName: sheetResult.sheetName,
        findings: validation.findings.filter((f) => f.severity === "blocker"),
      })
    }
  }

  // Worst verdict across sheets + mismatching rows tagged by sheet name.
  const aggVerdict: "green" | "yellow" | "red" = sheetControls.some(
    (s) => s.report.verdict === "red",
  )
    ? "red"
    : sheetControls.some((s) => s.report.verdict === "yellow")
      ? "yellow"
      : "green"
  const aggControlTotals = sheetControls
    .flatMap((s) =>
      s.report.controlTotals.map((c) => ({ ...c, sheetName: s.sheetName })),
    )
    .sort((a, b) => b.deltaPct - a.deltaPct)
    .slice(0, 10)
  // noControl only when EVERY sheet lacked parent rows to check against.
  const aggNoControl =
    sheetControls.length > 0 && sheetControls.every((s) => s.report.noControl)

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
      // Phase 2 #1/#4 — worst control-total verdict across sheets (computed
      // per-sheet to avoid duplicate-parent-code masking; Codex re-review P1).
      controlVerdict: aggVerdict,
      controlNoData: aggNoControl,
      controlTotals: aggControlTotals,
    })
  }

  // ── Server-side commit gates (Codex P1 #1 + #2, 2026-06-20) ──────────
  // (a) ALL-OR-NONE: if any selected sheet failed (after the Workbook
  //     rescue), block the commit. Otherwise the delete-then-insert below
  //     would replace the company's FULL P&L with only the successful
  //     subset — silent partial data loss. (Old behaviour committed
  //     partials and blocked only when ALL sheets failed.)
  if (failureCount > 0) {
    return NextResponse.json(
      {
        error: `Импорт заблокирован: ${failureCount} из ${perSheet.length} лист(ов) не разобрались. Режим «всё-или-ничего» — иначе данные компании заменятся неполным набором. Исправьте/переанализируйте проблемные листы и повторите.`,
        perSheet,
        sheetCount: { success: successCount, failure: failureCount },
      },
      { status: 409 },
    )
  }
  // (b) Control-total RED on ANY sheet = hard block (per-sheet verdict, so a
  //     large parent total on one sheet can't mask another sheet's RED).
  if (aggVerdict === "red") {
    return NextResponse.json(
      {
        error:
          "Контроль-сумма RED по листам: родительские строки не сходятся с суммой детей (вероятный мис-маппинг колонки). Коммит заблокирован.",
        controlVerdict: "red",
        controlTotals: aggControlTotals,
      },
      { status: 409 },
    )
  }
  // (b2) Cost-SIGN convention hard-block on ANY sheet (Codex #5 / C3.1): a
  //      positive/ambiguous stored-sign would be corrupted by the flip. The
  //      multi-sheet path now enforces it, mirroring single /apply.
  if (blockedSheets.length > 0) {
    return NextResponse.json(
      {
        error: `Импорт заблокирован валидацией для листов: ${blockedSheets.map((s) => s.sheetName).join(", ")} (нет выручки / неоднозначный знак затрат). Исправьте маппинг.`,
        blockedSheets,
      },
      { status: 409 },
    )
  }
  // (c) Critical anomalies / low confidence in ANY sheet require explicit ack.
  const isAck = (v: FormDataEntryValue | null): boolean =>
    typeof v === "string" && /^(true|1|yes)$/i.test(v.trim())
  const allAnomalies = multi.sheets.flatMap((s) =>
    Array.isArray(s.proposal?.anomalies) ? s.proposal.anomalies : [],
  )
  const criticalAnomalies = allAnomalies.filter((a) => a.severity === "critical")
  if (criticalAnomalies.length > 0 && !isAck(form.get("acknowledgeAnomalies"))) {
    return NextResponse.json(
      {
        error: `Критических аномалий по листам: ${criticalAnomalies.length}. Требуется подтверждение (acknowledgeAnomalies) перед коммитом.`,
        criticalAnomalies: criticalAnomalies.slice(0, 10),
        requiresAcknowledgement: "acknowledgeAnomalies",
      },
      { status: 409 },
    )
  }
  const lowConfColumns = multi.sheets.flatMap((s) =>
    (Array.isArray(s.proposal?.columns) ? s.proposal.columns : []).filter(
      (c) => typeof c.confidence === "number" && c.confidence < 0.6,
    ),
  )
  const anyLowOverall = multi.sheets.some(
    (s) =>
      typeof s.proposal?.overallConfidence === "number" &&
      s.proposal.overallConfidence < 0.7,
  )
  if (
    (lowConfColumns.length > 0 || anyLowOverall) &&
    !isAck(form.get("acknowledgeLowConfidence"))
  ) {
    return NextResponse.json(
      {
        error: `Низкая уверенность маппинга по листам (колонок <0.6: ${lowConfColumns.length}${anyLowOverall ? "; есть лист с общей уверенностью <0.7" : ""}). Требуется подтверждение (acknowledgeLowConfidence) перед коммитом.`,
        requiresAcknowledgement: "acknowledgeLowConfidence",
      },
      { status: 409 },
    )
  }

  // Transactional delete-then-insert. Identical to single-sheet — operates
  // on flat aggregate from all successful sheets.
  let totalInserted = 0
  let totalDeleted = 0
  try {
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Concurrency claim (Codex P0 #2) — race-safe status flip inside the tx
        // before any delete; the 2nd POST blocks then sees count 0.
        const claim = await tx.importStaging.updateMany({
          where: { id: staging.id, status: "pending" },
          data: { status: "applied", appliedAt: new Date() },
        })
        if (claim.count !== 1) throw new Error("STAGING_RACE")

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

        // status/appliedAt were set by the concurrency claim above.
        return { inserted, deleted: del.count }
      },
      { timeout: 120_000 },
    )
    totalInserted = result.inserted
    totalDeleted = result.deleted
  } catch (err) {
    if (err instanceof Error && err.message === "STAGING_RACE") {
      return NextResponse.json(
        { error: "Эта загрузка уже применяется/применена (параллельный запрос).", status: "applied" },
        { status: 409 },
      )
    }
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

  // Phase 7.I follow-up — KPI sheet dispatcher (extracted to
  // ./apply-multi-dispatchers, Phase 8 D1). Scans every sheet for KPI
  // families and writes OperationalFact in its own tx; failures non-fatal.
  const { kpiResults, kpiTouchedCompanyIds } = await runKpiDispatcher({
    workbook,
    XLSX,
    targetYear,
    orgIdLocal,
  })

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

  // Phase 7.I follow-up — BS sheet dispatcher (extracted to
  // ./apply-multi-dispatchers, Phase 8 D1). Same scan-every-sheet pattern;
  // writes BalanceSheetLine in its own tx.
  const { bsResults, bsTouchedCompanyIds } = await runBsDispatcher({
    workbook,
    XLSX,
    targetYear,
    orgIdLocal,
  })

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
