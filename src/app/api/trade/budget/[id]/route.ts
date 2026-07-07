/**
 * Trade budget pool item — `PATCH /api/trade/budget/[id]` (Phase 9.3).
 * { budgetPct } recomputes the amount from the sales base;
 * { budgetAmount } sets a manual override (survives re-derivation).
 * TradePlanDaily rows for the month are regenerated to keep pacing honest.
 */
import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
// Stage 3 RLS — global client retained ONLY for lockedResponse's
// fire-and-forget 423-audit; data access rides the withOrgScope tx.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { applyPoolPatch } from "@/lib/trade/budget"
import { spreadMonthlyPlan } from "@/lib/trade/pacing"
import { findFirstActiveLockInPeriods } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeys } from "@/lib/budgeting/period-lock-http"
import { rebaseChannelPools } from "@/lib/trade/pool-sync"
import { recomputeTradePacing } from "@/lib/trade/pacing-recompute"

const RATE_LIMIT = { name: "trade-budget-patch", max: 30, windowMs: 60_000 }

const patchSchema = z
  .object({
    budgetPct: z.number().min(0).max(100).optional(),
    budgetAmount: z.number().min(0).max(1e12).optional(),
  })
  .refine((p) => p.budgetPct !== undefined || p.budgetAmount !== undefined, {
    message: "budgetPct or budgetAmount required",
  })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId
  const { id } = await params

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${orgId}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  let parsed
  try {
    parsed = patchSchema.parse(await request.json())
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  // Stage 3 RLS — pre-checks, patch, plan-daily regen, rebase and pacing
  // recompute in ONE org-scoped tx.
  return withOrgScope(
    orgId,
    async (tx) => {
      const pool = await tx.tradeBudgetPool.findFirst({
        where: { id, organizationId: orgId },
      })
      if (!pool) {
        return NextResponse.json({ ok: false, error: "Pool not found" }, { status: 404 })
      }
      // T9 guard — channel-grain rows have salesPlanAmount=0 and carry the
      // ALLOCATION % in budgetPct; patching them here would zero the amount.
      // They change only through PUT /api/trade/budget/allocations.
      if (pool.grainKey !== "org") {
        return NextResponse.json(
          { ok: false, error: "Channel pools are managed via /api/trade/budget/allocations" },
          { status: 409 },
        )
      }

      // R2 — a CFO-locked month's budget cannot be repriced.
      const lock = await findFirstActiveLockInPeriods(
        tx,
        orgId,
        containingPeriodKeys(pool.year, pool.month),
      )
      if (lock) {
        return lockedResponse(lock, {
          prisma,
          orgId,
          userId: session.userId,
          route: "PATCH /api/trade/budget/[id]",
        })
      }

      const next = applyPoolPatch(pool, parsed)
      const row = await tx.tradeBudgetPool.update({
        where: { id },
        data: next,
        select: {
          id: true,
          year: true,
          month: true,
          salesPlanAmount: true,
          budgetPct: true,
          budgetAmount: true,
          isManualAmount: true,
        },
      })
      await tx.tradePlanDaily.deleteMany({
        where: { organizationId: orgId, year: row.year, month: row.month, grainKey: pool.grainKey },
      })
      const salesSpread = spreadMonthlyPlan(row.year, row.month, row.salesPlanAmount)
      const budgetSpread = spreadMonthlyPlan(row.year, row.month, row.budgetAmount)
      await tx.tradePlanDaily.createMany({
        data: salesSpread.map((d, i) => ({
          organizationId: orgId,
          date: new Date(Date.UTC(row.year, row.month - 1, d.day)),
          year: row.year,
          month: row.month,
          grainKey: pool.grainKey,
          plannedSalesAmount: d.amount,
          plannedTradeBudgetAmount: budgetSpread[i]?.amount ?? 0,
          workingDayWeight: d.weight,
        })),
      })
      // Codex review #4 — channel pools follow the org pool.
      await rebaseChannelPools(tx, orgId, row.year, row.month, row.budgetAmount)

      // Codex review #3 — the dashboard must reflect the new budget now.
      await recomputeTradePacing(tx, orgId, row.year, row.month)

      return NextResponse.json({ ok: true, pool: row })
    },
    { timeoutMs: 15_000 },
  )
}
