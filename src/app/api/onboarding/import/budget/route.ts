/**
 * Phase 7.B — deterministic per-company budget/actual import endpoint.
 *
 * Distinct from `/api/onboarding/import/analyze` (AI Mapper, proposes a
 * mapping for unknown-shape xlsx) — this endpoint is for **known-shape**
 * workbooks where the column layout is already understood (e.g. AZMADE
 * SOPL or "P-F" sheets, or "5-2 büdcə mrkz daxil" rollup sheets).
 * The user names the sheet + parser variant; we apply it deterministically.
 *
 * Multipart body:
 *   - `file`               required; .xlsx workbook
 *   - `companyId`          required; must belong to caller's org
 *   - `sheetName`          required; sheet inside the workbook
 *   - `year`               required; integer (BudgetPlan year)
 *   - `parser`             optional; `"sopl"` (default) or `"rollup"`
 *   - `rollupColumnHeader` required when `parser=rollup` — column header
 *                          of the entity to extract (e.g. "Mərkəz")
 *
 * Auth: `manager` role + caller's org must match the company's
 * organizationId (404 on mismatch — never leak existence).
 *
 * Financial-safety pattern: transactional delete-then-insert keyed on
 * `(orgId, planId, companyId)`. Re-uploads converge — either the file
 * lands fully or the pre-existing state is untouched. Auto-recompute
 * fires after a successful import.
 */

import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:import-budget")
const recomputeLog = getLogger("api:import-budget:recompute")
import {
  parseSoplSheet,
  parseSummaryRollupSheet,
  type ParsedBudgetLine,
} from "@/lib/onboarding/adapters/azmade-sopl"

export const maxDuration = 60

// 10 MB — same cap as AI Mapper's analyze endpoint. Typical workbooks
// observed at 200-400 KB; this leaves 25× headroom for plan-vs-actual
// + multi-year sheets without becoming a memory DoS vector.
const MAX_FILE_SIZE = 10 * 1024 * 1024

// Stricter than the read endpoints: a budget import touches BudgetPlan +
// ChartOfAccount + N BudgetLine rows + recompute. 5/min/org keeps an
// abusive client from drowning the DB.
const RATE_LIMIT = { name: "import-budget", max: 5, windowMs: 60_000 }

const PARSERS = ["sopl", "rollup"] as const
type ParserKind = (typeof PARSERS)[number]

interface ApplyResult {
  inserted: number
  deleted: number
  warnings: number
  parentRollupsDropped: number
  parentRollupsUnallocated: number
  planId: string
  planCreated: boolean
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(
    `${orgId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data body" },
      { status: 400 },
    )
  }

  const file = form.get("file")
  const companyIdRaw = form.get("companyId")
  const sheetNameRaw = form.get("sheetName")
  const yearRaw = form.get("year")
  const parserRaw = form.get("parser")
  const rollupHeaderRaw = form.get("rollupColumnHeader")

  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing `file` (multipart .xlsx)" },
      { status: 400 },
    )
  }
  if (typeof companyIdRaw !== "string" || companyIdRaw.trim() === "") {
    return NextResponse.json(
      { error: "Missing `companyId` field" },
      { status: 400 },
    )
  }
  if (typeof sheetNameRaw !== "string" || sheetNameRaw.trim() === "") {
    return NextResponse.json(
      { error: "Missing `sheetName` field" },
      { status: 400 },
    )
  }
  const yearStr = typeof yearRaw === "string" ? yearRaw.trim() : ""
  const year = Number(yearStr)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json(
      { error: "Invalid `year` — expected integer 2000-2100" },
      { status: 400 },
    )
  }
  const parser: ParserKind =
    typeof parserRaw === "string" &&
    (PARSERS as readonly string[]).includes(parserRaw)
      ? (parserRaw as ParserKind)
      : "sopl"
  const rollupColumnHeader =
    typeof rollupHeaderRaw === "string" && rollupHeaderRaw.trim() !== ""
      ? rollupHeaderRaw.trim()
      : null
  if (parser === "rollup" && !rollupColumnHeader) {
    return NextResponse.json(
      {
        error:
          "Missing `rollupColumnHeader` — required when `parser=rollup`. Use the entity column header from the rollup sheet (e.g. `Mərkəz`).",
      },
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
      { error: "Only .xlsx files are accepted by the budget import." },
      { status: 415 },
    )
  }

  // Verify company belongs to caller's org BEFORE parsing the workbook
  // (parse cost is small but the org check is cheaper still — fail fast
  // on cross-tenant attempts before touching xlsx).
  const company = await prisma.company.findFirst({
    where: { id: companyIdRaw.trim(), organizationId: orgId },
    select: { id: true, code: true, name: true, industry: true, level: true },
  })
  if (!company) {
    return NextResponse.json(
      { error: "Company not found in your organization" },
      { status: 404 },
    )
  }

  // Parse OUTSIDE the transaction — malformed workbook should fail fast
  // without holding a long-running DB lock.
  let workbook: XLSX.WorkBook
  try {
    const buf = await file.arrayBuffer()
    workbook = XLSX.read(Buffer.from(buf), {
      type: "buffer",
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      dense: true,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse workbook: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    )
  }
  if (!workbook.SheetNames.includes(sheetNameRaw)) {
    return NextResponse.json(
      {
        error: `Sheet "${sheetNameRaw}" not found.`,
        availableSheets: workbook.SheetNames,
      },
      { status: 400 },
    )
  }

  let parseResult: ReturnType<typeof parseSoplSheet>
  try {
    parseResult =
      parser === "rollup"
        ? parseSummaryRollupSheet(
            workbook,
            sheetNameRaw,
            rollupColumnHeader as string,
            XLSX,
          )
        : parseSoplSheet(workbook, sheetNameRaw, XLSX)
  } catch (err) {
    return NextResponse.json(
      {
        error: `Parser failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    )
  }

  if (parseResult.lines.length === 0) {
    return NextResponse.json(
      {
        error:
          "Parser returned 0 budget lines — wrong sheet or unsupported layout. Use the AI Mapper (/api/onboarding/import/analyze) for unknown shapes.",
        warnings: parseResult.warnings.slice(0, 5),
      },
      { status: 400 },
    )
  }

  // Transactional replace + auto-recompute. See jsdoc above for the
  // safety contract (delete-then-insert + atomic rollback).
  let result: ApplyResult
  try {
    result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const planName = `Imported ${year} Budget`
        let plan = await tx.budgetPlan.findFirst({
          where: { organizationId: orgId, year, name: planName, deletedAt: null },
          select: { id: true },
        })
        let planCreated = false
        if (!plan) {
          plan = await tx.budgetPlan.create({
            data: {
              organizationId: orgId,
              name: planName,
              year,
              periodType: "yearly",
              status: "active",
            },
            select: { id: true },
          })
          planCreated = true
        }

        const del = await tx.budgetLine.deleteMany({
          where: {
            organizationId: orgId,
            planId: plan.id,
            companyId: company.id,
          },
        })

        const coaCache = new Map<string, string>()
        let inserted = 0
        for (const line of parseResult.lines) {
          const accountId = await ensureChartOfAccountTx(
            tx,
            orgId,
            line,
            coaCache,
          )
          await insertBudgetLineTx(tx, orgId, plan.id, company.id, accountId, line)
          inserted += 1
        }

        return {
          inserted,
          deleted: del.count,
          warnings: parseResult.warnings.length,
          parentRollupsDropped: parseResult.parentRollupsDropped.length,
          parentRollupsUnallocated: parseResult.parentRollupsUnallocated.length,
          planId: plan.id,
          planCreated,
        }
      },
      { timeout: 60_000 },
    )
  } catch (err) {
    log.error("transaction failed", {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    return NextResponse.json(
      {
        error: `Import transaction failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    )
  }

  // Auto-recompute (outside transaction — long-running, would extend tx
  // beyond 60s on large companies). Failures here mean BudgetLine is
  // committed but IndicatorValue rows haven't refreshed; surface as
  // `indicatorsStale` so the UI can show "matrix may be stale, retry".
  // Phase 7.E hardening (Turn 10): orchestration delegated to the shared
  // `runRecomputeForCompanies` so the budget / staging / batch-script
  // paths can't drift apart silently.
  const { runRecomputeForCompanies } = await import("@/lib/risk/recompute-trigger")
  const recomputeResult = await runRecomputeForCompanies(prisma, orgId, [
    { companyId: company.id, year },
  ], {
    pairError: (label, err) =>
      recomputeLog.error(label, {
        err: err instanceof Error ? err.message : String(err),
      }),
  })
  const indicatorsStale = recomputeResult.failed > 0

  // Phase 7.F (Turn 11; helper-extracted Turn 19) — audit the import via
  // the shared `logImportBudgetCreate` helper so the API route + CLI
  // script can't drift apart on metadata shape. Non-blocking: a logging
  // failure surfaces as `auditStale: true` rather than aborting the
  // already-committed BudgetLine writes.
  const { logImportBudgetCreate } = await import("@/lib/audit/import-helpers")
  const auditResult = await logImportBudgetCreate(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    planId: result.planId,
    companyId: company.id,
    companyCode: company.code,
    year,
    parser,
    inserted: result.inserted,
    deleted: result.deleted,
    warnings: result.warnings,
    parentRollupsDropped: result.parentRollupsDropped,
    parentRollupsUnallocated: result.parentRollupsUnallocated,
    recompute: {
      ok: recomputeResult.ok,
      unknown: recomputeResult.unknown,
      failed: recomputeResult.failed,
      targets: recomputeResult.targets,
    },
    context: {
      route: "/api/onboarding/import/budget",
      userAgent: request.headers.get("user-agent") ?? undefined,
    },
  })
  const auditStale = !auditResult.ok

  return NextResponse.json(
    {
      companyId: company.id,
      companyCode: company.code,
      year,
      parser,
      planId: result.planId,
      planCreated: result.planCreated,
      inserted: result.inserted,
      deleted: result.deleted,
      warnings: result.warnings,
      parentRollupsDropped: result.parentRollupsDropped,
      parentRollupsUnallocated: result.parentRollupsUnallocated,
      recompute: recomputeResult,
      indicatorsStale,
      auditStale,
    },
    { status: 200 },
  )
}

async function ensureChartOfAccountTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  line: ParsedBudgetLine,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(line.code)
  if (cached) return cached
  const existing = await tx.chartOfAccount.findUnique({
    where: { organizationId_code: { organizationId, code: line.code } },
    select: { id: true },
  })
  if (existing) {
    cache.set(line.code, existing.id)
    return existing.id
  }
  const created = await tx.chartOfAccount.create({
    data: {
      organizationId,
      code: line.code,
      name: line.label || line.code,
      nameEn: line.label || line.code,
      accountType: line.accountType,
      sortOrder: 0,
      isActive: true,
    },
    select: { id: true },
  })
  cache.set(line.code, created.id)
  return created.id
}

async function insertBudgetLineTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  planId: string,
  companyId: string,
  accountId: string,
  parsed: ParsedBudgetLine,
): Promise<void> {
  const lineType: "revenue" | "cogs" | "expense" =
    parsed.accountType === "revenue" || parsed.accountType === "cogs"
      ? parsed.accountType
      : "expense"
  // Monthly-distribution contract: 12 rows per parsed line
  // (sortOrder=monthIdx, plannedAmount=perMonth[idx]). Single-row
  // inserts at sortOrder=0 would collapse all 12 months into Jan →
  // P&L charts would show a January spike + zero across Feb-Dec.
  // xlsx-sourced lines have explicit plannedAmount values; they are
  // NOT auto-planned.
  for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
    const monthlyAmount = parsed.perMonth[monthIdx] ?? 0
    await tx.budgetLine.create({
      data: {
        organizationId,
        planId,
        companyId,
        accountId,
        category: parsed.code,
        department: null,
        lineType,
        plannedAmount: monthlyAmount,
        sortOrder: monthIdx,
        // Phase 7.G Turn XL (A.1): explicit 0-indexed month for sparkline
        // + per-month aggregation (replaces sortOrder % 100 heuristic).
        monthIndex: monthIdx,
        isAutoPlanned: false,
        isAutoActual: false,
      },
    })
  }
}

