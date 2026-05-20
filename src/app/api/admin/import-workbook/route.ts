/**
 * Phase 7.M Tier2 #3 (2026-05-19) — POST endpoint for the AzerSheker
 * workbook batch import. Mirrors `scripts/import-azseker-workbook-
 * batch.ts` but accepts a multipart/form-data xlsx upload from the
 * admin UI (or curl) instead of reading the file from a hard-coded
 * path.
 *
 * Contract
 * ────────
 *   POST /api/admin/import-workbook
 *   Content-Type: multipart/form-data
 *   Fields:
 *     file        — the xlsx blob (required)
 *     year        — target year (default 2026)
 *     purge       — "1" or "true" to hard-purge archived rows (default off)
 *     entityFilter — optional single AzerSheker entity code to limit scope
 *
 * Response (200 JSON):
 *   {
 *     ok: true,
 *     overallVerdict: "green" | "yellow" | "red",
 *     phases: {
 *       pl: { reconciliation, metrics },
 *       bs: { ... },
 *       kpi: { ... },
 *       cf: { ... },
 *     },
 *     recompute: { targets, ok, unknown, failed },
 *     durationMs
 *   }
 *
 * Why a single endpoint vs. four sister endpoints
 * ───────────────────────────────────────────────
 * Finance trust requires all-or-nothing semantics. Splitting the
 * import into four HTTP calls leaves the admin UI to coordinate
 * mid-flight failure recovery, which is impossible without compen-
 * sating transactions across tables. One endpoint = one logical
 * unit of work = one verdict.
 *
 * Auth: admin role. Rate-limit: 3 calls / hour / org — imports are
 * expensive (xlsx parse + 4 prisma transactions + recompute fan-out)
 * and finance users don't realistically need more than a few per
 * day.
 */
import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"
import {
  parsePlfPlSheet,
  parsePlfCfSheet,
} from "@/lib/onboarding/adapters/azseker-plf"
import { parseWorkbookBsSheet } from "@/lib/onboarding/adapters/azseker-workbook-bs"
import {
  parseWorkbookFarmingKpiSheet,
  parseWorkbookProcessingKpiSheet,
} from "@/lib/onboarding/adapters/azseker-workbook-kpi"
import {
  parseFarmingSalesSheet,
  parseProductionSalesSheet,
  parseProMaltSalesSheet,
} from "@/lib/onboarding/adapters/azseker-workbook-sales"
import {
  runImportBatch,
  type ImportBatchRow,
} from "@/lib/onboarding/import-batch"
import {
  runBalanceSheetBatch,
  type BsImportRow,
} from "@/lib/onboarding/bs-import-batch"
import {
  runKpiBatch,
  type KpiImportRow,
} from "@/lib/onboarding/kpi-import-batch"
import {
  runCashFlowBatch,
  type CfImportRow,
} from "@/lib/onboarding/cf-import-batch"
import {
  buildReconKey,
  type ReconciliationKey,
} from "@/lib/onboarding/reconciliation"

export const maxDuration = 60

const RATE_LIMIT = { name: "import-workbook", max: 3, windowMs: 60 * 60_000 }
const CF_SOURCE_TAG = "azseker-workbook-cf"
const ENTITIES = [
  { code: "AZSEKER-CPC", plSheet: "PLF CPC", bsSheet: "BS CPC", cfSheet: "CF CPC" },
  { code: "AZSEKER-AZSF", plSheet: "PLF AZSF", bsSheet: "BS AZSF", cfSheet: "CF AZSF" },
  { code: "AZSEKER-EDEN", plSheet: "PLF EDEN", bsSheet: "BS EDEN", cfSheet: "CF EDEN" },
  { code: "AZSEKER-MALT", plSheet: "PL Malt", bsSheet: "BS Malt", cfSheet: "CF Malt" },
]
const DEFAULT_PLAN_NAME = "Azərşəkər 2026 Budget"

export async function POST(request: NextRequest) {
  const t0 = Date.now()
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId
  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${orgId}:${session.userId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  // ── Parse multipart form ─────────────────────────────────────
  let form: FormData
  try {
    form = await request.formData()
  } catch (err) {
    return NextResponse.json(
      {
        error: `Body must be multipart/form-data: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    )
  }
  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Field `file` is required (xlsx blob)" },
      { status: 400 },
    )
  }
  const year = Number(form.get("year") ?? 2026)
  if (!Number.isInteger(year) || year < 2020 || year > 2050) {
    return NextResponse.json(
      { error: "Field `year` must be an integer 2020-2050" },
      { status: 400 },
    )
  }
  const purge =
    form.get("purge") === "1" || form.get("purge") === "true"
  const entityFilterRaw = form.get("entityFilter")
  const entityFilter =
    typeof entityFilterRaw === "string" && entityFilterRaw.length > 0
      ? entityFilterRaw
      : null

  const targetEntities = entityFilter
    ? ENTITIES.filter((e) => e.code === entityFilter)
    : ENTITIES
  if (targetEntities.length === 0) {
    return NextResponse.json(
      { error: `Unknown entityFilter: ${entityFilter}` },
      { status: 400 },
    )
  }

  // ── Resolve companies + plan ─────────────────────────────────
  const companies = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      code: { in: targetEntities.map((e) => e.code) },
    },
    select: { id: true, code: true },
  })
  const byCode = new Map<string, { id: string; code: string }>(
    companies.map((c: { id: string; code: string }) => [c.code, c]),
  )
  for (const ent of targetEntities) {
    if (!byCode.has(ent.code)) {
      return NextResponse.json(
        { error: `Company ${ent.code} not in DB — seed it first` },
        { status: 409 },
      )
    }
  }
  let plan = await prisma.budgetPlan.findFirst({
    where: {
      organizationId: orgId,
      year,
      name: DEFAULT_PLAN_NAME,
      deletedAt: null,
    },
    select: { id: true },
  })
  if (!plan) {
    plan = await prisma.budgetPlan.create({
      data: {
        organizationId: orgId,
        year,
        name: DEFAULT_PLAN_NAME,
        periodType: "annual",
        status: "draft",
      },
      select: { id: true },
    })
  }

  // ── Read workbook from upload ─────────────────────────────────
  let wb: XLSX.WorkBook
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    wb = XLSX.read(buf, { cellFormula: false, cellHTML: false, cellDates: false })
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse xlsx: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    )
  }

  const sourceDocument = file instanceof File ? file.name : "uploaded.xlsx"
  const periodScope = Array.from(
    { length: 12 },
    (_, m) => `${year}-${String(m + 1).padStart(2, "0")}`,
  )

  // ── Phase P&L ────────────────────────────────────────────────
  const plRows: ImportBatchRow[] = []
  const plExpected = new Map<ReconciliationKey, number>()
  for (const ent of targetEntities) {
    const result = parsePlfPlSheet(wb, ent.plSheet, XLSX, { preferYear: year })
    for (const line of result.lines) {
      for (let m = 0; m < 12; m++) {
        const amount = line.perMonth[m]
        if (amount === 0) continue
        const period = `${year}-${String(m + 1).padStart(2, "0")}`
        const row: ImportBatchRow = {
          companyId: byCode.get(ent.code)!.id,
          category: `${ent.code}-${line.code}`,
          lineType: line.accountType,
          period,
          monthIndex: m,
          plannedAmount: amount,
          currencyCode: "AZN",
          exchangeRate: null,
          planId: plan.id,
          sourceCell: `${sourceDocument}#${ent.plSheet}!${line.code}@${period}`,
        }
        plRows.push(row)
        const key = buildReconKey(ent.code, row.category, period)
        plExpected.set(key, (plExpected.get(key) ?? 0) + amount)
      }
    }
  }
  const plResult = await runImportBatch(prisma, {
    organizationId: orgId,
    label: `WB P&L ${year}`,
    actorUserId: session.userId,
    sourceDocument,
    companyIds: targetEntities.map((e) => byCode.get(e.code)!.id),
    periodScope,
    rows: plRows,
    expectedSums: plExpected,
    purgeArchivedFirst: purge,
  })

  // ── Phase BS ─────────────────────────────────────────────────
  const bsRows: BsImportRow[] = []
  const bsExpected = new Map<ReconciliationKey, number>()
  for (const ent of targetEntities) {
    const bsRes = parseWorkbookBsSheet(wb, ent.bsSheet, XLSX, { preferYear: year })
    for (const line of bsRes.lines) {
      for (const [period, amount] of Object.entries(line.monthlyAmounts)) {
        if (amount === 0) continue
        if (!period.startsWith(String(year))) continue
        const month = Number(period.split("-")[1])
        if (!Number.isFinite(month)) continue
        const row: BsImportRow = {
          planId: plan.id,
          accountCode: `${ent.code}-${line.code}`,
          accountName: line.label,
          lineType: line.lineType,
          subType: line.subType,
          year,
          month,
          amount,
          sourceCell: `${sourceDocument}#${ent.bsSheet}!${line.code}@${period}`,
        }
        bsRows.push(row)
        const key = buildReconKey(plan.id, row.accountCode, period)
        bsExpected.set(key, (bsExpected.get(key) ?? 0) + amount)
      }
    }
  }
  const bsResult = await runBalanceSheetBatch(prisma, {
    organizationId: orgId,
    label: `WB BS ${year}`,
    actorUserId: session.userId,
    sourceDocument,
    planIds: [plan.id],
    periodScope,
    rows: bsRows,
    expectedSums: bsExpected,
    purgeArchivedFirst: purge,
  })

  // ── Phase KPI (KPI + Sales merged) ───────────────────────────
  const kpiRows: KpiImportRow[] = []
  const kpiExpected = new Map<ReconciliationKey, number>()
  const allCompanies = await prisma.company.findMany({
    where: { organizationId: orgId, code: { startsWith: "AZSEKER" } },
    select: { id: true, code: true },
  })
  const allById = new Map<string, string>(
    allCompanies.map((c: { id: string; code: string }) => [c.code, c.id]),
  )
  const farmingKpi = parseWorkbookFarmingKpiSheet(wb, "Farming KPI", XLSX, {
    preferYear: year,
  })
  const cpcKpi = parseWorkbookProcessingKpiSheet(wb, "CPC KPI", XLSX, {
    preferYear: year,
  })
  for (const fact of [...farmingKpi.facts, ...cpcKpi.facts]) {
    const companyId = allById.get(fact.companyCode)
    if (!companyId) continue
    if (!fact.date.startsWith(String(year))) continue
    kpiRows.push({
      companyId,
      metric: fact.metric,
      date: fact.date,
      value: fact.value,
      unit: fact.unit || null,
      source: "xlsx_import",
    })
    const key = buildReconKey(companyId, fact.metric, fact.date)
    kpiExpected.set(key, (kpiExpected.get(key) ?? 0) + fact.value)
  }
  // Sales attribution (confirmed by Azik 2026-05-19):
  //   Farming Sales → AZSEKER-EDEN (Eden Agro does the farming)
  //   Production Sales → AZSEKER-CPC (food_processing main facility)
  //   ProMalt Sales → AZSEKER-PROMALT (Promalt MMC, separate legal entity)
  //
  // AZSEKER-PROMALT bug-fix (Phase 7.M Tier 4): it's NOT in `ENTITIES`
  // (no PL/BS/CF sheets in workbook), so `byCode` doesn't have it.
  // Look it up separately.
  const edenId = byCode.get("AZSEKER-EDEN")?.id
  const cpcId = byCode.get("AZSEKER-CPC")?.id
  const promaltCompany = await prisma.company.findFirst({
    where: { organizationId: orgId, code: "AZSEKER-PROMALT" },
    select: { id: true },
  })
  const promaltId = promaltCompany?.id
  const salesAdapters = [
    edenId
      ? parseFarmingSalesSheet(wb, "Farming Budget sales plan", XLSX, {
          preferYear: year,
          companyId: edenId,
        })
      : null,
    cpcId
      ? parseProductionSalesSheet(wb, "Production Budget sales plan", XLSX, {
          preferYear: year,
          companyId: cpcId,
        })
      : null,
    promaltId
      ? parseProMaltSalesSheet(wb, "Satış ProMalt", XLSX, {
          preferYear: year,
          companyId: promaltId,
        })
      : null,
  ]
  const adapterCompanyIds = [edenId, cpcId, promaltId]
  for (let i = 0; i < salesAdapters.length; i++) {
    const sales = salesAdapters[i]
    const cid = adapterCompanyIds[i]
    if (!sales || !cid) continue
    for (const fact of sales.facts) {
      kpiRows.push({
        companyId: cid,
        metric: fact.metric,
        date: fact.date,
        value: fact.value,
        unit: fact.unit,
        source: "xlsx_import",
      })
    }
    for (const [k, v] of sales.expectedSums) {
      kpiExpected.set(k, (kpiExpected.get(k) ?? 0) + v)
    }
  }
  const kpiResult = await runKpiBatch(prisma, {
    organizationId: orgId,
    label: `WB KPI+Sales ${year}`,
    actorUserId: session.userId,
    sourceDocument,
    companyIds: Array.from(allById.values()),
    dateScope: [String(year)],
    rows: kpiRows,
    expectedSums: kpiExpected,
  })

  // ── Phase CF ─────────────────────────────────────────────────
  const cfRows: CfImportRow[] = []
  const cfExpected = new Map<ReconciliationKey, number>()
  for (const ent of targetEntities) {
    const cfRes = parsePlfCfSheet(wb, ent.cfSheet, XLSX, { preferYear: year })
    for (const entry of cfRes.entries) {
      for (let m = 0; m < 12; m++) {
        const amount = entry.perMonth[m]
        if (amount === 0) continue
        const period = `${year}-${String(m + 1).padStart(2, "0")}`
        const sourceId = `${ent.code}::${entry.code}`
        const row: CfImportRow = {
          entityCode: ent.code,
          cfCode: entry.code,
          category: `${ent.code}-${entry.code}`,
          activityType: entry.activityType,
          entryType: entry.entryType,
          year,
          month: m + 1,
          amount,
          currencyCode: "AZN",
          description: entry.label,
          source: CF_SOURCE_TAG,
          sourceId,
        }
        cfRows.push(row)
        const key = buildReconKey(CF_SOURCE_TAG, sourceId, period)
        cfExpected.set(key, (cfExpected.get(key) ?? 0) + amount)
      }
    }
  }
  const cfResult = await runCashFlowBatch(prisma, {
    organizationId: orgId,
    label: `WB CF ${year}`,
    actorUserId: session.userId,
    sourceDocument,
    sourceTag: CF_SOURCE_TAG,
    periodScope,
    rows: cfRows,
    expectedSums: cfExpected,
    purgeArchivedFirst: purge,
  })

  // ── Recompute ────────────────────────────────────────────────
  const recompute = await runRecomputeForCompanies(
    prisma,
    orgId,
    targetEntities.map((e) => ({
      companyId: byCode.get(e.code)!.id,
      year,
    })),
  )

  // ── Verdict ──────────────────────────────────────────────────
  const verdicts = [
    plResult.reconciliation.verdict,
    bsResult.reconciliation.verdict,
    kpiResult.reconciliation.verdict,
    cfResult.reconciliation.verdict,
  ]
  const rank = { green: 0, yellow: 1, red: 2 } as const
  const overall = verdicts.reduce(
    (acc, v) => (rank[v] > rank[acc] ? v : acc),
    "green" as "green" | "yellow" | "red",
  )

  return NextResponse.json({
    ok: true,
    overallVerdict: overall,
    durationMs: Date.now() - t0,
    phases: {
      pl: { reconciliation: plResult.reconciliation, metrics: plResult.metrics },
      bs: { reconciliation: bsResult.reconciliation, metrics: bsResult.metrics },
      kpi: { reconciliation: kpiResult.reconciliation, metrics: kpiResult.metrics },
      cf: { reconciliation: cfResult.reconciliation, metrics: cfResult.metrics },
    },
    recompute: {
      targets: recompute.targets,
      ok: recompute.ok,
      unknown: recompute.unknown,
      failed: recompute.failed,
    },
  })
}
