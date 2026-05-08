import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { findFirstActiveLockInPeriods, derivePeriodKey } from "@/lib/budgeting/period-lock"
import type { CashFlowEntry } from "@prisma/client"

const generateSchema = z.object({
  year: z.number().int().min(2020).max(2050),
  planId: z.string().max(100).optional(),
}).strict()

// POST — generate cash flow entries from budget lines, invoices, contracts
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
    data = generateSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { year, planId } = data

  // Phase 7.G Turn LXVIII (Phase 4.2 fan-out). Period-lock guard. cash-flow
  // regeneration is destructive (deleteMany before recreate) and spans the
  // ENTIRE year + every plan within it. Reject if the year itself is locked
  // OR if any plan's narrower period (Q/M) is locked — both flavours block
  // since regen would silently overwrite locked-period entries.
  // Load plans BEFORE deleteMany so a 423 doesn't leak an incomplete state.
  const plans = await prisma.budgetPlan.findMany({
    where: { organizationId: orgId, year, isRolling: false },
  })
  const yearKey = String(year)
  const planPeriodKeys: string[] = plans.map((p: { periodType: string | null; year: number; month: number | null; quarter: number | null }) =>
    derivePeriodKey(p),
  )
  const periodKeysToCheck: string[] = Array.from(new Set([yearKey, ...planPeriodKeys]))
  const lock = await findFirstActiveLockInPeriods(prisma, orgId, periodKeysToCheck)
  if (lock) {
    return NextResponse.json(
      {
        error: "Period locked — mutations rejected",
        lock: {
          period: lock.period,
          lockedAt: lock.lockedAt,
          lockedBy: lock.lockedBy,
          reason: lock.reason,
        },
      },
      { status: 423 },
    )
  }

  // Clear old generated entries for this year before regenerating
  await prisma.cashFlowEntry.deleteMany({
    where: { organizationId: orgId, year, source: "budget_line" },
  })

  let created = 0

  for (const plan of plans) {
    const lines = await prisma.budgetLine.findMany({
      where: { planId: plan.id, organizationId: orgId },
    })

    // Determine months for this plan
    const months: number[] = []
    if (plan.periodType === "annual") {
      for (let m = 1; m <= 12; m++) months.push(m)
    } else if (plan.periodType === "quarterly" && plan.quarter) {
      const startMonth = (plan.quarter - 1) * 3 + 1
      for (let m = startMonth; m < startMonth + 3; m++) months.push(m)
    } else if (plan.month) {
      months.push(plan.month)
    }

    for (const line of lines) {
      const monthlyAmount = line.plannedAmount / (months.length || 1)
      const entryType = line.lineType === "revenue" ? "inflow" : "outflow"

      for (const m of months) {
        await prisma.cashFlowEntry.create({
          data: {
            organizationId: orgId,
            year: plan.year,
            month: m,
            entryType,
            source: "budget_line",
            sourceId: line.id,
            amount: monthlyAmount,
            description: `${line.category} (${line.lineType})`,
            isProjected: true,
          },
        })
        created++
      }
    }
  }

  // 2. From invoices (sent/partially_paid → projected inflows)
  try {
    const invoices = await (prisma as any).invoice.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["sent", "partially_paid"] },
      },
    })

    for (const inv of invoices) {
      const dueDate = inv.dueDate ? new Date(inv.dueDate) : new Date()
      if (dueDate.getFullYear() !== year) continue

      const existing = await prisma.cashFlowEntry.findFirst({
        where: {
          organizationId: orgId,
          source: "invoice",
          sourceId: inv.id,
        },
      })

      if (!existing) {
        await prisma.cashFlowEntry.create({
          data: {
            organizationId: orgId,
            year,
            month: dueDate.getMonth() + 1,
            entryType: "inflow",
            source: "invoice",
            sourceId: inv.id,
            amount: inv.totalAmount || inv.amount || 0,
            description: `Invoice #${inv.number || inv.id.substring(0, 8)}`,
            paymentDate: dueDate,
            isProjected: true,
          },
        })
        created++
      }
    }
  } catch {
    // Invoice model may not exist — skip silently
  }

  // 3. Clear old alerts for this year before regenerating
  await prisma.cashFlowAlert.deleteMany({
    where: { organizationId: orgId, year },
  })

  // 4. Generate alerts for negative closing balances
  const entries = await prisma.cashFlowEntry.findMany({
    where: { organizationId: orgId, year },
    orderBy: [{ month: "asc" }],
  })

  let balance = 0
  for (let m = 1; m <= 12; m++) {
    const monthEntries = entries.filter((e: CashFlowEntry) => e.month === m)
    const inflows = monthEntries.filter((e: CashFlowEntry) => e.entryType === "inflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
    const outflows = monthEntries.filter((e: CashFlowEntry) => e.entryType === "outflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
    balance = balance + inflows - outflows

    if (balance < 0) {
      // Check if alert already exists
      const existingAlert = await prisma.cashFlowAlert.findFirst({
        where: { organizationId: orgId, year, month: m, alertType: "negative_balance", isResolved: false },
      })

      if (!existingAlert) {
        await prisma.cashFlowAlert.create({
          data: {
            organizationId: orgId,
            year,
            month: m,
            alertType: "negative_balance",
            message: `Projected negative balance of ${balance.toFixed(0)} in month ${m}/${year}`,
            projectedBalance: balance,
          },
        })
      }
    }
  }

  return NextResponse.json({
    success: true,
    entriesCreated: created,
    year,
  })
}
