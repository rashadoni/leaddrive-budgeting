import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, requireRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"
import { logBudgetPlanCreate } from "@/lib/audit/import-helpers"
// Phase 5.2 Stage 2 Tier 3 (2026-05-21) — RLS wrap for budget_plans reads/writes.
import { withOrgScope } from "@/lib/db/with-org-scope"

const createPlanSchema = z.object({
  name: z.string().min(1).max(500),
  periodType: z.enum(["monthly", "quarterly", "annual"]),
  year: z.number().int().min(2020).max(2050),
  month: z.number().int().min(1).max(12).optional().nullable(),
  quarter: z.number().int().min(1).max(4).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
}).strict()

const DEPT_CATEGORY_MAP: Record<string, string> = {
  it: "Daimi IT", infosec: "InfoSec",
  erp: "ERP", grc: "GRC", pm: "PM",
  helpdesk: "HelpDesk", cloud: "Cloud", waf: "WAF",
}

function getPeriodMonths(periodType: string, quarter?: number | null, month?: number | null): number[] {
  if (periodType === "annual") return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  if (periodType === "quarterly" && quarter) {
    const start = (quarter - 1) * 3 + 1
    return [start, start + 1, start + 2]
  }
  if (periodType === "monthly" && month) return [month]
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
}

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Clients can opt in to deleted plans via ?includeDeleted=true (used by the
  // Recently Deleted / Restore UI). By default only live plans are returned.
  const { searchParams } = new URL(req.url)
  const includeDeleted = searchParams.get("includeDeleted") === "true"
  const onlyDeleted = searchParams.get("onlyDeleted") === "true"

  const plansRaw = await withOrgScope(orgId, async (tx) =>
    tx.budgetPlan.findMany({
      where: {
        organizationId: orgId,
        ...(onlyDeleted
          ? { deletedAt: { not: null } }
          : includeDeleted
            ? {}
            : { deletedAt: null }),
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: {
        _count: {
          select: {
            // Phase 7.M follow-up (2026-05-19) — include LIVE line count
            // so the page's `plans[0]` default-pick skips empty plans.
            // Without this, a leftover empty "Rolling Forecast 2026"
            // plan with `month=5` sorted ahead of populated plans and
            // landed the user on an empty workspace (zero P&L / cash
            // flow / etc.). The frontend re-orders by `_count.lines
            // desc` as the FIRST sort key — non-empty plans always win
            // — and the existing year/month order acts as the secondary
            // tiebreaker.
            // Note: relation field is `lines` on BudgetPlan (not `budgetLines`).
            lines: { where: { deletedAt: null } },
          },
        },
      },
    })
  )

  // Re-order: non-empty plans first, then preserve the year/month
  // server-side ordering as the secondary key. Stable sort keeps
  // same-bucket items in their original DB order.
  const plans = [...plansRaw].sort((a, b) => {
    const aHas = a._count.lines > 0 ? 1 : 0
    const bHas = b._count.lines > 0 ? 1 : 0
    return bHas - aHas // 1 (non-empty) wins; 0 (empty) loses
  })

  return NextResponse.json({ success: true, data: plans })
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, "manager")
  if (session instanceof NextResponse) return session
  const { orgId, userId } = session

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = createPlanSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, periodType, year, month, quarter, notes } = data

  // Check for duplicate plan in same period — ignore soft-deleted plans,
  // otherwise user can't re-create after a Reset/Delete.
  const duplicate = await withOrgScope(orgId, async (tx) =>
    tx.budgetPlan.findFirst({
      where: {
        organizationId: orgId,
        periodType,
        year,
        deletedAt: null,
        ...(month ? { month } : {}),
        ...(quarter ? { quarter } : {}),
      },
    })
  )
  if (duplicate) {
    return NextResponse.json({ error: `A plan for this period already exists: "${duplicate.name}"` }, { status: 409 })
  }

  const plan = await withOrgScope(orgId, async (tx) =>
    tx.budgetPlan.create({
      data: {
        organizationId: orgId,
        name,
        periodType,
        year,
        month: month ?? null,
        quarter: quarter ?? null,
        notes: notes || null,
      },
    })
  )

  // Auto-populate: clone lines from existing plan + fill from sales forecast & cost model
  try {
    const planYear = year
    const planMonths = getPeriodMonths(periodType, quarter ?? null, month ?? null)

    // Clone budget line structure from any existing plan
    const sourcePlan = await prisma.budgetPlan.findFirst({
      where: { organizationId: orgId, id: { not: plan.id }, isRolling: false },
      orderBy: { createdAt: "asc" },
    })

    if (sourcePlan) {
      const allSourceLines = await prisma.budgetLine.findMany({ where: { planId: sourcePlan.id }, include: { account: { select: { code: true, name: true } } } })
      const costModel = await loadAndCompute(orgId)

      // Filter source lines to only include months relevant to this plan period
      // sortOrder % 100 = month index (0-11), so month = (sortOrder % 100) + 1
      const planMonthIndices = new Set(planMonths.map(m => m - 1)) // convert to 0-based
      const sourceLines = allSourceLines.filter((sl: any) => {
        const monthIdx = sl.sortOrder % 100
        return planMonthIndices.has(monthIdx)
      })

      // Load sales forecast for revenue (user's Excel forecast)
      const salesForecasts = await prisma.salesForecast.findMany({
        where: { organizationId: orgId, year: planYear, month: { in: planMonths } },
        include: { budgetDept: { select: { key: true } } },
      })

      // Sum forecast by department key for the plan's months
      const forecastByDept: Record<string, number> = {}
      for (const sf of salesForecasts) {
        const key = sf.budgetDept.key
        forecastByDept[key] = (forecastByDept[key] || 0) + sf.amount
      }

      // Clone parent lines first, then children with mapped parentId
      const parentLines = sourceLines.filter((sl: any) => !sl.parentId)
      const childLines = sourceLines.filter((sl: any) => sl.parentId)
      const idMapping = new Map<string, string>() // oldId → newId

      for (const sl of parentLines) {
        let plannedAmount = 0

        if (sl.lineType === "revenue") {
          const slDisplayName = (sl as any).account?.name ?? (sl as any).account?.code ?? ""
          for (const [deptKey, category] of Object.entries(DEPT_CATEGORY_MAP)) {
            if (slDisplayName === category) {
              plannedAmount = forecastByDept[deptKey] ?? 0
              break
            }
          }
        }
        if (plannedAmount === 0 && sl.costModelKey) {
          const parts = sl.costModelKey.split(".")
          if (parts[0] === "serviceDetails" && parts.length === 3) {
            const detail = costModel.serviceDetails[parts[1]]
            if (detail && parts[2] in detail) {
              plannedAmount = ((detail as any)[parts[2]] ?? 0) * planMonths.length
            }
          }
        }
        // Fallback: copy original amount if no forecast/cost model data
        if (plannedAmount === 0) {
          plannedAmount = sl.plannedAmount
        }

        const created = await prisma.budgetLine.create({
          data: {
            organizationId: orgId, planId: plan.id,
            department: sl.department, lineType: sl.lineType,
            plannedAmount: Math.round(plannedAmount * 100) / 100,
            costModelKey: sl.costModelKey,
            isAutoActual: false, isAutoPlanned: false,
            notes: sl.notes, sortOrder: sl.sortOrder,
            // Phase 2.1 session 3: accountId is NOT NULL — pass through directly.
            accountId: sl.accountId,
            lineSubtype: sl.lineSubtype, parentId: null,
          },
        })
        idMapping.set(sl.id, created.id)
      }

      for (const sl of childLines) {
        let plannedAmount = 0

        if (sl.costModelKey) {
          const parts = sl.costModelKey.split(".")
          if (parts[0] === "serviceDetails" && parts.length === 3) {
            const detail = costModel.serviceDetails[parts[1]]
            if (detail && parts[2] in detail) {
              plannedAmount = ((detail as any)[parts[2]] ?? 0) * planMonths.length
            }
          }
        } else {
          plannedAmount = sl.plannedAmount
        }

        const newParentId = sl.parentId ? idMapping.get(sl.parentId) ?? null : null
        await prisma.budgetLine.create({
          data: {
            organizationId: orgId, planId: plan.id,
            department: sl.department, lineType: sl.lineType,
            plannedAmount: Math.round(plannedAmount * 100) / 100,
            costModelKey: sl.costModelKey,
            isAutoActual: false, isAutoPlanned: false,
            notes: sl.notes, sortOrder: sl.sortOrder,
            // Phase 2.1 session 3: accountId is NOT NULL — pass through directly.
            accountId: sl.accountId,
            lineSubtype: sl.lineSubtype, parentId: newParentId,
          },
        })
      }
    }

    // Clone Sales Budget lines (filtered by period months)
    const sourceSales = await prisma.salesBudgetLine.findMany({
      where: { organizationId: orgId, planId: sourcePlan.id, month: { in: planMonths } },
    })
    if (sourceSales.length > 0) {
      await prisma.salesBudgetLine.createMany({
        data: sourceSales.map((s: any) => ({
          organizationId: orgId,
          planId: plan.id,
          productLineId: s.productLineId,
          year: s.year,
          month: s.month,
          quantity: s.quantity,
          unitPrice: s.unitPrice,
          amount: s.amount,
          notes: s.notes,
        })),
      })
    }

    // Clone COGS Budget lines (filtered by period months)
    const sourceCogs = await prisma.cOGSBudgetLine.findMany({
      where: { organizationId: orgId, planId: sourcePlan.id, month: { in: planMonths } },
    })
    if (sourceCogs.length > 0) {
      await prisma.cOGSBudgetLine.createMany({
        data: sourceCogs.map((c: any) => ({
          organizationId: orgId,
          planId: plan.id,
          productLineId: c.productLineId,
          accountCode: c.accountCode,
          year: c.year,
          month: c.month,
          productionQty: c.productionQty,
          totalCost: c.totalCost,
          notes: c.notes,
        })),
      })
    }

    // Clone Balance Sheet lines (filtered by period months)
    const sourceBS = await prisma.balanceSheetLine.findMany({
      where: { organizationId: orgId, planId: sourcePlan.id, month: { in: planMonths } },
    })
    if (sourceBS.length > 0) {
      await prisma.balanceSheetLine.createMany({
        data: sourceBS.map((b: any) => ({
          organizationId: orgId,
          planId: plan.id,
          accountCode: b.accountCode,
          accountName: b.accountName,
          lineType: b.lineType,
          subType: b.subType,
          year: b.year,
          month: b.month,
          amount: b.amount,
          notes: b.notes,
        })),
      })
    }

    // Clone Assumptions (not month-specific, copy all)
    const sourceAssumptions = await prisma.budgetAssumption.findMany({
      where: { organizationId: orgId, planId: sourcePlan.id },
    })
    if (sourceAssumptions.length > 0) {
      await prisma.budgetAssumption.createMany({
        data: sourceAssumptions.map((a: any) => ({
          organizationId: orgId,
          planId: plan.id,
          category: a.category,
          key: a.key,
          label: a.label,
          value: a.value,
          unit: a.unit,
          period: a.period,
          notes: a.notes,
          sortOrder: a.sortOrder,
        })),
      })
    }
  } catch (e) {
    console.error("Auto-populate plan error:", e)
  }

  // Phase 7.F (Turn 25) — emit audit. Non-blocking; logger failure
  // surfaces as `auditStale: true` rather than aborting the create.
  const auditResult = await logBudgetPlanCreate(prisma, {
    organizationId: orgId,
    actorUserId: userId || null,
    planId: plan.id,
    planName: plan.name,
    year: plan.year,
    scope: plan.periodType,
    context: {
      route: "/api/budgeting/plans",
      userAgent: req.headers.get("user-agent") ?? undefined,
    },
  })
  const auditStale = !auditResult.ok

  return NextResponse.json({ success: true, data: plan, auditStale }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  // Bulk destructive operation — admin only (reset / deleteAll clears org data)
  const session = await requireRole(req, "admin")
  if (session instanceof NextResponse) return session
  const { orgId, userId } = session

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  const deleteAll = searchParams.get("deleteAll") === "true"

  // DELETE ALL — soft-delete every plan in the org.
  // Child rows (lines, actuals, forecasts, balance sheet, COGS, assumptions,
  // comments, reports, change logs) and org-level masters (chart of accounts,
  // product lines, cost types, etc.) are KEPT so that a plan restore brings
  // everything back. A background cleanup job physically removes plans whose
  // `deletedAt` is older than 30 days.
  if (deleteAll && !planId) {
    const result = await withOrgScope(orgId, async (tx) =>
      tx.budgetPlan.updateMany({
        where: { organizationId: orgId, deletedAt: null },
        data: { deletedAt: new Date(), deletedBy: userId },
      })
    )
    return NextResponse.json({ success: true, deletedPlans: result.count, deletedAll: true })
  }

  // DELETE single plan
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const result = await withOrgScope(orgId, async (tx) =>
    tx.budgetPlan.updateMany({
      where: { id: planId, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId },
    })
  )
  if (result.count === 0) {
    return NextResponse.json({ error: "Plan not found or already deleted" }, { status: 404 })
  }

  return NextResponse.json({ success: true, deletedPlan: planId, deletedAll: false })
}
