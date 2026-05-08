import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma, logBudgetChange } from "@/lib/prisma"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"

/**
 * Phase 7.G Turn LXVIII follow-up — period-lock check helper for [id]
 * PUT/DELETE handlers. Loads plan (with period fields) by id+org, derives
 * the period key, and returns the lock record if active. The plan-load is
 * also load-bearing for cross-tenant safety: an un-org'd plan returns null
 * (no lock found, but the calling handler should also re-verify the line
 * row belongs to the org via its own organizationId filter).
 *
 * Phase 7.G Turn LXIX cleanup: `lockedResponse` migrated to shared
 * `period-lock-http.ts` (was inline 3 times, now centralized).
 */
async function findActiveLockForPlan(orgId: string, planId: string) {
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    select: { periodType: true, year: true, month: true, quarter: true },
  })
  if (!plan) return null
  const periodKey = derivePeriodKey(plan)
  return getActivePeriodLock(prisma, orgId, periodKey)
}

const updateLineSchema = z.object({
  category: z.string().min(1).max(500).optional(),
  department: z.string().max(200).optional().nullable(),
  lineType: z.string().max(50).optional(),
  lineSubtype: z.string().max(50).optional().nullable(),
  plannedAmount: z.number().min(0).max(999999999).optional(),
  forecastAmount: z.number().min(0).max(999999999).optional().nullable(),
  unitPrice: z.number().min(0).max(999999999).optional().nullable(),
  unitCost: z.number().min(0).max(999999999).optional().nullable(),
  quantity: z.number().min(0).max(999999999).optional().nullable(),
  costModelKey: z.string().max(200).optional().nullable(),
  isAutoActual: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
  parentId: z.string().max(100).optional().nullable(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = updateLineSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { category, department, lineType, lineSubtype, plannedAmount, forecastAmount, unitPrice, unitCost, quantity, costModelKey, isAutoActual, notes, parentId } = data

  // Fetch old state for change log
  const line = await prisma.budgetLine.findFirst({ where: { id, organizationId: orgId } })
  if (line) {
    const plan = await prisma.budgetPlan.findFirst({ where: { id: line.planId }, select: { status: true } })
    if (plan?.status === "approved") {
      return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
    }
    const lock = await findActiveLockForPlan(orgId, line.planId)
    if (lock) return lockedResponse(lock)
  }

  if (plannedAmount !== undefined && Number(plannedAmount) < 0) {
    return NextResponse.json({ error: "Amount cannot be negative" }, { status: 400 })
  }
  if (forecastAmount !== undefined && forecastAmount != null && Number(forecastAmount) < 0) {
    return NextResponse.json({ error: "Forecast amount cannot be negative" }, { status: 400 })
  }

  const result = await prisma.budgetLine.updateMany({
    where: { id, organizationId: orgId },
    data: {
      ...(category !== undefined && { category }),
      ...(department !== undefined && { department }),
      ...(lineType !== undefined && { lineType }),
      ...(lineSubtype !== undefined && { lineSubtype: lineSubtype || null }),
      ...(plannedAmount !== undefined && { plannedAmount: Number(plannedAmount) }),
      ...(forecastAmount !== undefined && { forecastAmount: forecastAmount != null ? Number(forecastAmount) : null }),
      ...(unitPrice !== undefined && { unitPrice: unitPrice != null ? Number(unitPrice) : null }),
      ...(unitCost !== undefined && { unitCost: unitCost != null ? Number(unitCost) : null }),
      ...(quantity !== undefined && { quantity: quantity != null ? Number(quantity) : null }),
      ...(costModelKey !== undefined && { costModelKey: costModelKey || null }),
      ...(isAutoActual !== undefined && { isAutoActual: Boolean(isAutoActual) }),
      ...(notes !== undefined && { notes }),
      ...(parentId !== undefined && { parentId: parentId || null }),
    },
  })

  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.budgetLine.findFirst({ where: { id, organizationId: orgId } })

  if (updated && line) {
    // Log each changed field
    const fields = ["category", "department", "lineType", "lineSubtype", "plannedAmount", "forecastAmount", "unitPrice", "unitCost", "quantity", "costModelKey", "isAutoActual", "notes", "parentId"] as const
    for (const f of fields) {
      const oldVal = (line as any)[f]
      const newVal = (updated as any)[f]
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        logBudgetChange({ orgId, planId: line.planId, entityType: "line", entityId: id, action: "update", field: f, oldValue: oldVal, newValue: newVal, snapshot: updated })
      }
    }
  }

  return NextResponse.json({ success: true, data: updated })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  // Fetch full state before deletion for change log
  const lineToDelete = await prisma.budgetLine.findFirst({ where: { id, organizationId: orgId } })
  if (lineToDelete) {
    const plan = await prisma.budgetPlan.findFirst({ where: { id: lineToDelete.planId }, select: { status: true } })
    if (plan?.status === "approved") {
      return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
    }
    const lock = await findActiveLockForPlan(orgId, lineToDelete.planId)
    if (lock) return lockedResponse(lock)
  }

  await prisma.budgetLine.deleteMany({ where: { id, organizationId: orgId } })

  if (lineToDelete) {
    logBudgetChange({ orgId, planId: lineToDelete.planId, entityType: "line", entityId: id, action: "delete", oldValue: lineToDelete })
  }

  return NextResponse.json({ success: true, data: null })
}
