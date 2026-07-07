import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import type { Prisma } from "@prisma/client"

type Db = Prisma.TransactionClient

/**
 * Phase 7.G Turn LXVIII follow-up — period-lock check helper.
 * Resolves section → plan → periodKey → lock check. Returns the lock
 * record (or null). The section load is also load-bearing as the
 * cross-tenant guard: a section not in the caller's org returns null
 * (treated as "not locked" — but the subsequent updateMany/deleteMany
 * will also miss because of organizationId in WHERE).
 *
 * Phase 7.G Turn LXIX cleanup: `lockedResponse` migrated to shared
 * `period-lock-http.ts` module.
 */
async function findActiveLockForSection(tx: Db, orgId: string, sectionId: string) {
  const section = await tx.budgetSection.findFirst({
    where: { id: sectionId, organizationId: orgId },
    select: { planId: true },
  })
  if (!section) return null
  const plan = await tx.budgetPlan.findFirst({
    where: { id: section.planId, organizationId: orgId },
    select: { periodType: true, year: true, month: true, quarter: true },
  })
  if (!plan) return null
  const periodKey = derivePeriodKey(plan)
  return getActivePeriodLock(tx, orgId, periodKey)
}

const updateSectionSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  sectionType: z.string().max(50).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Phase 7.G Turn LXII (audit M2 closure) — manager+ required.
  const auth = await requireRole(req, "manager")
  if (auth instanceof NextResponse) return auth
  const { orgId, userId } = auth

  const { id } = await params

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = updateSectionSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, sectionType, sortOrder } = data

  // Stage 3 RLS — lock check + write in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    // Phase 7.G Turn LXVIII follow-up — period-lock guard.
    const lock = await findActiveLockForSection(tx, orgId, id)
    if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "PUT|DELETE /api/budgeting/sections/[id]" })

    const result = await tx.budgetSection.updateMany({
      where: { id, organizationId: orgId },
      data: {
        ...(name !== undefined && { name }),
        ...(sectionType !== undefined && { sectionType }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    })

    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const updated = await tx.budgetSection.findFirst({ where: { id, organizationId: orgId } })
    return NextResponse.json({ success: true, data: updated })
  })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Phase 7.G Turn LXII (audit M2 closure) — manager+ required.
  const auth = await requireRole(req, "manager")
  if (auth instanceof NextResponse) return auth
  const { orgId, userId } = auth

  const { id } = await params

  // Stage 3 RLS — lock check + delete in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    // Phase 7.G Turn LXVIII follow-up — period-lock guard.
    const lock = await findActiveLockForSection(tx, orgId, id)
    if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "PUT|DELETE /api/budgeting/sections/[id]" })

    await tx.budgetSection.deleteMany({ where: { id, organizationId: orgId } })
    return NextResponse.json({ success: true, data: null })
  })
}
