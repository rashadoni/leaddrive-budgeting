/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/budgeting/snapshot?planId=X&at=ISO_TIMESTAMP
 *
 * Reconstructs the budget state at a given point in time using
 * the BudgetChangeLog. Uses DISTINCT ON for O(1) reconstruction.
 */
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  const at = req.nextUrl.searchParams.get("at")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })
  if (!at) return NextResponse.json({ error: "at (ISO timestamp) required" }, { status: 400 })

  const atDate = new Date(at)

  // 1. Get changelog entries at or before the given timestamp (changed entities)
  const latestEntries: any[] = await prisma.$queryRaw`
    SELECT DISTINCT ON ("entityId")
      "entityId", "entityType", "action", "snapshot", "createdAt"
    FROM budget_change_logs
    WHERE "planId" = ${planId}
      AND "organizationId" = ${orgId}
      AND "createdAt" <= ${atDate}
    ORDER BY "entityId", "createdAt" DESC
  `

  // Build sets of entity IDs that have changelog entries
  const changedLineIds = new Set<string>()
  const changedActualIds = new Set<string>()
  const deletedIds = new Set<string>()

  const snapshotLines: any[] = []
  const snapshotActuals: any[] = []
  const forecasts: any[] = []

  for (const entry of latestEntries) {
    if (entry.action === "delete") {
      deletedIds.add(entry.entityId)
      continue
    }
    const snapshot = entry.snapshot
    if (!snapshot) continue

    switch (entry.entityType) {
      case "line":
        changedLineIds.add(entry.entityId)
        snapshotLines.push(snapshot)
        break
      case "actual":
        changedActualIds.add(entry.entityId)
        snapshotActuals.push(snapshot)
        break
      case "forecast":
        forecasts.push(snapshot)
        break
    }
  }

  // 2. Fetch ALL current lines and actuals for this plan
  //    Lines that were never changed = their current state IS historical state
  const [currentLines, currentActuals] = await Promise.all([
    prisma.budgetLine.findMany({
      where: { planId, organizationId: orgId },
    }),
    prisma.budgetActual.findMany({
      where: { planId, organizationId: orgId },
    }),
  ])

  // 3. Merge: changelog lines override, unchanged lines use current state
  const lines: any[] = [...snapshotLines]
  for (const cl of currentLines) {
    if (!changedLineIds.has(cl.id) && !deletedIds.has(cl.id)) {
      lines.push(cl) // unchanged line — use current state
    }
  }

  const actuals: any[] = [...snapshotActuals]
  for (const ca of currentActuals) {
    if (!changedActualIds.has(ca.id) && !deletedIds.has(ca.id)) {
      actuals.push(ca) // unchanged actual — use current state
    }
  }

  // Compute analytics from full reconstructed state
  const analytics = computeAnalytics(lines, actuals)

  return NextResponse.json({
    success: true,
    data: {
      lines, actuals, forecasts, analytics, reconstructedAt: at,
      changedEntityIds: [...changedLineIds, ...changedActualIds],
    },
  })
}

function computeAnalytics(lines: any[], actuals: any[]) {
  // Sum actuals directly by their lineType (matches live analytics API behavior)
  let totalExpenseActual = 0, totalRevenueActual = 0, totalCOGSActual = 0
  const actualsByCat = new Map<string, number>()
  for (const a of actuals) {
    const amt = Number(a.actualAmount || 0)
    const key = `${a.category}||${a.lineType}`
    actualsByCat.set(key, (actualsByCat.get(key) || 0) + amt)
    if (a.lineType === "revenue") totalRevenueActual += amt
    else if (a.lineType === "cogs") totalCOGSActual += amt
    else totalExpenseActual += amt
  }

  let totalExpensePlanned = 0
  let totalRevenuePlanned = 0
  let totalCOGSPlanned = 0

  const byCategory: any[] = []

  for (const l of lines) {
    const planned = Number(l.plannedAmount || 0)
    const forecast = l.forecastAmount != null ? Number(l.forecastAmount) : planned
    const actual = actualsByCat.get(`${l.category}||${l.lineType}`) || 0

    if (l.lineType === "expense") {
      totalExpensePlanned += planned
    } else if (l.lineType === "revenue") {
      totalRevenuePlanned += planned
    } else if (l.lineType === "cogs") {
      totalCOGSPlanned += planned
    }

    byCategory.push({
      category: l.category,
      lineType: l.lineType,
      planned,
      forecast,
      actual,
      variance: actual - planned,
      variancePct: planned !== 0 ? ((actual - planned) / planned) * 100 : 0,
    })
  }

  const totalPlanned = totalExpensePlanned + totalCOGSPlanned
  const totalActual = totalExpenseActual + totalCOGSActual
  const margin = totalRevenuePlanned - totalPlanned
  const marginActual = totalRevenueActual - totalActual

  return {
    totalPlanned,
    totalActual,
    totalVariance: totalActual - totalPlanned,
    totalExpensePlanned,
    totalExpenseActual,
    totalRevenuePlanned,
    totalRevenueActual,
    totalCOGSPlanned,
    totalCOGSActual,
    margin,
    marginActual,
    executionPct: totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0,
    expenseExecutionPct: totalExpensePlanned > 0 ? (totalExpenseActual / totalExpensePlanned) * 100 : 0,
    revenueExecutionPct: totalRevenuePlanned > 0 ? (totalRevenueActual / totalRevenuePlanned) * 100 : 0,
    byCategory,
  }
}
