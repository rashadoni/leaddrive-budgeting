import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import type { CashFlowEntry } from "@prisma/client"

const MONTH_NAMES = ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"]

// Cash Flow Statement (ODDS) by 3 activities: Operating, Investing, Financing
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const year = parseInt(req.nextUrl.searchParams.get("year") || new Date().getFullYear().toString())
  const compareYear = req.nextUrl.searchParams.get("compareYear")

  const entries = await prisma.cashFlowEntry.findMany({
    where: { organizationId: orgId, year },
    orderBy: [{ month: "asc" }],
  })

  let compareEntries: typeof entries = []
  if (compareYear) {
    compareEntries = await prisma.cashFlowEntry.findMany({
      where: { organizationId: orgId, year: parseInt(compareYear) },
    })
  }

  // Group by activity type
  const activities = ["operating", "investing", "financing"] as const
  const activityLabels: Record<string, string> = {
    operating: "Operating Activities",
    investing: "Investing Activities",
    financing: "Financing Activities",
  }

  const sections = activities.map((activity) => {
    const activityEntries = entries.filter((e: CashFlowEntry) => (e.activityType || "operating") === activity)
    const inflows = activityEntries.filter((e: CashFlowEntry) => e.entryType === "inflow")
    const outflows = activityEntries.filter((e: CashFlowEntry) => e.entryType === "outflow")

    // Group by category
    const inflowByCategory: Record<string, number> = {}
    inflows.forEach((e: CashFlowEntry) => {
      const cat = e.category || e.source || "Other"
      inflowByCategory[cat] = (inflowByCategory[cat] || 0) + e.amount
    })

    const outflowByCategory: Record<string, number> = {}
    outflows.forEach((e: CashFlowEntry) => {
      const cat = e.category || e.source || "Other"
      outflowByCategory[cat] = (outflowByCategory[cat] || 0) + e.amount
    })

    const totalInflow = inflows.reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
    const totalOutflow = outflows.reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
    const net = totalInflow - totalOutflow

    // Compare year
    let compareNet = 0
    if (compareYear) {
      const compEntries = compareEntries.filter((e: CashFlowEntry) => (e.activityType || "operating") === activity)
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
      compareYear: compareYear ? parseInt(compareYear) : undefined,
      sections,
      grandInflow,
      grandOutflow,
      grandNet,
    },
  })
}
