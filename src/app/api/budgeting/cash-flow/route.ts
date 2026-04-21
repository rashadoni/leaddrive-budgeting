import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import type { CashFlowEntry } from "@prisma/client"

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

  const year = parseInt(req.nextUrl.searchParams.get("year") || new Date().getFullYear().toString())

  const entries = await prisma.cashFlowEntry.findMany({
    where: { organizationId: orgId, year },
    orderBy: [{ month: "asc" }, { entryType: "asc" }],
  })

  // Build monthly summary
  const monthlyData = []
  let runningBalance = 0

  // Get opening balance from previous year's last month
  const prevYearEntries = await prisma.cashFlowEntry.findMany({
    where: { organizationId: orgId, year: year - 1 },
  })
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
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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

  const entry = await prisma.cashFlowEntry.create({
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

  return NextResponse.json(entry, { status: 201 })
}
