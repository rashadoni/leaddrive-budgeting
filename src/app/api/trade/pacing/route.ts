/**
 * Trade pacing — `GET | POST /api/trade/pacing` (Phase 9.7 completion).
 *
 * POST (manager): recompute the org-grain snapshot for ?period (default
 * current month): budget + sales plan from TradeBudgetPool, MTD spend
 * from the ledger (control figure per accrual method), sales actuals
 * from the 9.5 daily import (0 until it ships — dataQuality reflects
 * it). Persists TradePacingSnapshot (math = full PacingInput for
 * hand-audit) and syncs the alert inbox.
 * GET (viewer): latest snapshot for the period + the recomputed result.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { computePacing, type PacingInput } from "@/lib/trade/pacing"
import { summarizeLedger } from "@/lib/trade/ledger"
import {
  evaluatePacingAlerts,
  pacingAlertScopeKeys,
  syncTradeAlerts,
} from "@/lib/trade/alerts"

const RATE_LIMIT = { name: "trade-pacing-recompute", max: 30, windowMs: 60_000 }
const GRAIN = "org"

function parsePeriod(raw: string | null): { year: number; month: number; period: string } {
  const now = new Date()
  const fallback = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  const m = raw?.match(/^(\d{4})-(\d{2})$/)
  const year = m ? Number(m[1]) : fallback.year
  const month = m ? Number(m[2]) : fallback.month
  return { year, month, period: `${year}-${String(month).padStart(2, "0")}` }
}

async function buildInput(orgId: string, year: number, month: number): Promise<PacingInput> {
  const now = new Date()
  const isCurrentMonth = now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month
  const asOfDay = isCurrentMonth ? now.getUTCDate() : new Date(Date.UTC(year, month, 0)).getUTCDate()
  const asOf = new Date(Date.UTC(year, month - 1, asOfDay, 23, 59, 59))

  const pool = await prisma.tradeBudgetPool.findUnique({
    where: { organizationId_year_month_grainKey: { organizationId: orgId, year, month, grainKey: GRAIN } },
    select: { salesPlanAmount: true, budgetAmount: true },
  })

  const entries = await prisma.tradeSpendLedger.findMany({
    where: { organizationId: orgId, year, month, voidedAt: null, entryDate: { lte: asOf } },
    select: {
      entryKind: true,
      amount: true,
      spendType: { select: { id: true, key: true, label: true, accrualMethod: true } },
    },
  })
  const { totals } = summarizeLedger(entries)

  return {
    year,
    month,
    asOfDay,
    salesPlanMonth: pool?.salesPlanAmount ?? 0,
    // 9.5 pending: daily sales actuals land with the invoice adapter.
    salesActualMtd: 0,
    budgetMonth: pool?.budgetAmount ?? 0,
    controlSpendMtd: totals.control,
    accruedSpendMtd: totals.accrued,
    actualSpendMtd: totals.actual,
  }
}

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const { period } = parsePeriod(request.nextUrl.searchParams.get("period"))

  const snapshot = await prisma.tradePacingSnapshot.findFirst({
    where: { organizationId: session.orgId, period, grainKey: GRAIN },
    orderBy: { asOfDate: "desc" },
  })
  if (!snapshot) {
    return NextResponse.json({ ok: true, period, snapshot: null, result: null })
  }
  const result = computePacing(snapshot.math as unknown as PacingInput)
  return NextResponse.json({
    ok: true,
    period,
    snapshot: { asOfDate: snapshot.asOfDate, generatedAt: snapshot.generatedAt },
    result,
  })
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${orgId}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  const { year, month, period } = parsePeriod(request.nextUrl.searchParams.get("period"))
  const input = await buildInput(orgId, year, month)
  const result = computePacing(input)
  const asOfDate = new Date(Date.UTC(year, month - 1, input.asOfDay))

  await prisma.tradePacingSnapshot.upsert({
    where: {
      organizationId_asOfDate_period_grainKey: {
        organizationId: orgId,
        asOfDate,
        period,
        grainKey: GRAIN,
      },
    },
    create: {
      organizationId: orgId,
      asOfDate,
      period,
      grainKey: GRAIN,
      salesPlanMtd: result.salesPlanMtd,
      salesActualMtd: input.salesActualMtd,
      budgetMonth: input.budgetMonth,
      controlSpendMtd: input.controlSpendMtd,
      accruedSpendMtd: input.accruedSpendMtd,
      actualSpendMtd: input.actualSpendMtd,
      forecastSalesMonth: result.forecastSalesMonth,
      forecastSpendMonth: result.forecastSpendMonth,
      forecastBudgetVariance: result.forecastBudgetVariance,
      forecastSalesGap: result.forecastSalesGap,
      riskStatus: result.riskStatus,
      math: input as unknown as object,
    },
    update: {
      salesPlanMtd: result.salesPlanMtd,
      salesActualMtd: input.salesActualMtd,
      budgetMonth: input.budgetMonth,
      controlSpendMtd: input.controlSpendMtd,
      accruedSpendMtd: input.accruedSpendMtd,
      actualSpendMtd: input.actualSpendMtd,
      forecastSalesMonth: result.forecastSalesMonth,
      forecastSpendMonth: result.forecastSpendMonth,
      forecastBudgetVariance: result.forecastBudgetVariance,
      forecastSalesGap: result.forecastSalesGap,
      riskStatus: result.riskStatus,
      math: input as unknown as object,
      generatedAt: new Date(),
    },
  })

  // Alert sync. While salesActualMtd is the 9.5 placeholder (no daily
  // sales feed yet), the pace-gap rule would compare spend against a
  // fake 0% sales progress and false-alarm — suppress it until real
  // actuals exist. Budget-only rules (overspend forecast, unused
  // budget) stay live; scopeKeys stay full so stale gap alerts resolve.
  const candidates = evaluatePacingAlerts(period, GRAIN, result).filter(
    (c) => c.ruleId !== "trade_spend_ahead_of_sales" || input.salesActualMtd > 0,
  )
  const sync = await syncTradeAlerts(prisma.alert, orgId, candidates, pacingAlertScopeKeys(period, GRAIN))

  return NextResponse.json({ ok: true, period, result, alerts: sync })
}
