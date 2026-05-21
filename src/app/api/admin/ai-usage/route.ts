/**
 * Phase 7.B v2 Day 6 — AI token usage admin endpoint.
 *
 * GET /api/admin/ai-usage
 *
 * Returns:
 *   - today: { tokensIn, tokensOut, calls, total }
 *   - mtd:   month-to-date aggregate
 *   - budget: { daily, monthly }
 *   - remaining: { daily, monthly } (clamped at 0; negative = over-budget)
 *   - last30: array of { date, total, calls } for the trend sparkline
 *
 * Auth: admin only — usage data exposes LLM cost surface, not relevant
 * to non-admins.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import {
  getDailyUsage,
  getMonthlyUsage,
  DEFAULT_BUDGET,
} from "@/lib/llm/cost-budget"

export async function GET(req: NextRequest) {
  const session = await requireRole(req, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const orgId = session.orgId
  const today = new Date()

  const [todayStats, mtdStats] = await Promise.all([
    getDailyUsage(orgId, today),
    getMonthlyUsage(orgId, today),
  ])

  // Trend: last 30 days. Read directly from Prisma so we get a contiguous
  // series including zero-usage days (returned as missing rows; we fill
  // them in client-side for the sparkline).
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10)
  const todayStr = today.toISOString().slice(0, 10)

  type UsageRow = {
    date: string
    tokensIn: number
    tokensOut: number
    calls: number
  }
  const rows = (await prisma.aITokenUsage
    .findMany({
      where: {
        organizationId: orgId,
        date: { gte: thirtyDaysAgoStr, lte: todayStr },
      },
      orderBy: { date: "asc" },
      select: { date: true, tokensIn: true, tokensOut: true, calls: true },
    })
    .catch(() => [] as UsageRow[])) as UsageRow[]

  const byDate = new Map(rows.map((r) => [r.date, r]))
  const last30: Array<{ date: string; total: number; calls: number }> = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const row = byDate.get(dateStr)
    last30.push({
      date: dateStr,
      total: row ? row.tokensIn + row.tokensOut : 0,
      calls: row?.calls ?? 0,
    })
  }

  const budget = DEFAULT_BUDGET
  const remaining = {
    daily: Math.max(0, budget.daily - todayStats.total),
    monthly: Math.max(0, budget.monthly - mtdStats.total),
  }

  return NextResponse.json({
    today: todayStats,
    mtd: mtdStats,
    budget,
    remaining,
    overBudget: {
      daily: todayStats.total > budget.daily,
      monthly: mtdStats.total > budget.monthly,
    },
    last30,
  })
}
