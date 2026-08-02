/**
 * Per-section data collectors. Each returns a compact JSON blob that Claude
 * reads as `<section_data>`. Collectors reuse the same Prisma queries that
 * power the visible UI tabs so the AI sees exactly the numbers the user sees.
 */

// Stage 3 RLS — AI-narration read helper for the SSE ai-analytics route
// (a single withOrgScope tx can't span an LLM stream). Read-only, scoped
// by explicit organizationId; uses the BYPASSRLS admin client so it keeps
// working after the env-flip.
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import {
  deriveRoleFromCode,
  isContraRevenueCode,
  pnlSectionFromRole,
} from "@/lib/budgeting/coa-role"
// 14.7 (2026-08-03) — the balance-sheet collector reads through the SAME
// helpers as `/api/budgeting/balance-sheet`, because reimplementing them is
// exactly how it came to report zeros against a screen showing 364M.
import { resolveBalanceSheetSourcePlan } from "@/lib/budgeting/statement-plan-fallback"
import {
  resolveBalanceSheetScope,
  getBalanceSheetSectionData,
  getLatestBalanceSheetEvidenceMonth,
  normalizeBalanceSheetMonth,
  balanceSheetDebtToEquity,
} from "@/lib/budgeting/balance-sheet-evidence"
import type { Section } from "@/lib/ai/section-meta"

function isParent(code: string, allCodes: Set<string>): boolean {
  for (const c of allCodes) {
    if (c !== code && c.startsWith(code + "-")) return true
  }
  return false
}

async function verifyPlan(orgId: string, planId: string) {
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId, deletedAt: null },
    // `kind` (2026-08-03): the balance-sheet collector needs it to apply the
    // same budget→actuals fallback the visible tab applies. Harmless and
    // useful everywhere else — the LLM should know whether it is reading a
    // budget or an actuals plan.
    select: {
      id: true,
      name: true,
      year: true,
      kind: true,
      periodType: true,
      status: true,
    },
  })
  if (!plan) throw new Error("Plan not found or not accessible")
  return plan
}

/**
 * Phase 7.G — note attached to the AI's section context when the
 * user's selected company filter cannot be applied because the table
 * has no `companyId` column. The LLM uses this to qualify its
 * narrative ("balance-sheet data is plan-wide, not per-company; the
 * SPARK figures below reflect AZMADE's consolidated balance sheet").
 */
function scopeNote(
  companyName: string | null | undefined,
  tableHasCompanyId: boolean,
): string | null {
  if (!companyName) return null;
  if (tableHasCompanyId) {
    return `Scoped to company: ${companyName}.`;
  }
  return `User selected company ${companyName}, but this section's underlying table is plan-wide (no per-company breakdown). Numbers reflect the entire plan; mention this caveat in any per-company claim.`;
}

/** Light wrapper around the budget-line math used by the P&L Report. */
async function computePL(
  orgId: string,
  planId: string,
  companyId: string | null,
  companyName: string | null,
) {
  const lines = await prisma.budgetLine.findMany({
    where: {
      organizationId: orgId,
      planId,
      // Soft-delete: re-import archives prior rows (deletedAt set) under the
      // SAME planId, then re-inserts live ones. Without this filter the AI
      // narrative sums archived + live → inflated P&L (measured ×6.27 on live
      // AzerSheker data). Mirrors pnl/route.ts + analytics/route.ts.
      deletedAt: null,
      // Phase 7.G — when the user picked a specific company in the
      // budgeting page selector, scope BudgetLine reads to that
      // company so the AI sees the same numbers the visible UI shows.
      // BudgetLine.companyId is nullable; absence of a filter is the
      // "all consolidated" view.
      ...(companyId ? { companyId } : {}),
    },
    include: { account: { select: { code: true, name: true, accountType: true } } },
  })

  type Row = (typeof lines)[number]
  const codes = new Set<string>()
  for (const l of lines) {
    const code = l.account?.code ?? l.department ?? null
    if (code) codes.add(code)
  }
  const leaf = (l: Row) => {
    const code = l.account?.code ?? l.department ?? ""
    return !code || !isParent(code, codes)
  }

  const byCode = new Map<string, { code: string; name: string; total: number; lineType: string }>()
  for (const l of lines) {
    if (!leaf(l)) continue
    const code = l.account?.code ?? l.department ?? "other"
    const name = l.account?.name ?? code
    const key = `${code}||${l.lineType}`
    const existing = byCode.get(key) ?? { code, name, total: 0, lineType: l.lineType }
    existing.total += l.plannedAmount
    byCode.set(key, existing)
  }

  const rows = Array.from(byCode.values())

  // Phase 7.G Turn LXXV follow-up (architect FAIL closure): use canonical
  // `coa-role` helpers — single source of truth for prefix matching across
  // all 5 consumers (import-excel, pnl, PLTab, budget-pnl-view, this).
  // Architect Round-1 ⚠️: this file was the un-migrated 5th consumer in
  // the inventory; closed inline this same turn.
  const inSection = (target: "revenue" | "cogs" | "opex" | "belowEbitda") =>
    rows.filter((r) => pnlSectionFromRole(deriveRoleFromCode(r.code)) === target)

  const revRows = inSection("revenue")
  const revGross = revRows.filter((r) => !isContraRevenueCode(r.code)).reduce((s, r) => s + r.total, 0)
  const contra = revRows.filter((r) => isContraRevenueCode(r.code)).reduce((s, r) => s + r.total, 0)
  const netRevenue = revGross - contra
  const cogs = inSection("cogs").reduce((s, r) => s + r.total, 0)
  const opex = inSection("opex").reduce((s, r) => s + r.total, 0)
  const belowEbitda = inSection("belowEbitda").reduce((s, r) => s + r.total, 0)

  const grossProfit = netRevenue - cogs
  const ebitda = grossProfit - opex
  const netProfit = ebitda - belowEbitda

  return {
    plan: await verifyPlan(orgId, planId),
    scope: scopeNote(companyName, true),
    totals: {
      netRevenue: Math.round(netRevenue),
      grossSales: Math.round(revGross),
      contraRevenue: Math.round(contra),
      cogs: Math.round(cogs),
      opex: Math.round(opex),
      belowEbitda: Math.round(belowEbitda),
      grossProfit: Math.round(grossProfit),
      ebitda: Math.round(ebitda),
      netProfit: Math.round(netProfit),
      grossMarginPct: netRevenue > 0 ? +(grossProfit / netRevenue * 100).toFixed(2) : null,
      ebitdaMarginPct: netRevenue > 0 ? +(ebitda / netRevenue * 100).toFixed(2) : null,
      netMarginPct: netRevenue > 0 ? +(netProfit / netRevenue * 100).toFixed(2) : null,
    },
    topRows: rows.sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 20).map((r) => ({
      code: r.code,
      name: r.name,
      lineType: r.lineType,
      total: Math.round(r.total),
    })),
  }
}

/**
 * 14.7 (2026-08-03) — the AI told the owner his balance sheet was empty while
 * the table beside it showed 364,080,013 ₼ of assets.
 *
 * Three independent faults, each on its own sufficient to produce that screen,
 * and all three of the same kind: this collector re-implemented what
 * `/api/budgeting/balance-sheet` does instead of calling it.
 *
 *  1. **No budget→actuals fallback.** Budget plans in this app carry no
 *     balance sheet — the client's workbook has `BS Actual 2025` and
 *     `BS Actual 2026` and no budget BS tab at all. The visible tab resolves
 *     that (`resolveBalanceSheetSourcePlan`); this read `planId` literally.
 *     On production `Azərşəkər 2026 Budget` has 0 balance-sheet rows, so the
 *     LLM was handed zeros and said so, correctly, about the wrong plan.
 *  2. **`if (r.month !== 12) continue`.** The 2026 actuals run to May. Even
 *     after fixing (1) every total would still have been zero, and the fault
 *     would have looked fixed for 2025 — which has a December — and broken
 *     again every January.
 *  3. **All four entities summed, silently.** The column exists
 *     (`companyId`, Phase 7.O) and this ignored it, reproducing precisely the
 *     un-eliminated sum that Defect 3 removed from the screen: the workbook's
 *     own INTRAGROUP ELIMINATIONS block nets ~118M of intercompany holdings
 *     and receivables out of that 364M. Fixing (1) and (2) alone would have
 *     replaced "everything is zero" with a confident, sourceable, wrong number
 *     — the worse failure, because nobody checks a plausible one.
 *
 * So this now shares the resolution, the as-of month and the sign convention
 * with the tab, and it states its basis in the payload. `debtToEquity` comes
 * from `balanceSheetDebtToEquity`, which returns null on an un-eliminated sum
 * rather than a leverage ratio computed from double-counted equity.
 */
async function computeBalanceSheet(
  orgId: string,
  planId: string,
  companyId: string | null,
  companyName: string | null,
) {
  const plan = await verifyPlan(orgId, planId)

  // (1) Same source-plan resolution as the tab. Deterministic pick when >1
  // actuals plan exists for a year, matching balance-sheet/route.ts.
  let sourcePlanId = plan.id
  let fellBack = false
  if (plan.kind === "budget") {
    const actuals = await prisma.budgetPlan.findFirst({
      where: { organizationId: orgId, year: plan.year, kind: "actual", deletedAt: null },
      select: { id: true, kind: true },
      orderBy: { createdAt: "asc" },
    })
    const r = resolveBalanceSheetSourcePlan({ id: plan.id, kind: plan.kind }, actuals)
    sourcePlanId = r.sourcePlanId
    fellBack = r.fellBack
  }

  // (3) Same company resolution as the tab: an explicit company drills into
  // its standalone sheet; otherwise the single level-1 holding's own
  // consolidated rows are preferred over adding the children together.
  const level1 = await prisma.company.findMany({
    where: { organizationId: orgId, level: 1 },
    select: { id: true, name: true },
    take: 2,
  })
  const holding = level1.length === 1 ? level1[0] : null
  let companyFilter: { companyId?: string } = {}
  let holdingConsolidated = false
  if (companyId) {
    companyFilter = { companyId }
  } else if (holding) {
    const holdingLines = await prisma.balanceSheetLine.count({
      where: {
        organizationId: orgId,
        planId: sourcePlanId,
        companyId: holding.id,
        deletedAt: null,
      },
    })
    if (holdingLines > 0) {
      companyFilter = { companyId: holding.id }
      holdingConsolidated = true
    }
  }

  // Phase 8 D3 (2026-05-29) — Phase 2.1 dropped the `accountName` String
  // column from BalanceSheetLine; the canonical name lives on the
  // ChartOfAccount FK. Without the include + relation read, `r.accountName`
  // was `undefined` at runtime (masked by `prisma: any`), so every line
  // collapsed into a single "undefined" bucket and the AI's per-account
  // balance-sheet breakdown was meaningless. Include the account, read
  // `account.name` (fall back to the code, then accountId).
  const rows = await prisma.balanceSheetLine.findMany({
    where: { organizationId: orgId, planId: sourcePlanId, deletedAt: null, ...companyFilter },
    include: { account: { select: { code: true, name: true } } },
  })

  const scope = resolveBalanceSheetScope(rows, { holdingConsolidated })

  // (2) As-of month = the latest month with evidence, not a hardcoded 12.
  const assetSec = getBalanceSheetSectionData(rows.filter((r) => r.lineType === "asset"))
  const liabSec = getBalanceSheetSectionData(rows.filter((r) => r.lineType === "liability"))
  const eqSec = getBalanceSheetSectionData(rows.filter((r) => r.lineType === "equity"))
  const asOfMonth = getLatestBalanceSheetEvidenceMonth(assetSec, liabSec, eqSec)
  const norm =
    asOfMonth === null
      ? null
      : normalizeBalanceSheetMonth(assetSec, liabSec, eqSec, asOfMonth, scope)

  // Rows are stored in the workbook's trial-balance convention (liabilities
  // and equity negative) about as often as not. `normalizeBalanceSheetMonth`
  // decides which it is from the residual; the per-account breakdown has to
  // follow the same decision or the details will contradict the totals.
  const factor = norm?.convention === "trial_balance" ? -1 : 1
  const bucketFor = (lineType: string, sign: number) => {
    const bucket: Record<string, number> = {}
    for (const r of rows) {
      if (r.lineType !== lineType || r.month !== asOfMonth) continue
      const acctName = r.account?.name ?? r.account?.code ?? r.accountId
      bucket[acctName] = (bucket[acctName] ?? 0) + r.amount * sign
    }
    return Object.entries(bucket)
      .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 8)
  }

  return {
    plan,
    scope: scopeNote(companyName, Boolean(companyId)),
    /**
     * Where these numbers came from, in the payload rather than in a comment,
     * so the LLM can say it and cannot present a fallback as the plan's own.
     */
    source: {
      readFromPlanId: sourcePlanId,
      fellBackToActuals: fellBack,
      note: fellBack
        ? `The selected plan is a BUDGET and carries no balance sheet; these figures are the ${plan.year} ACTUALS balance sheet. Say so before quoting them.`
        : null,
      asOfMonth,
      asOfNote:
        asOfMonth === null
          ? "No balance-sheet rows exist for this plan at all. Do not infer that assets are zero — say the balance sheet has not been loaded."
          : `Positions are as of month ${asOfMonth} of ${plan.year}, the latest month with data — NOT a year-end position.`,
      rowCount: rows.length,
    },
    /**
     * Defect 3 — what the totals ARE. `sum_of_entities` means several legal
     * entities were added with nothing eliminated; it is not a group balance
     * sheet and must not be described as one.
     */
    basis: {
      kind: scope.basis,
      entityCount: scope.entityCount,
      eliminationsApplied: scope.eliminationsApplied,
      note:
        scope.basis === "sum_of_entities"
          ? `These totals ADD ${scope.entityCount} legal entities together with NO intercompany eliminations. Intragroup investments and receivables are counted twice. State this caveat, do not call it a consolidated balance sheet, and do not compute leverage ratios from it.`
          : null,
    },
    totals: {
      asOfMonth,
      assets: norm?.assets === null || norm === null ? null : Math.round(norm.assets),
      liabilities: norm?.liabilities == null ? null : Math.round(norm.liabilities),
      equity: norm?.equity == null ? null : Math.round(norm.equity),
      signConvention: norm?.convention ?? null,
      debtToEquity: norm
        ? balanceSheetDebtToEquity({
            liabilities: norm.liabilities,
            equity: norm.equity,
            eliminationsApplied: norm.eliminationsApplied,
          })
        : null,
    },
    topAssets: bucketFor("asset", 1),
    topLiabilities: bucketFor("liability", factor),
    topEquity: bucketFor("equity", factor),
  }
}

async function computeCOGS(
  orgId: string,
  planId: string,
  _companyId: string | null,
  companyName: string | null,
) {
  const plan = await verifyPlan(orgId, planId)
  const [cogsLines, details] = await Promise.all([
    prisma.cOGSBudgetLine.findMany({
      where: { organizationId: orgId, planId },
      include: { productLine: { select: { name: true, code: true, unit: true } } },
    }),
    prisma.cOGSCostDetail.findMany({
      where: { organizationId: orgId, planId },
    }),
  ])
  const perProduct = new Map<string, { name: string; unit: string; qty: number; cost: number }>()
  for (const l of cogsLines) {
    const key = l.productLineId
    const p = perProduct.get(key) ?? { name: l.productLine.name, unit: l.productLine.unit, qty: 0, cost: 0 }
    p.qty += l.productionQty
    p.cost += l.totalCost
    perProduct.set(key, p)
  }
  const products = Array.from(perProduct.values())
    .map((p) => ({
      name: p.name,
      unit: p.unit,
      productionQty: Math.round(p.qty),
      totalCost: Math.round(p.cost),
      unitCost: p.qty > 0 ? +(p.cost / p.qty).toFixed(2) : null,
    }))
    .sort((a, b) => b.totalCost - a.totalCost)
  const totalCost = products.reduce((s, p) => s + p.totalCost, 0)
  return {
    plan,
    scope: scopeNote(companyName, false),
    totalCost,
    products,
    detailCount: details.length,
  }
}

async function computeCashFlow(
  orgId: string,
  planId: string,
  _companyId: string | null,
  companyName: string | null,
) {
  const plan = await verifyPlan(orgId, planId)
  const entries = await prisma.cashFlowEntry.findMany({
    where: { organizationId: orgId, year: plan.year, deletedAt: null },
  })
  const byActivity: Record<string, number> = { operating: 0, investing: 0, financing: 0 }
  const byMonth: Record<number, number> = {}
  for (const e of entries) {
    // CF.04–CF.07 are reconciliation bridge evidence. Feeding them into the
    // movement narrative would count net/opening/closing cash twice.
    if (e.activityType === "bridge") continue
    const act = e.activityType || "operating"
    byActivity[act] = (byActivity[act] ?? 0) + (e.entryType === "outflow" ? -e.amount : e.amount)
    byMonth[e.month] = (byMonth[e.month] ?? 0) + (e.entryType === "outflow" ? -e.amount : e.amount)
  }
  return {
    plan,
    scope: scopeNote(companyName, false),
    byActivity: Object.fromEntries(Object.entries(byActivity).map(([k, v]) => [k, Math.round(v)])),
    monthly: Object.fromEntries(Object.entries(byMonth).map(([k, v]) => [k, Math.round(v)])),
    netCashFlow: Math.round(Object.values(byActivity).reduce((s, v) => s + v, 0)),
  }
}

async function computeAssumptions(
  orgId: string,
  planId: string,
  _companyId: string | null,
  companyName: string | null,
) {
  const plan = await verifyPlan(orgId, planId)
  const rows = await prisma.budgetAssumption.findMany({
    where: { organizationId: orgId, planId },
    orderBy: { sortOrder: "asc" },
  })
  const grouped: Record<string, Array<{ label: string; value: number; unit: string | null }>> = {}
  for (const r of rows) {
    const cat = r.category ?? "other"
    ;(grouped[cat] ??= []).push({ label: r.label, value: r.value, unit: r.unit })
  }
  return {
    plan,
    scope: scopeNote(companyName, false),
    count: rows.length,
    byCategory: Object.fromEntries(
      Object.entries(grouped).map(([k, v]) => [k, v.slice(0, 10)]),
    ),
  }
}

async function computeWorkspace(
  orgId: string,
  planId: string,
  companyId: string | null,
  companyName: string | null,
) {
  const [pl, bs, cogs] = await Promise.all([
    computePL(orgId, planId, companyId, companyName),
    computeBalanceSheet(orgId, planId, companyId, companyName),
    computeCOGS(orgId, planId, companyId, companyName),
  ])
  return {
    plan: pl.plan,
    // Workspace mixes per-company P&L with plan-wide COGS — relay every
    // note so the LLM doesn't claim a SPARK-specific COGS breakdown.
    scope: pl.scope,
    scopeNotes: {
      pl: pl.scope,
      balanceSheet: bs.scope,
      cogs: cogs.scope,
    },
    profitability: pl.totals,
    // 14.7 — was `balanceSheetDec`, a December-only snapshot that is empty for
    // every in-flight year. Carries its own source + basis now, for the same
    // reason the balance-sheet section does: this summary is where a wrong
    // total is least likely to be questioned.
    balanceSheet: {
      ...bs.totals,
      source: bs.source,
      basis: bs.basis,
    },
    cogsTotal: cogs.totalCost,
    topProducts: cogs.products.slice(0, 5),
  }
}

async function computeForecast(
  orgId: string,
  planId: string,
  _companyId: string | null,
  companyName: string | null,
) {
  const plan = await verifyPlan(orgId, planId)
  const entries = await prisma.budgetForecastEntry.findMany({
    where: { organizationId: orgId, planId },
  })
  const byLineType: Record<string, number> = {}
  const byMonth: Record<number, number> = {}
  for (const e of entries) {
    byLineType[e.lineType] = (byLineType[e.lineType] ?? 0) + e.forecastAmount
    byMonth[e.month] = (byMonth[e.month] ?? 0) + e.forecastAmount
  }
  return {
    plan,
    scope: scopeNote(companyName, false),
    totals: Object.fromEntries(Object.entries(byLineType).map(([k, v]) => [k, Math.round(v)])),
    monthly: Object.fromEntries(Object.entries(byMonth).map(([k, v]) => [k, Math.round(v)])),
    entryCount: entries.length,
  }
}

export async function collectSectionContext(
  section: Section,
  orgId: string,
  planId: string,
  companyId: string | null,
  companyName: string | null,
): Promise<unknown> {
  switch (section) {
    case "pnl-report":
    case "pl":
      return computePL(orgId, planId, companyId, companyName)
    case "balance-sheet":
      return computeBalanceSheet(orgId, planId, companyId, companyName)
    case "cogs":
      return computeCOGS(orgId, planId, companyId, companyName)
    case "cash-flow":
      return computeCashFlow(orgId, planId, companyId, companyName)
    case "assumptions":
      return computeAssumptions(orgId, planId, companyId, companyName)
    case "workspace":
      return computeWorkspace(orgId, planId, companyId, companyName)
    case "forecast":
      return computeForecast(orgId, planId, companyId, companyName)
    default:
      throw new Error(`Unknown section: ${section}`)
  }
}
