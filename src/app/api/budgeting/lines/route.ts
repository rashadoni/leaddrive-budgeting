import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, getSession } from "@/lib/api-auth"
import { prisma, logBudgetChange } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"
import { getPeriodMonths, computePlannedForLine } from "@/lib/budgeting/cost-model-map"
import { buildDeptFilter } from "@/lib/budgeting/department-access"
import { processCurrencyFields } from "@/lib/budgeting/currency"
import type { Role } from "@/lib/permissions"

const createLineSchema = z.object({
  plan_id: z.string().max(100).optional(),
  planId: z.string().max(100).optional(),
  category: z.string().min(1).max(500),
  department: z.string().max(200).optional().nullable(),
  line_type: z.string().max(50).optional(),
  lineType: z.string().max(50).optional(),
  lineSubtype: z.string().max(50).optional().nullable(),
  planned_amount: z.number().min(0).max(999999999).optional(),
  plannedAmount: z.number().min(0).max(999999999).optional(),
  forecastAmount: z.number().min(0).max(999999999).optional().nullable(),
  unitPrice: z.number().min(0).max(999999999).optional().nullable(),
  unitCost: z.number().min(0).max(999999999).optional().nullable(),
  quantity: z.number().min(0).max(999999999).optional().nullable(),
  costModelKey: z.string().max(200).optional().nullable(),
  isAutoActual: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
  parentId: z.string().max(100).optional().nullable(),
  currencyCode: z.string().max(10).optional().nullable(),
  exchangeRate: z.number().min(0).max(999999999).optional().nullable(),
})

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { orgId, userId, role } = session

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  // Department access filter
  const deptFilter = await buildDeptFilter(orgId, userId, role as Role)

  // Return top-level lines with nested children
  const [lines, plan] = await Promise.all([
    prisma.budgetLine.findMany({
      where: { planId, organizationId: orgId, parentId: null, ...deptFilter },
      orderBy: [{ sortOrder: "asc" }, { category: "asc" }],
      include: {
        children: {
          orderBy: [{ sortOrder: "asc" }, { category: "asc" }],
          ...(deptFilter ? { where: deptFilter } : {}),
        },
      },
    }),
    prisma.budgetPlan.findFirst({ where: { id: planId, organizationId: orgId } }),
  ])

  // Compute dynamic planned amounts for isAutoPlanned lines
  const allLines = lines.flatMap((l: any) => [l, ...(l.children ?? [])])
  const hasAutoPlanned = allLines.some((l: any) => l.isAutoPlanned)

  if (hasAutoPlanned && plan) {
    const costModel = await loadAndCompute(orgId).catch(() => null)
    const { count: periodMonthCount, months: periodMonthNumbers } = getPeriodMonths(plan)
    const [salesForecasts, expenseForecasts] = await Promise.all([
      prisma.salesForecast.findMany({
        where: { organizationId: orgId, year: plan.year, month: { in: periodMonthNumbers } },
      }),
      prisma.expenseForecast.findMany({
        where: { organizationId: orgId, year: plan.year, month: { in: periodMonthNumbers } },
      }),
    ])

    for (const line of lines) {
      if ((line as any).isAutoPlanned) {
        ;(line as any).plannedAmount = computePlannedForLine(line as any, costModel, salesForecasts, periodMonthCount, periodMonthNumbers, expenseForecasts)
      }
      for (const child of (line as any).children ?? []) {
        if (child.isAutoPlanned) {
          child.plannedAmount = computePlannedForLine(child, costModel, salesForecasts, periodMonthCount, periodMonthNumbers, expenseForecasts)
        }
      }
    }
  }

  return NextResponse.json({ success: true, data: lines })
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let validatedBody
  try {
    validatedBody = createLineSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { plan_id, planId, category, department, line_type, lineType, lineSubtype, planned_amount, plannedAmount, forecastAmount, unitPrice, unitCost, quantity, costModelKey, isAutoActual, notes, parentId, currencyCode, exchangeRate } = validatedBody

  const resolvedPlanId = planId || plan_id
  const resolvedLineType = lineType || line_type || "expense"
  const resolvedAmount = plannedAmount ?? planned_amount ?? 0

  if (!resolvedPlanId || !category) {
    return NextResponse.json({ error: "planId and category are required" }, { status: 400 })
  }

  // Check plan is not approved
  const plan = await prisma.budgetPlan.findFirst({ where: { id: resolvedPlanId, organizationId: orgId } })
  if (plan?.status === "approved") {
    return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
  }

  if (Number(resolvedAmount) < 0) {
    return NextResponse.json({ error: "Amount cannot be negative" }, { status: 400 })
  }

  if (forecastAmount != null && Number(forecastAmount) < 0) {
    return NextResponse.json({ error: "Forecast amount cannot be negative" }, { status: 400 })
  }

  // Process currency conversion (F7)
  const currencyFields = await processCurrencyFields(
    orgId,
    Number(resolvedAmount),
    currencyCode || null,
    exchangeRate != null ? Number(exchangeRate) : null,
  )

  const line = await prisma.budgetLine.create({
    data: {
      organizationId: orgId,
      planId: resolvedPlanId,
      category,
      department: department || null,
      lineType: resolvedLineType,
      lineSubtype: lineSubtype || null,
      plannedAmount: currencyFields.plannedAmount,
      forecastAmount: forecastAmount != null ? Number(forecastAmount) : null,
      unitPrice: unitPrice != null ? Number(unitPrice) : null,
      unitCost: unitCost != null ? Number(unitCost) : null,
      quantity: quantity != null ? Number(quantity) : null,
      costModelKey: costModelKey || null,
      isAutoActual: isAutoActual === true,
      notes: notes || null,
      parentId: parentId || null,
      currencyCode: currencyFields.currencyCode,
      exchangeRate: currencyFields.exchangeRate,
      originalAmount: currencyFields.originalAmount,
    },
  })

  logBudgetChange({ orgId, planId: resolvedPlanId, entityType: "line", entityId: line.id, action: "create", snapshot: line })

  return NextResponse.json({ success: true, data: line }, { status: 201 })
}
