import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, getSession } from "@/lib/api-auth"
import { prisma, logBudgetChange } from "@/lib/prisma"
import { buildDeptFilter } from "@/lib/budgeting/department-access"
import { processCurrencyFields } from "@/lib/budgeting/currency"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { consumeApprovalRequest, claimApprovalRequest } from "@/lib/budgeting/approval-request"
import { deriveMonthIndex } from "@/lib/budgeting/derive-month-index"
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

  // Phase 7.G Turn LXXII (Phase 4.3 — approval-request bypass) + ⚠️ #1+#2 closure:
  // expectedPlanId scope check + atomic claim before mutation.
  const approvalRequestId = req.nextUrl.searchParams.get("approvalRequestId")
  const bypassRequest = approvalRequestId
    ? await consumeApprovalRequest(prisma, {
        requestId: approvalRequestId,
        orgId,
        userId,
        expectedType: "budget_actual_create",
        expectedPlanId: resolvedPlanId,
      })
    : null
  if (bypassRequest) {
    const claimed = await claimApprovalRequest(prisma, bypassRequest.id)
    if (!claimed) {
      return NextResponse.json(
        { error: "Approval request already used by a concurrent mutation" },
        { status: 409 },
      )
    }
  }

  // Check plan is not approved
  const plan = await prisma.budgetPlan.findFirst({ where: { id: resolvedPlanId, organizationId: orgId } })
  if (plan?.status === "approved" && !bypassRequest) {
    return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
  }

  // Phase 7.G Turn LXVIII (Phase 4.2 fan-out). Reject mutations on
  // budget-actual entries when the plan's period is locked at the org
  // level (CFO closed-period control). RFC 4918 423 Locked.
  if (plan && !bypassRequest) {
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

  // Phase 3.1 v1.2 — derive monthIndex (0-indexed) from expense date
  // if it parses as YYYY-MM-DD; null fallback for free-form dates.
  // VarianceTab sparkline reads this to overlay actual vs planned.
  const monthIndex = deriveMonthIndex(resolvedDate)
  const actual = await prisma.budgetActual.create({
    data: {
      organizationId: orgId,
      planId: resolvedPlanId,
      category,
      department: department || null,
      lineType: resolvedLineType,
      actualAmount: currencyFields.plannedAmount, // converted to base currency
      expenseDate: resolvedDate || null,
      monthIndex,
      description: description || null,
      currencyCode: currencyFields.currencyCode,
      exchangeRate: currencyFields.exchangeRate,
      originalAmount: currencyFields.originalAmount,
    },
  })

  logBudgetChange({ orgId, planId: resolvedPlanId, entityType: "actual", entityId: actual.id, action: "create", snapshot: actual })

  // appliedAt was already stamped atomically via claimApprovalRequest above.

  return NextResponse.json({ success: true, data: actual }, { status: 201 })
}
