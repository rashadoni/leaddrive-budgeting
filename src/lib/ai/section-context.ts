/**
 * Per-section data collectors. Each returns a compact JSON blob that Claude
 * reads as `<section_data>`. Collectors reuse the same Prisma queries that
 * power the visible UI tabs so the AI sees exactly the numbers the user sees.
 */

import { prisma } from "@/lib/prisma"
import {
  deriveRoleFromCode,
  isContraRevenueCode,
  pnlSectionFromRole,
} from "@/lib/budgeting/coa-role"

export type Section =
  | "pnl-report"
  | "pl"
  | "balance-sheet"
  | "cogs"
  | "cash-flow"
  | "assumptions"
  | "workspace"
  | "forecast"

export const SECTION_LABELS: Record<Section, string> = {
  "pnl-report": "P&L Report",
  "pl": "P&L (Plan)",
  "balance-sheet": "Balance Sheet",
  "cogs": "COGS",
  "cash-flow": "Cash Flow",
  "assumptions": "Assumptions",
  "workspace": "Workspace Overview",
  "forecast": "Forecast",
}

function isParent(code: string, allCodes: Set<string>): boolean {
  for (const c of allCodes) {
    if (c !== code && c.startsWith(code + "-")) return true
  }
  return false
}

async function verifyPlan(orgId: string, planId: string) {
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId, deletedAt: null },
    select: { id: true, name: true, year: true, periodType: true, status: true },
  })
  if (!plan) throw new Error("Plan not found or not accessible")
  return plan
}

/** Light wrapper around the budget-line math used by the P&L Report. */
async function computePL(orgId: string, planId: string) {
  const lines = await prisma.budgetLine.findMany({
    where: { organizationId: orgId, planId },
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
    const name = l.account?.name ?? l.category ?? code
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

async function computeBalanceSheet(orgId: string, planId: string) {
  const plan = await verifyPlan(orgId, planId)
  const rows = await prisma.balanceSheetLine.findMany({
    where: { organizationId: orgId, planId },
  })
  const byType = { asset: 0, liability: 0, equity: 0 } as Record<string, number>
  const decOnly: Record<string, Record<string, number>> = { asset: {}, liability: {}, equity: {} }
  for (const r of rows) {
    if (r.month !== 12) continue
    byType[r.lineType] = (byType[r.lineType] ?? 0) + r.amount
    const bucket = decOnly[r.lineType] ?? {}
    bucket[r.accountName] = (bucket[r.accountName] ?? 0) + r.amount
    decOnly[r.lineType] = bucket
  }
  const top = (bucket: Record<string, number>) =>
    Object.entries(bucket)
      .map(([name, amt]) => ({ name, amount: Math.round(amt) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 8)

  return {
    plan,
    totalsDec: {
      assets: Math.round(byType.asset ?? 0),
      liabilities: Math.round(Math.abs(byType.liability ?? 0)),
      equity: Math.round(byType.equity ?? 0),
      debtToEquity: byType.equity ? +(Math.abs(byType.liability ?? 0) / Math.abs(byType.equity)).toFixed(2) : null,
    },
    topAssets: top(decOnly.asset ?? {}),
    topLiabilities: top(decOnly.liability ?? {}),
    topEquity: top(decOnly.equity ?? {}),
  }
}

async function computeCOGS(orgId: string, planId: string) {
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
    totalCost,
    products,
    detailCount: details.length,
  }
}

async function computeCashFlow(orgId: string, planId: string) {
  const plan = await verifyPlan(orgId, planId)
  const entries = await prisma.cashFlowEntry.findMany({
    where: { organizationId: orgId, year: plan.year },
  })
  const byActivity: Record<string, number> = { operating: 0, investing: 0, financing: 0 }
  const byMonth: Record<number, number> = {}
  for (const e of entries) {
    const act = e.activityType || "operating"
    byActivity[act] = (byActivity[act] ?? 0) + (e.entryType === "outflow" ? -e.amount : e.amount)
    byMonth[e.month] = (byMonth[e.month] ?? 0) + (e.entryType === "outflow" ? -e.amount : e.amount)
  }
  return {
    plan,
    byActivity: Object.fromEntries(Object.entries(byActivity).map(([k, v]) => [k, Math.round(v)])),
    monthly: Object.fromEntries(Object.entries(byMonth).map(([k, v]) => [k, Math.round(v)])),
    netCashFlow: Math.round(Object.values(byActivity).reduce((s, v) => s + v, 0)),
  }
}

async function computeAssumptions(orgId: string, planId: string) {
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
    count: rows.length,
    byCategory: Object.fromEntries(
      Object.entries(grouped).map(([k, v]) => [k, v.slice(0, 10)]),
    ),
  }
}

async function computeWorkspace(orgId: string, planId: string) {
  const [pl, bs, cogs] = await Promise.all([
    computePL(orgId, planId),
    computeBalanceSheet(orgId, planId),
    computeCOGS(orgId, planId),
  ])
  return {
    plan: pl.plan,
    profitability: pl.totals,
    balanceSheetDec: bs.totalsDec,
    cogsTotal: cogs.totalCost,
    topProducts: cogs.products.slice(0, 5),
  }
}

async function computeForecast(orgId: string, planId: string) {
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
    totals: Object.fromEntries(Object.entries(byLineType).map(([k, v]) => [k, Math.round(v)])),
    monthly: Object.fromEntries(Object.entries(byMonth).map(([k, v]) => [k, Math.round(v)])),
    entryCount: entries.length,
  }
}

export async function collectSectionContext(
  section: Section,
  orgId: string,
  planId: string,
): Promise<unknown> {
  switch (section) {
    case "pnl-report":
    case "pl":
      return computePL(orgId, planId)
    case "balance-sheet":
      return computeBalanceSheet(orgId, planId)
    case "cogs":
      return computeCOGS(orgId, planId)
    case "cash-flow":
      return computeCashFlow(orgId, planId)
    case "assumptions":
      return computeAssumptions(orgId, planId)
    case "workspace":
      return computeWorkspace(orgId, planId)
    case "forecast":
      return computeForecast(orgId, planId)
    default:
      throw new Error(`Unknown section: ${section}`)
  }
}
