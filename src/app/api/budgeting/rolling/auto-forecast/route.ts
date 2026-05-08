import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { findFirstActiveLockInPeriods, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeysForMonths } from "@/lib/budgeting/period-lock-http"

const autoForecastSchema = z.object({
  planId: z.string().min(1).max(100),
  lookbackMonths: z.number().int().min(1).max(60).optional(),
}).strict()

// POST — auto-generate forecast based on linear trend from recent actuals
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
    data = autoForecastSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { planId, lookbackMonths = 6 } = data

  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  // Get recent actuals grouped by category + month
  const actuals = await prisma.budgetActual.findMany({
    where: { planId, organizationId: orgId },
    orderBy: { createdAt: "desc" },
  })

  // Group actuals by category
  const byCategory = new Map<string, Array<{ month: number; year: number; amount: number }>>()
  for (const a of actuals) {
    if (!a.expenseDate) continue
    const d = new Date(a.expenseDate)
    const key = `${a.category}||${a.lineType}`
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key)!.push({
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      amount: a.actualAmount,
    })
  }

  // Get forecast months
  const forecastMonths = await prisma.rollingForecastMonth.findMany({
    where: { planId, organizationId: orgId, status: "forecast" },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  })

  // Phase 7.G Turn LXIX (Phase 4.2 bulk-mutation gate). auto-forecast
  // upserts forecast entries into the forecastMonths array. Reject if
  // the plan's period OR any forecast month's containing periods are
  // locked. Plan's period is included even though rolling plans are
  // monthly — locking the plan year would correctly block the auto-fill.
  const planKey = derivePeriodKey(plan)
  const monthKeys = containingPeriodKeysForMonths(
    forecastMonths.map((m: { year: number; month: number }) => ({ year: m.year, month: m.month })),
  )
  const afLock = await findFirstActiveLockInPeriods(
    prisma,
    orgId,
    Array.from(new Set([planKey, ...monthKeys])),
  )
  if (afLock) return lockedResponse(afLock)

  let created = 0

  for (const [key, data] of byCategory) {
    const [category, lineType] = key.split("||")

    // Simple linear regression on last N months
    // Aggregate by month
    const monthlyTotals = new Map<string, number>()
    for (const d of data) {
      const k = `${d.year}-${d.month}`
      monthlyTotals.set(k, (monthlyTotals.get(k) || 0) + d.amount)
    }

    const sorted = [...monthlyTotals.entries()]
      .sort()
      .slice(-lookbackMonths)

    if (sorted.length < 2) continue

    // Linear regression: y = a + bx
    const n = sorted.length
    const xs = sorted.map((_, i) => i)
    const ys = sorted.map(([, v]) => v)
    const sumX = xs.reduce((a, b) => a + b, 0)
    const sumY = ys.reduce((a, b) => a + b, 0)
    const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0)
    const sumX2 = xs.reduce((a, x) => a + x * x, 0)

    const b = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0
    const a = sumY / n - b * sumX / n

    // Project for each forecast month
    for (let i = 0; i < forecastMonths.length; i++) {
      const fm = forecastMonths[i]
      const projected = Math.max(0, a + b * (n + i))

      await prisma.budgetForecastEntry.upsert({
        where: {
          planId_year_month_category_lineType: {
            planId,
            year: fm.year,
            month: fm.month,
            category,
            lineType,
          },
        },
        update: { forecastAmount: projected },
        create: {
          organizationId: orgId,
          planId,
          year: fm.year,
          month: fm.month,
          category,
          lineType,
          forecastAmount: projected,
        },
      })
      created++
    }
  }

  return NextResponse.json({
    success: true,
    forecastEntriesCreated: created,
    categoriesProcessed: byCategory.size,
  })
}
