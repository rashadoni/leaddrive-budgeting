import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, getSession } from "@/lib/api-auth"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { consumeApprovalRequest, claimApprovalRequest } from "@/lib/budgeting/approval-request"
import { prisma, logBudgetChange } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"
import { getPeriodMonths, computePlannedForLine } from "@/lib/budgeting/cost-model-map"
import { buildDeptFilter } from "@/lib/budgeting/department-access"
import { processCurrencyFields } from "@/lib/budgeting/currency"
import { resolveAccountId } from "@/lib/budgeting/chart-of-accounts"
import type { Role } from "@/lib/permissions"
// Phase 5.2 Stage 2 Tier 3 (2026-05-21) — RLS wrap for budget_lines + budget_plans reads/writes.
import { withOrgScope } from "@/lib/db/with-org-scope"

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
  const [lines, plan] = await withOrgScope(orgId, async (tx) =>
    Promise.all([
      tx.budgetLine.findMany({
        where: { planId, organizationId: orgId, parentId: null, ...deptFilter },
        orderBy: [{ sortOrder: "asc" }],
        include: {
          children: {
            orderBy: [{ sortOrder: "asc" }],
            include: { account: { select: { code: true, name: true } } },
            ...(deptFilter ? { where: deptFilter } : {}),
          },
          account: { select: { code: true, name: true } },
        },
      }),
      tx.budgetPlan.findFirst({ where: { id: planId, organizationId: orgId } }),
    ])
  )

  // Compute dynamic planned amounts for isAutoPlanned lines
  // Phase 8 D3(o) (2026-05-28) — Prisma's include result is fully typed
  // (BudgetLine + children: BudgetLine[] + account: { code, name }), so
  // the (l as any) casts that used to bridge over the children field
  // are no longer necessary. `line.children` is `BudgetLine[] | undefined`.
  const allLines = lines.flatMap((l) => [l, ...(l.children ?? [])])
  const hasAutoPlanned = allLines.some((l) => l.isAutoPlanned)

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
      if (line.isAutoPlanned) {
        line.plannedAmount = computePlannedForLine(line, costModel, salesForecasts, periodMonthCount, periodMonthNumbers, expenseForecasts)
      }
      for (const child of line.children ?? []) {
        if (child.isAutoPlanned) {
          child.plannedAmount = computePlannedForLine(child, costModel, salesForecasts, periodMonthCount, periodMonthNumbers, expenseForecasts)
        }
      }
    }
  }

  return NextResponse.json({ success: true, data: lines })
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

  // Phase 7.G Turn LXXII (Phase 4.3 — approval-request bypass). If the
  // request includes `?approvalRequestId=X` AND the request is approved,
  // belongs to this user, matches `budget_line_create`, AND its planId
  // matches the mutation target plan, the 403/423 gates below are skipped.
  // After consume passes, atomic claim BEFORE mutation closes the TOCTOU
  // race that would otherwise allow concurrent double-apply.
  const approvalRequestId = req.nextUrl.searchParams.get("approvalRequestId")
  const bypassRequest = approvalRequestId
    ? await consumeApprovalRequest(prisma, {
        requestId: approvalRequestId,
        orgId,
        userId,
        expectedType: "budget_line_create",
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
  const plan = await withOrgScope(orgId, async (tx) =>
    tx.budgetPlan.findFirst({ where: { id: resolvedPlanId, organizationId: orgId } })
  )
  if (plan?.status === "approved" && !bypassRequest) {
    return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
  }

  // Phase 7.G Turn LXVII (Phase 4.2 — period lock enforcement). If the
  // plan's period (annual / quarterly / monthly) is locked at the org
  // level, reject the write with 423 Locked. CFO controls who can
  // mutate closed periods. Bypass via approved ApprovalRequest (LXXII).
  if (plan && !bypassRequest) {
    const periodKey = derivePeriodKey(plan)
    const lock = await getActivePeriodLock(prisma, orgId, periodKey)
    if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "POST /api/budgeting/lines" })
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

  // Phase 2.1 session 3: `accountId` is now NOT NULL on BudgetLine.
  // Resolve from `category` (SAP code or name → CoA lookup). If not found,
  // return 422 — callers must send a valid account code.
  const accountId = await resolveAccountId(prisma, orgId, category)
  if (!accountId) {
    return NextResponse.json(
      { error: `No ChartOfAccount found for category "${category}". Provide a valid account code.` },
      { status: 422 },
    )
  }

  const line = await withOrgScope(orgId, async (tx) =>
    tx.budgetLine.create({
      data: {
        organizationId: orgId,
        planId: resolvedPlanId,
        // Phase 2.1 session 3: `category` String dropped from BudgetLine.
        // `accountId` (NOT NULL) is now the identity — resolved above via
        // resolveAccountId(). `category` is still accepted in request body
        // for backward-compat but is not written to the DB.
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
        accountId,
      },
    })
  )

  logBudgetChange({ orgId, planId: resolvedPlanId, entityType: "line", entityId: line.id, action: "create", snapshot: line })

  // appliedAt was already stamped atomically via claimApprovalRequest above
  // (Turn LXXII architect ⚠️ #2 closure). No post-mutation work needed.

  return NextResponse.json({ success: true, data: line }, { status: 201 })
}
