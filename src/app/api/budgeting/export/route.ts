import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getOrgId } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { loadAndCompute } from "@/lib/cost-model/db"
import { resolveCostModelKey } from "@/lib/budgeting/cost-model-map"
import { currentBakuYearMonth } from "@/lib/risk/periods"
import ExcelJS from "exceljs"

// Phase 8 D3 (2026-05-28) — typed shapes for the four Prisma queries
// at the top of GET. Replaces the 38 `(l as any).account` /
// `line.isAutoActual` / `a.actualAmount` casts that
// were undoing the type safety Prisma already provides.
type BudgetLineWithAccount = Prisma.BudgetLineGetPayload<{
  include: { account: { select: { code: true; name: true } } }
}>
type BudgetActualRow = Prisma.BudgetActualGetPayload<true>
type BudgetForecastEntryRow = Prisma.BudgetForecastEntryGetPayload<true>

// ── Color palette ────────────────────────────────────────────────────────────
const PURPLE = "FF6D28D9"
const PURPLE_LIGHT = "FFEDE9FE"
const GREEN = "FF16A34A"
const GREEN_BG = "FFF0FDF4"
const RED = "FFDC2626"
const RED_BG = "FFFEF2F2"
const AMBER = "FFF59E0B"
const AMBER_BG = "FFFFFBEB"
const GRAY_HEADER = "FFF8FAFC"
const GRAY_BORDER = "FFE2E8F0"
const DARK_TEXT = "FF1E293B"
const MUTED_TEXT = "FF64748B"

// ── Reusable styles ──────────────────────────────────────────────────────────
const currFmt = '#,##0.00" ₼"'
const pctFmt = "0.0%"

function headerStyle(): Partial<ExcelJS.Style> {
  return {
    font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: PURPLE } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: {
      bottom: { style: "thin", color: { argb: PURPLE } },
    },
  }
}

function sectionHeaderStyle(): Partial<ExcelJS.Style> {
  return {
    font: { bold: true, color: { argb: DARK_TEXT }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: PURPLE_LIGHT } },
    alignment: { horizontal: "left", vertical: "middle" },
    border: {
      bottom: { style: "thin", color: { argb: PURPLE } },
      top: { style: "thin", color: { argb: PURPLE } },
    },
  }
}

function totalRowStyle(): Partial<ExcelJS.Style> {
  return {
    font: { bold: true, color: { argb: DARK_TEXT }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_HEADER } },
    border: {
      top: { style: "double", color: { argb: DARK_TEXT } },
      bottom: { style: "thin", color: { argb: GRAY_BORDER } },
    },
  }
}

function applyHeaderRow(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1)
  row.height = 28
  row.eachCell((cell) => {
    Object.assign(cell, headerStyle())
  })
}

function freezeFirstRow(ws: ExcelJS.Worksheet) {
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }]
}

function autoFilter(ws: ExcelJS.Worksheet, colCount: number) {
  const lastCol = String.fromCharCode(64 + colCount)
  ws.autoFilter = { from: "A1", to: `${lastCol}1` }
}

function varianceColor(value: number): { font: Partial<ExcelJS.Font>; fill: Partial<ExcelJS.Fill> } {
  if (value > 0) return {
    font: { color: { argb: GREEN }, bold: false },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_BG } },
  }
  if (value < 0) return {
    font: { color: { argb: RED }, bold: false },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: RED_BG } },
  }
  return {
    font: { color: { argb: MUTED_TEXT }, bold: false },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } },
  }
}

function addVarianceCell(row: ExcelJS.Row, colKey: string | number, value: number) {
  const cell = row.getCell(colKey)
  cell.numFmt = currFmt
  const vc = varianceColor(value)
  cell.font = vc.font
  cell.fill = vc.fill as ExcelJS.Fill
}

function addPctVarianceCell(row: ExcelJS.Row, colKey: string | number, value: number) {
  const cell = row.getCell(colKey)
  cell.numFmt = pctFmt
  cell.value = value / 100 // Excel expects 0.xx for percent
  const vc = varianceColor(value)
  cell.font = vc.font
  cell.fill = vc.fill as ExcelJS.Fill
}

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  // Stage 3 RLS — DB reads in the org-scoped tx; the heavy ExcelJS
  // workbook build runs OUTSIDE the tx (pure CPU, no DB).
  const [plan, lines, manualActuals, forecastEntries] = await withOrgScope(orgId, async (tx) => {
    const plan = await tx.budgetPlan.findFirst({ where: { id: planId, organizationId: orgId } })
    const lines = await tx.budgetLine.findMany({ where: { planId, organizationId: orgId, deletedAt: null }, orderBy: { sortOrder: "asc" }, include: { account: { select: { code: true, name: true } } } })
    const manualActuals = await tx.budgetActual.findMany({ where: { planId, organizationId: orgId }, orderBy: { createdAt: "asc" } })
    const forecastEntries = await tx.budgetForecastEntry.findMany({ where: { planId, organizationId: orgId }, orderBy: [{ year: "asc" }, { month: "asc" }] })
    return [plan, lines, manualActuals, forecastEntries] as const
  })

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  // Load cost model only if needed
  const hasAutoActual = lines.some((l: BudgetLineWithAccount) => l.isAutoActual)
  const costModel = hasAutoActual ? await loadAndCompute(orgId).catch(() => null) : null

  // ── Compute all financials ─────────────────────────────────────────────────
  const expenseLines = lines.filter((l: BudgetLineWithAccount) => l.lineType === "expense")
  const revenueLines = lines.filter((l: BudgetLineWithAccount) => l.lineType === "revenue")
  const cogsLines = lines.filter((l: BudgetLineWithAccount) => l.lineType === "cogs")

  const totalExpensePlanned = expenseLines.reduce((s: number, l: BudgetLineWithAccount) => s + l.plannedAmount, 0)
  const totalRevenuePlanned = revenueLines.reduce((s: number, l: BudgetLineWithAccount) => s + l.plannedAmount, 0)
  const totalCOGSPlanned = cogsLines.reduce((s: number, l: BudgetLineWithAccount) => s + l.plannedAmount, 0)

  const totalExpenseForecast = expenseLines.reduce((s: number, l: BudgetLineWithAccount) => s + (l.forecastAmount ?? l.plannedAmount), 0)
  const totalRevenueForecast = revenueLines.reduce((s: number, l: BudgetLineWithAccount) => s + (l.forecastAmount ?? l.plannedAmount), 0)
  const totalCOGSForecast = cogsLines.reduce((s: number, l: BudgetLineWithAccount) => s + (l.forecastAmount ?? l.plannedAmount), 0)

  // ForecastEntry overrides
  const feRevenue = forecastEntries.filter((e: BudgetForecastEntryRow) => e.lineType === "revenue")
  const feExpense = forecastEntries.filter((e: BudgetForecastEntryRow) => e.lineType === "expense")
  const feCogs = forecastEntries.filter((e: BudgetForecastEntryRow) => e.lineType === "cogs")
  const totalRevenueForecastFE = feRevenue.length > 0 ? feRevenue.reduce((s: number, e: BudgetForecastEntryRow) => s + e.forecastAmount, 0) : totalRevenueForecast
  const totalExpenseForecastFE = feExpense.length > 0 ? feExpense.reduce((s: number, e: BudgetForecastEntryRow) => s + e.forecastAmount, 0) : totalExpenseForecast
  const totalCOGSForecastFE = feCogs.length > 0 ? feCogs.reduce((s: number, e: BudgetForecastEntryRow) => s + e.forecastAmount, 0) : totalCOGSForecast

  // Auto-actuals from cost model
  const autoActualByCategory = new Map<string, number>()
  let autoActualExpense = 0, autoActualRevenue = 0, autoActualCOGS = 0

  if (hasAutoActual && costModel && plan) {
    const { year: curYear, month: curMonth } = currentBakuYearMonth()
    let elapsedMonths = 1
    if (plan.periodType === "monthly") {
      elapsedMonths = 1
    } else if (plan.periodType === "quarterly" && plan.quarter) {
      const qStart = (plan.quarter - 1) * 3 + 1
      const qEnd = qStart + 2
      if (curYear > plan.year || (curYear === plan.year && curMonth > qEnd)) elapsedMonths = 3
      else if (curYear === plan.year && curMonth >= qStart) elapsedMonths = curMonth - qStart + 1
      else elapsedMonths = 0
    } else if (plan.periodType === "annual") {
      if (curYear > plan.year) elapsedMonths = 12
      else if (curYear === plan.year) elapsedMonths = curMonth
      else elapsedMonths = 0
    }

    for (const line of lines) {
      if (line.isAutoActual && line.costModelKey) {
        const monthlyAmount = resolveCostModelKey(costModel, line.costModelKey)
        const amount = monthlyAmount * elapsedMonths
        const key = `${line.account?.code ?? ""}||${line.lineType}`
        autoActualByCategory.set(key, (autoActualByCategory.get(key) ?? 0) + amount)
        if (line.lineType === "revenue") autoActualRevenue += amount
        else if (line.lineType === "cogs") autoActualCOGS += amount
        else autoActualExpense += amount
      }
    }
  }

  // Manual actuals split
  let manualExpenseActual = 0, manualRevenueActual = 0, manualCOGSActual = 0
  for (const a of manualActuals) {
    if (a.lineType === "revenue") manualRevenueActual += a.actualAmount
    else if (a.lineType === "cogs") manualCOGSActual += a.actualAmount
    else manualExpenseActual += a.actualAmount
  }

  const totalExpenseActual = autoActualExpense > 0 ? autoActualExpense : manualExpenseActual
  const totalRevenueActual = autoActualRevenue > 0 ? autoActualRevenue : manualRevenueActual
  const totalCOGSActual = autoActualCOGS > 0 ? autoActualCOGS : manualCOGSActual

  // P&L chain
  const grossProfitPlanned = totalRevenuePlanned - totalCOGSPlanned
  const grossProfitActual = totalRevenueActual - totalCOGSActual
  const grossProfitForecast = totalRevenueForecastFE - totalCOGSForecastFE
  const marginPlanned = grossProfitPlanned - totalExpensePlanned
  const marginActual = grossProfitActual - totalExpenseActual
  const marginForecast = grossProfitForecast - totalExpenseForecastFE
  const totalVariance = marginActual - marginPlanned
  const executionPct = marginPlanned !== 0 ? (marginActual / marginPlanned) * 100 : 0

  // ── Create Workbook ────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = "LeadDrive CRM"
  wb.created = new Date()
  wb.calcProperties = { fullCalcOnLoad: true }

  const periodLabel = plan.periodType === "annual"
    ? `${plan.year} (Annual)`
    : plan.periodType === "quarterly"
      ? `${plan.year} Q${plan.quarter}`
      : `${plan.year}-${String(plan.month).padStart(2, "0")}`

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 1: DASHBOARD — Executive Summary
  // ═══════════════════════════════════════════════════════════════════════════
  const wsDash = wb.addWorksheet("Dashboard", { properties: { tabColor: { argb: PURPLE } } })

  // Title area
  wsDash.mergeCells("A1:F1")
  const titleCell = wsDash.getCell("A1")
  titleCell.value = `Budget: ${plan.name} | ${periodLabel}`
  titleCell.font = { bold: true, size: 16, color: { argb: PURPLE } }
  titleCell.alignment = { horizontal: "left", vertical: "middle" }
  wsDash.getRow(1).height = 36

  wsDash.mergeCells("A2:F2")
  const subtitleCell = wsDash.getCell("A2")
  subtitleCell.value = `Status: ${plan.status === "active" ? "Active" : plan.status === "draft" ? "Draft" : "Closed"} | Generated: ${new Date().toLocaleDateString(undefined)} | LeadDrive CRM`
  subtitleCell.font = { size: 10, color: { argb: MUTED_TEXT } }

  // KPI Section
  const kpiStartRow = 4
  wsDash.mergeCells(`A${kpiStartRow}:F${kpiStartRow}`)
  const kpiHeader = wsDash.getCell(`A${kpiStartRow}`)
  kpiHeader.value = "KEY METRICS"
  Object.assign(kpiHeader, sectionHeaderStyle())
  wsDash.getRow(kpiStartRow).height = 24

  // KPI Grid (2x3)
  const kpiData = [
    ["Expenses (Plan)", totalExpensePlanned, "Expenses (Actual)", totalExpenseActual, "Expense Variance", totalExpensePlanned - totalExpenseActual],
    ["Revenue (Plan)", totalRevenuePlanned, "Revenue (Actual)", totalRevenueActual, "Revenue Variance", totalRevenueActual - totalRevenuePlanned],
    ["Margin (Plan)", marginPlanned, "Margin (Actual)", marginActual, "Margin Variance", totalVariance],
    ["Expense Forecast", totalExpenseForecastFE, "Revenue Forecast", totalRevenueForecastFE, "Margin Forecast", marginForecast],
  ]

  const kpiCols = [
    { key: "lbl1", width: 22 }, { key: "val1", width: 18 },
    { key: "lbl2", width: 22 }, { key: "val2", width: 18 },
    { key: "lbl3", width: 22 }, { key: "val3", width: 18 },
  ]
  kpiCols.forEach((c, i) => { wsDash.getColumn(i + 1).width = c.width })

  kpiData.forEach((kpiRow, idx) => {
    const rowNum = kpiStartRow + 1 + idx
    const row = wsDash.getRow(rowNum)
    row.height = 22

    // Label-value pairs
    for (let p = 0; p < 3; p++) {
      const lblCell = row.getCell(p * 2 + 1)
      const valCell = row.getCell(p * 2 + 2)
      lblCell.value = kpiRow[p * 2] as string
      lblCell.font = { size: 10, color: { argb: MUTED_TEXT } }
      lblCell.alignment = { horizontal: "right", vertical: "middle" }
      valCell.value = kpiRow[p * 2 + 1] as number
      valCell.numFmt = currFmt
      valCell.font = { bold: true, size: 11, color: { argb: DARK_TEXT } }
      valCell.alignment = { horizontal: "left", vertical: "middle" }

      // Color variance cells
      if (p === 2) {
        const val = kpiRow[5] as number
        const vc = varianceColor(val)
        valCell.font = { bold: true, size: 11, ...vc.font }
        valCell.fill = vc.fill as ExcelJS.Fill
      }
    }
  })

  // Execution % row
  const execRow = kpiStartRow + 1 + kpiData.length + 1
  wsDash.mergeCells(`A${execRow}:B${execRow}`)
  wsDash.getCell(`A${execRow}`).value = "Budget Execution (by Margin)"
  wsDash.getCell(`A${execRow}`).font = { bold: true, size: 11, color: { argb: DARK_TEXT } }
  const execValCell = wsDash.getCell(`C${execRow}`)
  execValCell.value = executionPct / 100
  execValCell.numFmt = "0.0%"
  execValCell.font = {
    bold: true, size: 14,
    color: { argb: executionPct >= 80 ? GREEN : executionPct >= 50 ? AMBER : RED },
  }

  // P&L Preview Section
  const plStartRow = execRow + 2
  wsDash.mergeCells(`A${plStartRow}:F${plStartRow}`)
  const plHeader = wsDash.getCell(`A${plStartRow}`)
  plHeader.value = "PROFIT & LOSS STATEMENT (P&L)"
  Object.assign(plHeader, sectionHeaderStyle())
  wsDash.getRow(plStartRow).height = 24

  const plColHeaders = ["", "Plan", "Forecast", "Actual", "Variance", "Var. %"]
  const plHeaderRow = wsDash.getRow(plStartRow + 1)
  plColHeaders.forEach((h, i) => {
    const cell = plHeaderRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 10, color: { argb: MUTED_TEXT } }
    cell.alignment = { horizontal: i === 0 ? "left" : "center" }
    cell.border = { bottom: { style: "thin", color: { argb: GRAY_BORDER } } }
  })

  const plRows = [
    { label: "Revenue", plan: totalRevenuePlanned, forecast: totalRevenueForecastFE, actual: totalRevenueActual, isBold: true },
    { label: "Cost of Goods Sold (COGS)", plan: -totalCOGSPlanned, forecast: -totalCOGSForecastFE, actual: -totalCOGSActual, isBold: false },
    { label: "Gross Profit", plan: grossProfitPlanned, forecast: grossProfitForecast, actual: grossProfitActual, isBold: true, isSubtotal: true },
    { label: "Operating Expenses", plan: -totalExpensePlanned, forecast: -totalExpenseForecastFE, actual: -totalExpenseActual, isBold: false },
    { label: "Operating Profit (Margin)", plan: marginPlanned, forecast: marginForecast, actual: marginActual, isBold: true, isTotal: true },
  ]

  plRows.forEach((plRow, idx) => {
    const rowNum = plStartRow + 2 + idx
    const row = wsDash.getRow(rowNum)
    row.height = 22

    row.getCell(1).value = plRow.label
    row.getCell(1).font = { bold: plRow.isBold, size: 11, color: { argb: DARK_TEXT } }
    if (!plRow.isBold) row.getCell(1).alignment = { indent: 2 }

    row.getCell(2).value = plRow.plan
    row.getCell(2).numFmt = currFmt
    row.getCell(3).value = plRow.forecast
    row.getCell(3).numFmt = currFmt
    row.getCell(4).value = plRow.actual
    row.getCell(4).numFmt = currFmt

    const variance = plRow.actual - plRow.plan
    row.getCell(5).value = variance
    addVarianceCell(row, 5, variance)

    const variancePct = plRow.plan !== 0 ? (variance / Math.abs(plRow.plan)) * 100 : 0
    addPctVarianceCell(row, 6, variancePct)

    if (plRow.isSubtotal || plRow.isTotal) {
      const borderStyle = plRow.isTotal ? "double" as const : "thin" as const
      for (let c = 1; c <= 6; c++) {
        row.getCell(c).border = { top: { style: borderStyle, color: { argb: DARK_TEXT } } }
        row.getCell(c).font = { ...row.getCell(c).font, bold: true }
      }
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 2: Plan vs Forecast vs Actual — by category
  // ═══════════════════════════════════════════════════════════════════════════
  const wsPFA = wb.addWorksheet("Plan-Forecast-Actual", { properties: { tabColor: { argb: "FF3B82F6" } } })
  wsPFA.columns = [
    { header: "Category", key: "category", width: 30 },
    { header: "Type", key: "lineType", width: 12 },
    { header: "Department", key: "department", width: 16 },
    { header: "Plan (₼)", key: "planned", width: 16 },
    { header: "Forecast (₼)", key: "forecast", width: 16 },
    { header: "Actual (₼)", key: "actual", width: 16 },
    { header: "Variance (₼)", key: "variance", width: 16 },
    { header: "Var. %", key: "variancePct", width: 12 },
    { header: "Status", key: "status", width: 14 },
  ]
  applyHeaderRow(wsPFA)
  freezeFirstRow(wsPFA)
  autoFilter(wsPFA, 9)

  // Build category actuals map
  const categoryActuals = new Map<string, number>()
  for (const [key, amount] of autoActualByCategory) {
    categoryActuals.set(key, (categoryActuals.get(key) ?? 0) + amount)
  }
  for (const a of manualActuals) {
    const key = `${a.category}||${a.lineType}`
    if (autoActualByCategory.has(key)) continue
    categoryActuals.set(key, (categoryActuals.get(key) ?? 0) + a.actualAmount)
  }

  // Group by lineType sections
  const typeLabels: Record<string, string> = { revenue: "Revenue", cogs: "COGS", expense: "Expenses" }
  const typeOrder = ["revenue", "cogs", "expense"]
  const sectionTotals: Record<string, { planned: number; forecast: number; actual: number }> = {}

  for (const lineType of typeOrder) {
    const typedLines = lines.filter((l: BudgetLineWithAccount) => l.lineType === lineType)
    if (typedLines.length === 0) continue

    // Section header
    const secRow = wsPFA.addRow({ category: `>> ${typeLabels[lineType] || lineType}` })
    secRow.eachCell((cell) => Object.assign(cell, sectionHeaderStyle()))
    secRow.height = 22

    let secPlanned = 0, secForecast = 0, secActual = 0

    for (const line of typedLines) {
      const l = line as BudgetLineWithAccount
      const catKey = `${l.account?.code ?? ""}||${l.lineType}`
      const actual = categoryActuals.get(catKey) ?? 0
      const planned = l.plannedAmount
      const forecast = l.forecastAmount ?? l.plannedAmount
      secPlanned += planned
      secForecast += forecast
      secActual += actual

      const variance = lineType === "revenue" ? actual - planned : planned - actual
      const variancePct = planned > 0 ? (variance / planned) * 100 : 0
      const status = variancePct > 5 ? "+ Savings" : variancePct < -5 ? "! Overspend" : "= On Track"

      const row = wsPFA.addRow({
        category: l.account?.name ?? l.account?.code ?? "",
        lineType: typeLabels[lineType],
        department: l.department || "General",
        planned,
        forecast,
        actual,
        variance,
        variancePct,
        status: lineType === "revenue"
          ? (variancePct > 5 ? "+ Above Plan" : variancePct < -5 ? "! Below Plan" : "= On Track")
          : status,
      })

      row.getCell("planned").numFmt = currFmt
      row.getCell("forecast").numFmt = currFmt
      row.getCell("actual").numFmt = currFmt
      addVarianceCell(row, "variance", variance)
      addPctVarianceCell(row, "variancePct", variancePct)
    }

    // Section subtotal
    const subRow = wsPFA.addRow({
      category: `Total ${typeLabels[lineType]}`,
      planned: secPlanned,
      forecast: secForecast,
      actual: secActual,
      variance: lineType === "revenue" ? secActual - secPlanned : secPlanned - secActual,
    })
    subRow.eachCell((cell) => Object.assign(cell, totalRowStyle()))
    subRow.getCell("planned").numFmt = currFmt
    subRow.getCell("forecast").numFmt = currFmt
    subRow.getCell("actual").numFmt = currFmt
    addVarianceCell(subRow, "variance", lineType === "revenue" ? secActual - secPlanned : secPlanned - secActual)
    sectionTotals[lineType] = { planned: secPlanned, forecast: secForecast, actual: secActual }

    wsPFA.addRow({}) // spacer
  }

  // Grand total: Operating Profit
  const grandRow = wsPFA.addRow({
    category: "OPERATING PROFIT",
    planned: marginPlanned,
    forecast: marginForecast,
    actual: marginActual,
    variance: totalVariance,
  })
  grandRow.eachCell((cell) => {
    cell.font = { bold: true, size: 12, color: { argb: PURPLE } }
    cell.border = { top: { style: "double", color: { argb: PURPLE } }, bottom: { style: "double", color: { argb: PURPLE } } }
  })
  grandRow.getCell("planned").numFmt = currFmt
  grandRow.getCell("forecast").numFmt = currFmt
  grandRow.getCell("actual").numFmt = currFmt
  addVarianceCell(grandRow, "variance", totalVariance)

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 3: Monthly Forecast Breakdown
  // ═══════════════════════════════════════════════════════════════════════════
  if (forecastEntries.length > 0) {
    const wsForecast = wb.addWorksheet("Monthly Forecast", { properties: { tabColor: { argb: "FF8B5CF6" } } })

    // Group by month
    const monthlyData = new Map<string, { revenue: number; expense: number; cogs: number }>()
    for (const fe of forecastEntries) {
      const entry = fe as BudgetForecastEntryRow
      const key = `${entry.year}-${String(entry.month).padStart(2, "0")}`
      const existing = monthlyData.get(key) ?? { revenue: 0, expense: 0, cogs: 0 }
      if (entry.lineType === "revenue") existing.revenue += entry.forecastAmount
      else if (entry.lineType === "cogs") existing.cogs += entry.forecastAmount
      else existing.expense += entry.forecastAmount
      monthlyData.set(key, existing)
    }

    wsForecast.columns = [
      { header: "Month", key: "month", width: 14 },
      { header: "Revenue (₼)", key: "revenue", width: 16 },
      { header: "COGS (₼)", key: "cogs", width: 18 },
      { header: "Expenses (₼)", key: "expense", width: 16 },
      { header: "Gross Profit (₼)", key: "grossProfit", width: 20 },
      { header: "Margin (₼)", key: "margin", width: 16 },
    ]
    applyHeaderRow(wsForecast)
    freezeFirstRow(wsForecast)

    const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    let totalRevF = 0, totalExpF = 0, totalCogsF = 0

    const sortedMonths = Array.from(monthlyData.entries()).sort(([a], [b]) => a.localeCompare(b))
    for (const [monthKey, data] of sortedMonths) {
      const [y, m] = monthKey.split("-")
      const grossProfit = data.revenue - data.cogs
      const margin = grossProfit - data.expense
      totalRevF += data.revenue
      totalExpF += data.expense
      totalCogsF += data.cogs

      const row = wsForecast.addRow({
        month: `${monthNames[parseInt(m)]} ${y}`,
        revenue: data.revenue,
        cogs: data.cogs,
        expense: data.expense,
        grossProfit,
        margin,
      })
      row.getCell("revenue").numFmt = currFmt
      row.getCell("cogs").numFmt = currFmt
      row.getCell("expense").numFmt = currFmt
      row.getCell("grossProfit").numFmt = currFmt
      row.getCell("margin").numFmt = currFmt

      // Color margin
      const mc = varianceColor(margin)
      row.getCell("margin").font = { bold: true, ...mc.font }
      row.getCell("margin").fill = mc.fill as ExcelJS.Fill
    }

    // Total
    const totalFRow = wsForecast.addRow({
      month: "TOTAL",
      revenue: totalRevF,
      cogs: totalCogsF,
      expense: totalExpF,
      grossProfit: totalRevF - totalCogsF,
      margin: totalRevF - totalCogsF - totalExpF,
    })
    totalFRow.eachCell((cell) => Object.assign(cell, totalRowStyle()))
    totalFRow.getCell("revenue").numFmt = currFmt
    totalFRow.getCell("cogs").numFmt = currFmt
    totalFRow.getCell("expense").numFmt = currFmt
    totalFRow.getCell("grossProfit").numFmt = currFmt
    totalFRow.getCell("margin").numFmt = currFmt

    // Also add per-category monthly breakdown
    const catMonthly = new Map<string, Map<string, number>>()
    for (const fe of forecastEntries) {
      const entry = fe as BudgetForecastEntryRow
      const monthKey = `${entry.year}-${String(entry.month).padStart(2, "0")}`
      const catKey = `${entry.category} (${typeLabels[entry.lineType] || entry.lineType})`
      if (!catMonthly.has(catKey)) catMonthly.set(catKey, new Map())
      const catMap = catMonthly.get(catKey)!
      catMap.set(monthKey, (catMap.get(monthKey) ?? 0) + entry.forecastAmount)
    }

    if (catMonthly.size > 0) {
      wsForecast.addRow({}) // spacer
      const detailHeaderRow = wsForecast.addRow({ month: "BREAKDOWN BY CATEGORY" })
      detailHeaderRow.eachCell((cell) => Object.assign(cell, sectionHeaderStyle()))

      const allMonthKeys = Array.from(monthlyData.keys()).sort()

      // Category header with months
      const catHeaderRow = wsForecast.addRow({})
      catHeaderRow.getCell(1).value = "Category"
      catHeaderRow.getCell(1).font = { bold: true, color: { argb: MUTED_TEXT } }
      allMonthKeys.forEach((mk, i) => {
        const [y, m] = mk.split("-")
        catHeaderRow.getCell(i + 2).value = `${monthNames[parseInt(m)].substring(0, 3)} ${y}`
        catHeaderRow.getCell(i + 2).font = { bold: true, color: { argb: MUTED_TEXT } }
        catHeaderRow.getCell(i + 2).alignment = { horizontal: "center" }
      })
      catHeaderRow.getCell(allMonthKeys.length + 2).value = "Total"
      catHeaderRow.getCell(allMonthKeys.length + 2).font = { bold: true, color: { argb: MUTED_TEXT } }

      for (const [catKey, monthMap] of catMonthly) {
        const catRow = wsForecast.addRow({})
        catRow.getCell(1).value = catKey
        let catTotal = 0
        allMonthKeys.forEach((mk, i) => {
          const val = monthMap.get(mk) ?? 0
          catTotal += val
          catRow.getCell(i + 2).value = val
          catRow.getCell(i + 2).numFmt = currFmt
        })
        catRow.getCell(allMonthKeys.length + 2).value = catTotal
        catRow.getCell(allMonthKeys.length + 2).numFmt = currFmt
        catRow.getCell(allMonthKeys.length + 2).font = { bold: true }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 4: Department Analysis
  // ═══════════════════════════════════════════════════════════════════════════
  const wsDept = wb.addWorksheet("By Department", { properties: { tabColor: { argb: "FF10B981" } } })
  wsDept.columns = [
    { header: "Department", key: "department", width: 22 },
    { header: "Expenses (Plan)", key: "expPlan", width: 18 },
    { header: "Expenses (Actual)", key: "expActual", width: 18 },
    { header: "Revenue (Plan)", key: "revPlan", width: 18 },
    { header: "Revenue (Actual)", key: "revActual", width: 18 },
    { header: "Forecast", key: "forecast", width: 16 },
    { header: "Variance (₼)", key: "variance", width: 16 },
  ]
  applyHeaderRow(wsDept)
  freezeFirstRow(wsDept)
  autoFilter(wsDept, 7)

  // Build dept data
  const deptMap = new Map<string, { expPlan: number; expActual: number; revPlan: number; revActual: number; forecast: number }>()
  for (const l of lines) {
    const line = l as BudgetLineWithAccount
    const dept = line.department || "General"
    const existing = deptMap.get(dept) ?? { expPlan: 0, expActual: 0, revPlan: 0, revActual: 0, forecast: 0 }
    existing.forecast += line.forecastAmount ?? line.plannedAmount
    if (line.lineType === "revenue") existing.revPlan += line.plannedAmount
    else existing.expPlan += line.plannedAmount
    deptMap.set(dept, existing)
  }
  // Apply actuals
  if (costModel) {
    for (const line of lines) {
      const l = line as BudgetLineWithAccount
      if (l.isAutoActual && l.costModelKey) {
        const dept = l.department || "General"
        const key = `${l.account?.code ?? ""}||${l.lineType}`
        const amount = autoActualByCategory.get(key) ?? 0
        const existing = deptMap.get(dept)!
        if (l.lineType === "revenue") existing.revActual += amount
        else existing.expActual += amount
      }
    }
  }
  for (const a of manualActuals) {
    const actual = a as BudgetActualRow
    const catKey = `${actual.category}||${actual.lineType}`
    if (autoActualByCategory.has(catKey)) continue
    const dept = actual.department || "General"
    const existing = deptMap.get(dept) ?? { expPlan: 0, expActual: 0, revPlan: 0, revActual: 0, forecast: 0 }
    if (actual.lineType === "revenue") existing.revActual += actual.actualAmount
    else existing.expActual += actual.actualAmount
    deptMap.set(dept, existing)
  }

  let dTotalExpPlan = 0, dTotalExpAct = 0, dTotalRevPlan = 0, dTotalRevAct = 0, dTotalForecast = 0
  for (const [dept, data] of deptMap) {
    const variance = (data.expPlan - data.expActual) + (data.revActual - data.revPlan)
    dTotalExpPlan += data.expPlan; dTotalExpAct += data.expActual
    dTotalRevPlan += data.revPlan; dTotalRevAct += data.revActual
    dTotalForecast += data.forecast

    const row = wsDept.addRow({
      department: dept,
      expPlan: data.expPlan,
      expActual: data.expActual,
      revPlan: data.revPlan,
      revActual: data.revActual,
      forecast: data.forecast,
      variance,
    })
    row.getCell("expPlan").numFmt = currFmt
    row.getCell("expActual").numFmt = currFmt
    row.getCell("revPlan").numFmt = currFmt
    row.getCell("revActual").numFmt = currFmt
    row.getCell("forecast").numFmt = currFmt
    addVarianceCell(row, "variance", variance)
  }

  const dTotalRow = wsDept.addRow({
    department: "TOTAL",
    expPlan: dTotalExpPlan, expActual: dTotalExpAct,
    revPlan: dTotalRevPlan, revActual: dTotalRevAct,
    forecast: dTotalForecast,
    variance: (dTotalExpPlan - dTotalExpAct) + (dTotalRevAct - dTotalRevPlan),
  })
  dTotalRow.eachCell((cell) => Object.assign(cell, totalRowStyle()))
  dTotalRow.getCell("expPlan").numFmt = currFmt
  dTotalRow.getCell("expActual").numFmt = currFmt
  dTotalRow.getCell("revPlan").numFmt = currFmt
  dTotalRow.getCell("revActual").numFmt = currFmt
  dTotalRow.getCell("forecast").numFmt = currFmt
  addVarianceCell(dTotalRow, "variance", (dTotalExpPlan - dTotalExpAct) + (dTotalRevAct - dTotalRevPlan))

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 5: Actuals Detail
  // ═══════════════════════════════════════════════════════════════════════════
  const wsActuals = wb.addWorksheet("Actuals (Details)", { properties: { tabColor: { argb: "FFF59E0B" } } })
  wsActuals.columns = [
    { header: "Category", key: "category", width: 30 },
    { header: "Department", key: "department", width: 16 },
    { header: "Type", key: "lineType", width: 12 },
    { header: "Amount (₼)", key: "amount", width: 16 },
    { header: "Date", key: "date", width: 14 },
    { header: "Source", key: "source", width: 16 },
    { header: "Description", key: "description", width: 40 },
  ]
  applyHeaderRow(wsActuals)
  freezeFirstRow(wsActuals)
  autoFilter(wsActuals, 7)

  // Auto-actuals from cost model
  if (costModel) {
    for (const line of lines) {
      const l = line as BudgetLineWithAccount
      if (l.isAutoActual && l.costModelKey) {
        const catKey = `${l.account?.code ?? ""}||${l.lineType}`
        const amount = autoActualByCategory.get(catKey) ?? 0
        if (amount > 0) {
          const row = wsActuals.addRow({
            category: l.account?.name ?? l.account?.code ?? "",
            department: l.department || "General",
            lineType: typeLabels[l.lineType] || l.lineType,
            amount,
            date: "",
            source: "Cost Model (auto)",
            description: `Auto-calculated: ${l.costModelKey}`,
          })
          row.getCell("amount").numFmt = currFmt
          row.getCell("source").font = { color: { argb: PURPLE } }
        }
      }
    }
  }

  // Manual actuals
  for (const a of manualActuals) {
    const actual = a as BudgetActualRow
    const row = wsActuals.addRow({
      category: actual.category,
      department: actual.department || "General",
      lineType: typeLabels[actual.lineType] || actual.lineType,
      amount: actual.actualAmount,
      date: actual.expenseDate ? new Date(actual.expenseDate).toLocaleDateString(undefined) : "",
      source: "Manual",
      description: actual.description || "",
    })
    row.getCell("amount").numFmt = currFmt
  }

  const actTotalRow = wsActuals.addRow({
    category: "TOTAL",
    amount: totalExpenseActual + totalRevenueActual + totalCOGSActual,
  })
  actTotalRow.eachCell((cell) => Object.assign(cell, totalRowStyle()))
  actTotalRow.getCell("amount").numFmt = currFmt

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 6: Budget Lines (raw data)
  // ═══════════════════════════════════════════════════════════════════════════
  const wsLines = wb.addWorksheet("Budget Lines", { properties: { tabColor: { argb: "FF6366F1" } } })
  wsLines.columns = [
    { header: "Category", key: "category", width: 30 },
    { header: "Type", key: "lineType", width: 12 },
    { header: "Department", key: "department", width: 16 },
    { header: "Budget (₼)", key: "planned", width: 16 },
    { header: "Forecast (₼)", key: "forecast", width: 16 },
    { header: "Cost Model Key", key: "costModelKey", width: 22 },
    { header: "Auto-calc", key: "isAuto", width: 12 },
    { header: "Notes", key: "notes", width: 36 },
  ]
  applyHeaderRow(wsLines)
  freezeFirstRow(wsLines)
  autoFilter(wsLines, 8)

  for (const line of lines) {
    const l = line as BudgetLineWithAccount
    const row = wsLines.addRow({
      category: l.account?.name ?? l.account?.code ?? "",
      lineType: typeLabels[l.lineType] || l.lineType,
      department: l.department || "General",
      planned: l.plannedAmount,
      forecast: l.forecastAmount ?? l.plannedAmount,
      costModelKey: l.costModelKey || "",
      isAuto: l.isAutoActual ? "Yes" : "No",
      notes: l.notes || "",
    })
    row.getCell("planned").numFmt = currFmt
    row.getCell("forecast").numFmt = currFmt
  }

  const linesTotalRow = wsLines.addRow({
    category: "TOTAL",
    planned: lines.reduce((s: number, l: BudgetLineWithAccount) => s + l.plannedAmount, 0),
    forecast: lines.reduce((s: number, l: BudgetLineWithAccount) => s + (l.forecastAmount ?? l.plannedAmount), 0),
  })
  linesTotalRow.eachCell((cell) => Object.assign(cell, totalRowStyle()))
  linesTotalRow.getCell("planned").numFmt = currFmt
  linesTotalRow.getCell("forecast").numFmt = currFmt

  // ── Generate & respond ─────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()

  const periodStr = plan.month ? `${plan.year}-${String(plan.month).padStart(2, "0")}` : plan.quarter ? `${plan.year}-Q${plan.quarter}` : `${plan.year}`
  // Sanitize filename: remove non-ASCII for the ASCII fallback, keep full name for UTF-8 version
  const rawName = `budget_${plan.name.replace(/[\s"\\\/\r\n]/g, "_")}_${periodStr}.xlsx`
  const asciiName = rawName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_")
  const utf8Name = encodeURIComponent(rawName)

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
    },
  })
}
