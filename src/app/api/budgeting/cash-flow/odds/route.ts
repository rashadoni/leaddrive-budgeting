import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { currentBakuYear } from "@/lib/risk/periods"
import type { CashFlowEntry } from "@prisma/client"

const MONTH_NAMES = ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"]

// Cash Flow Statement (ODDS) by 3 activities: Operating, Investing, Financing
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const year = parseInt(req.nextUrl.searchParams.get("year") || currentBakuYear())
  const compareYear = req.nextUrl.searchParams.get("compareYear")

  // deletedAt:null REQUIRED (2026-05-31): same soft-delete archive pattern
  // as the cash-flow overview GET — without it the ODDS statement sums
  // superseded rows, inflating Operating/Investing/Financing totals ~2×.
  // Stage 3 RLS — reads in the org-scoped tx; ODDS aggregation is pure.
  const { entries, compareEntries } = await withOrgScope(orgId, async (tx) => {
    const entries = await tx.cashFlowEntry.findMany({
      where: { organizationId: orgId, year, deletedAt: null },
      orderBy: [{ month: "asc" }],
      include: { account: { select: { code: true, name: true } } },
    })
    let compareEntries: typeof entries = []
    if (compareYear) {
      compareEntries = await tx.cashFlowEntry.findMany({
        where: { organizationId: orgId, year: parseInt(compareYear), deletedAt: null },
        include: { account: { select: { code: true, name: true } } },
      })
    }
    return { entries, compareEntries }
  })

  // Group by activity type
  const activities = ["operating", "investing", "financing"] as const
  const movementEntries = entries.filter(
    (entry: CashFlowEntry) => entry.entryType === "inflow" || entry.entryType === "outflow",
  )
  const compareMovementEntries = compareEntries.filter(
    (entry: CashFlowEntry) => entry.entryType === "inflow" || entry.entryType === "outflow",
  )
  const activityLabels: Record<string, string> = {
    operating: "Operating Activities",
    investing: "Investing Activities",
    financing: "Financing Activities",
  }

  const sections = activities.map((activity) => {
    const activityEntries = movementEntries.filter((e: CashFlowEntry) => (e.activityType || "operating") === activity)
    const inflows = activityEntries.filter((e: CashFlowEntry) => e.entryType === "inflow")
    const outflows = activityEntries.filter((e: CashFlowEntry) => e.entryType === "outflow")

    // Group by category
    const inflowByCategory: Record<string, number> = {}
    inflows.forEach((e: any) => {
      const cat = e.account?.code ?? e.source ?? "Other"
      inflowByCategory[cat] = (inflowByCategory[cat] || 0) + e.amount
    })

    const outflowByCategory: Record<string, number> = {}
    outflows.forEach((e: any) => {
      const cat = e.account?.code ?? e.source ?? "Other"
      outflowByCategory[cat] = (outflowByCategory[cat] || 0) + e.amount
    })

    const totalInflow = inflows.reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
    const totalOutflow = outflows.reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
    const net = totalInflow - totalOutflow

    // Compare year
    let compareNet = 0
    if (compareYear) {
      const compEntries = compareMovementEntries.filter((e: CashFlowEntry) => (e.activityType || "operating") === activity)
      const compIn = compEntries.filter((e: CashFlowEntry) => e.entryType === "inflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
      const compOut = compEntries.filter((e: CashFlowEntry) => e.entryType === "outflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
      compareNet = compIn - compOut
    }

    // Monthly breakdown
    const monthly = []
    for (let m = 1; m <= 12; m++) {
      const monthEntries = activityEntries.filter((e: CashFlowEntry) => e.month === m)
      const mIn = monthEntries.filter((e: CashFlowEntry) => e.entryType === "inflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
      const mOut = monthEntries.filter((e: CashFlowEntry) => e.entryType === "outflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
      monthly.push({ month: m, label: MONTH_NAMES[m - 1], inflow: mIn, outflow: mOut, net: mIn - mOut })
    }

    return {
      activity,
      label: activityLabels[activity],
      totalInflow,
      totalOutflow,
      net,
      compareNet: compareYear ? compareNet : undefined,
      yoyChange: compareYear && compareNet !== 0 ? Math.round(((net - compareNet) / Math.abs(compareNet)) * 100) : undefined,
      inflowByCategory: Object.entries(inflowByCategory).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
      outflowByCategory: Object.entries(outflowByCategory).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
      monthly,
    }
  })

  // Grand totals
  const grandInflow = sections.reduce((s, sec) => s + sec.totalInflow, 0)
  const grandOutflow = sections.reduce((s, sec) => s + sec.totalOutflow, 0)
  const grandNet = grandInflow - grandOutflow

  return NextResponse.json({
    data: {
      year,
      entryCount: movementEntries.length,
      compareYear: compareYear ? parseInt(compareYear) : undefined,
      compareEntryCount: compareYear ? compareMovementEntries.length : undefined,
      sections,
      grandInflow,
      grandOutflow,
      grandNet,
    },
  })
}
