import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, getSession } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
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

  // Stage 3 RLS — the whole destructive regen (lock check, deleteMany,
  // per-plan projection loop, alert regen) in ONE org-scoped tx — now
  // atomic (was a bare deleteMany-then-recreate). 60s: a year of CF entries.
  return withOrgScope(
    orgId,
    async (tx) => {
  // Phase 7.G Turn LXVIII (Phase 4.2 fan-out). Period-lock guard. cash-flow
  // regeneration is destructive (deleteMany before recreate) and spans the
  // ENTIRE year + every plan within it. Reject if the year itself is locked
  // OR if any plan's narrower period (Q/M) is locked.
  // Load plans BEFORE deleteMany so a 423 doesn't leak an incomplete state.
  const plans = await tx.budgetPlan.findMany({
    where: { organizationId: orgId, year, isRolling: false },
  })
  const yearKey = String(year)
  const planPeriodKeys: string[] = plans.map((p: { periodType: string | null; year: number; month: number | null; quarter: number | null }) =>
    derivePeriodKey(p),
  )
  const periodKeysToCheck: string[] = Array.from(new Set([yearKey, ...planPeriodKeys]))
  const lock = await findFirstActiveLockInPeriods(tx, orgId, periodKeysToCheck)
  if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "POST /api/budgeting/cash-flow/generate" })

  // Clear old generated entries for this year before regenerating
  await tx.cashFlowEntry.deleteMany({
    where: { organizationId: orgId, year, source: "budget_line" },
  })

  // 2026-06-23 — actuals override the forecast. A (company, month) cell that
  // already carries actual (imported, non-projected) CF must NOT also receive a
  // projected budget_line entry, or org reads would sum actual+projected for the
  // SAME cell (the CF mixing Codex flagged). Scope by (company, month) so a
  // PARTIAL company import doesn't suppress other companies' projections (P2).
  const actualKeys = new Set(
    (
      await tx.cashFlowEntry.findMany({
        where: {
          organizationId: orgId,
          year,
          isProjected: false,
          deletedAt: null,
          // Filter before DISTINCT. If a cell carries both a movement and a
          // bridge row, post-filtering an arbitrary distinct representative
          // could incorrectly hide the real actual movement.
          activityType: { not: "bridge" },
        },
        select: { companyId: true, month: true },
        distinct: ["companyId", "month"],
      })
    )
      .map((r: { companyId: string | null; month: number }) => `${r.companyId ?? ""}|${r.month}`),
  )

  let created = 0
  let skippedActualCells = 0

  for (const plan of plans) {
    const lines = await tx.budgetLine.findMany({
      // deletedAt:null (2026-05-31): project CF from LIVE budget lines only —
      // archived lines would inject phantom cash flows into the projection.
      where: { planId: plan.id, organizationId: orgId, deletedAt: null },
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
        if (actualKeys.has(`${line.companyId ?? ""}|${m}`)) {
          skippedActualCells++
          continue // this company's actuals already cover this (company, month)
        }
        await tx.cashFlowEntry.create({
          data: {
            organizationId: orgId,
            year: plan.year,
            month: m,
            entryType,
            source: "budget_line",
            sourceId: line.id,
            // inherit the budget line's company so projected CF is per-company too
            companyId: line.companyId,
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
  await tx.cashFlowAlert.deleteMany({
    where: { organizationId: orgId, year },
  })

  // 4. Generate alerts for negative closing balances
  const entries = await tx.cashFlowEntry.findMany({
    // deletedAt:null (2026-05-31): balance/alerts off LIVE entries only —
    // archived rows would distort closing balances and fire false alerts.
    where: { organizationId: orgId, year, deletedAt: null },
    orderBy: [{ month: "asc" }],
  })

  let balance = 0
  for (let m = 1; m <= 12; m++) {
    // Imported CF.04–CF.07 rows are reconciliation evidence, not movements.
    // Including them here would double-count net change/opening/closing and
    // could create false negative-balance alerts.
    const monthEntries = entries.filter((e: CashFlowEntry) => e.month === m && e.activityType !== "bridge")
    const inflows = monthEntries.filter((e: CashFlowEntry) => e.entryType === "inflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
    const outflows = monthEntries.filter((e: CashFlowEntry) => e.entryType === "outflow").reduce((s: number, e: CashFlowEntry) => s + e.amount, 0)
    balance = balance + inflows - outflows

    if (balance < 0) {
      // Check if alert already exists
      const existingAlert = await tx.cashFlowAlert.findFirst({
        where: { organizationId: orgId, year, month: m, alertType: "negative_balance", isResolved: false },
      })

      if (!existingAlert) {
        await tx.cashFlowAlert.create({
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
    // (company, month) cells left to the imported actuals (forecast fills gaps).
    skippedActualCells,
    year,
  })
    },
    { timeoutMs: 60_000 },
  )
}
