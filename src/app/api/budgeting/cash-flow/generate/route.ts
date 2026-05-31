import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { findFirstActiveLockInPeriods, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import type { CashFlowEntry } from "@prisma/client"

const generateSchema = z.object({
  year: z.number().int().min(2020).max(2050),
  planId: z.string().max(100).optional(),
}).strict()

// POST — generate cash flow entries from budget lines, invoices, contracts
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
  if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "POST /api/budgeting/cash-flow/generate" })

  // Clear old generated entries for this year before regenerating
  await prisma.cashFlowEntry.deleteMany({
    where: { organizationId: orgId, year, source: "budget_line" },
  })

  let created = 0

  for (const plan of plans) {
    const lines = await prisma.budgetLine.findMany({
      where: { planId: plan.id, organizationId: orgId },
      include: { account: { select: { code: true, name: true } } },
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
            // accountId is NOT NULL on CashFlowEntry — inherit the budget line's
            // account (BudgetLine.accountId is itself NOT NULL since Phase 2.1).
            accountId: line.accountId,
            amount: monthlyAmount,
            description: `${(line as any).account?.name ?? (line as any).account?.code ?? ""} (${line.lineType})`,
            isProjected: true,
          },
        })
        created++
      }
    }
  }

  // 2. From invoices — DISABLED 2026-05-31. `CashFlowEntry.accountId` is now
  // NOT NULL (schema↔DB reconciled to the Phase-2.1 integrity rule): every cash
  // movement must tie to a ChartOfAccount. An invoice has no single account to
  // attribute its projected inflow to, and we will not fabricate one. Re-enable
  // once an invoice→CoA mapping exists (e.g. a default AR/revenue account per
  // org). This path was unused (0 invoice-sourced rows) and was already
  // defensively wrapped in try/catch for a possibly-absent Invoice model.

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
