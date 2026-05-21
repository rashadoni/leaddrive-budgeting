import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { currentBakuYear } from "@/lib/risk/periods"
import { findFirstActiveLockInPeriods } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeys } from "@/lib/budgeting/period-lock-http"
import type { CashFlowEntry } from "@prisma/client"
// Phase 5.2 Stage 2 Tier 3 (2026-05-21) — RLS wrap for cash_flow_entries reads/writes.
import { withOrgScope } from "@/lib/db/with-org-scope"

const createCashFlowSchema = z.object({
  year: z.number().int().min(2020).max(2050),
  month: z.number().int().min(1).max(12),
  entryType: z.enum(["inflow", "outflow"]),
  amount: z.union([z.string().min(1), z.number().min(0).max(999999999)]),
  description: z.string().max(500).optional().nullable(),
  source: z.string().max(100).optional(),
  sourceId: z.string().max(100).optional().nullable(),
  paymentDate: z.string().max(50).optional().nullable(),
  currencyCode: z.string().max(10).optional(),
  isProjected: z.boolean().optional(),
}).strict()

// GET — get cash flow data for a year
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const year = parseInt(req.nextUrl.searchParams.get("year") || currentBakuYear())

  const { entries, prevYearEntries } = await withOrgScope(orgId, async (tx) => {
    const entries = await tx.cashFlowEntry.findMany({
      where: { organizationId: orgId, year },
      orderBy: [{ month: "asc" }, { entryType: "asc" }],
    })
    const prevYearEntries = await tx.cashFlowEntry.findMany({
      where: { organizationId: orgId, year: year - 1 },
    })
    return { entries, prevYearEntries }
  })

  // Build monthly summary
  const monthlyData = []
  let runningBalance = 0
  const prevInflows = prevYearEntries.filter((e: CashFlowEntry) => e.entryType === "inflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
  const prevOutflows = prevYearEntries.filter((e: CashFlowEntry) => e.entryType === "outflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
  runningBalance = prevInflows - prevOutflows

  for (let m = 1; m <= 12; m++) {
    const monthEntries = entries.filter((e: CashFlowEntry) => e.month === m)
    const inflows = monthEntries.filter((e: CashFlowEntry) => e.entryType === "inflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
    const outflows = monthEntries.filter((e: CashFlowEntry) => e.entryType === "outflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
    const opening = runningBalance
    runningBalance = opening + inflows - outflows

    monthlyData.push({
      month: m,
      year,
      opening,
      inflows,
      outflows,
      net: inflows - outflows,
      closing: runningBalance,
      inflowEntries: monthEntries.filter((e: CashFlowEntry) => e.entryType === "inflow"),
      outflowEntries: monthEntries.filter((e: CashFlowEntry) => e.entryType === "outflow"),
    })
  }

  return NextResponse.json({
    year,
    months: monthlyData,
    totalInflows: entries.filter((e: CashFlowEntry) => e.entryType === "inflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0),
    totalOutflows: entries.filter((e: CashFlowEntry) => e.entryType === "outflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0),
  })
}

// POST — create a manual cash flow entry
export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { orgId, userId } = session

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = createCashFlowSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { year, month, entryType, amount, description, source, sourceId, paymentDate, currencyCode, isProjected } = data

  // Phase 7.G Turn LXVIII follow-up — period-lock guard. cash-flow direct
  // entries have explicit year+month input (no plan reference). Strict-string
  // matching means we must check ALL THREE containing-period granularities
  // — year ("YYYY") + the month's quarter ("YYYY-QN") + month ("YYYY-MM") —
  // so any of those locked rejects the write. This differs from plan-derived
  // routes (which check ONE key derived from the plan's periodType). Single
  // Org read via the bulk helper.
  // Phase 7.G Turn LXIX cleanup: replaced inline year/quarter/month
  // construction with the shared `containingPeriodKeys` helper.
  const lock = await findFirstActiveLockInPeriods(prisma, orgId, containingPeriodKeys(year, month))
  if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "POST /api/budgeting/cash-flow" })

  const entry = await withOrgScope(orgId, async (tx) =>
    tx.cashFlowEntry.create({
      data: {
        organizationId: orgId,
        year,
        month,
        entryType,
        source: source || "manual",
        sourceId: sourceId || null,
        amount: typeof amount === "string" ? parseFloat(amount) : amount,
        description: description || null,
        paymentDate: paymentDate ? new Date(paymentDate) : null,
        currencyCode: currencyCode || "AZN",
        isProjected: isProjected ?? true,
      },
    })
  )

  return NextResponse.json(entry, { status: 201 })
}
