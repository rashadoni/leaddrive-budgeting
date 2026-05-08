import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, getSession } from "@/lib/api-auth"
import { prisma, logBudgetChange } from "@/lib/prisma"
import { buildDeptFilter } from "@/lib/budgeting/department-access"
import { processCurrencyFields } from "@/lib/budgeting/currency"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import type { Role } from "@/lib/permissions"

const createActualSchema = z.object({
  plan_id: z.string().max(100).optional(),
  planId: z.string().max(100).optional(),
  category: z.string().min(1).max(500),
  department: z.string().max(200).optional().nullable(),
  line_type: z.string().max(50).optional(),
  lineType: z.string().max(50).optional(),
  actual_amount: z.number().min(0).max(999999999).optional(),
  actualAmount: z.number().min(0).max(999999999).optional(),
  expenseDate: z.string().max(50).optional().nullable(),
  expense_date: z.string().max(50).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
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

  const actuals = await prisma.budgetActual.findMany({
    where: { planId, organizationId: orgId, ...deptFilter },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ success: true, data: actuals })
}

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

  let validatedBody
  try {
    validatedBody = createActualSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { plan_id, planId, category, department, line_type, lineType, actual_amount, actualAmount, expenseDate, expense_date, description, currencyCode, exchangeRate } = validatedBody

  const resolvedPlanId = planId || plan_id
  const resolvedLineType = lineType || line_type || "expense"
  const resolvedAmount = actualAmount ?? actual_amount ?? 0
  const resolvedDate = expenseDate || expense_date

  if (!resolvedPlanId || !category) {
    return NextResponse.json({ error: "planId and category are required" }, { status: 400 })
  }

  // Check plan is not approved
  const plan = await prisma.budgetPlan.findFirst({ where: { id: resolvedPlanId, organizationId: orgId } })
  if (plan?.status === "approved") {
    return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
  }

  // Phase 7.G Turn LXVIII (Phase 4.2 fan-out). Reject mutations on
  // budget-actual entries when the plan's period is locked at the org
  // level (CFO closed-period control). RFC 4918 423 Locked.
  if (plan) {
    const periodKey = derivePeriodKey(plan)
    const lock = await getActivePeriodLock(prisma, orgId, periodKey)
    if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "POST /api/budgeting/actuals" })
  }

  if (Number(resolvedAmount) < 0) {
    return NextResponse.json({ error: "Amount cannot be negative" }, { status: 400 })
  }

  // Process currency conversion (F7)
  const currencyFields = await processCurrencyFields(
    orgId,
    Number(resolvedAmount),
    currencyCode || null,
    exchangeRate != null ? Number(exchangeRate) : null,
  )

  const actual = await prisma.budgetActual.create({
    data: {
      organizationId: orgId,
      planId: resolvedPlanId,
      category,
      department: department || null,
      lineType: resolvedLineType,
      actualAmount: currencyFields.plannedAmount, // converted to base currency
      expenseDate: resolvedDate || null,
      description: description || null,
      currencyCode: currencyFields.currencyCode,
      exchangeRate: currencyFields.exchangeRate,
      originalAmount: currencyFields.originalAmount,
    },
  })

  logBudgetChange({ orgId, planId: resolvedPlanId, entityType: "actual", entityId: actual.id, action: "create", snapshot: actual })

  return NextResponse.json({ success: true, data: actual }, { status: 201 })
}
