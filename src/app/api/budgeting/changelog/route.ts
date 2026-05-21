/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
// Phase 5.2 Stage 2 Tier 2 (2026-05-21) — RLS wrap for budget_change_logs reads + mutations.
import { withOrgScope } from "@/lib/db/with-org-scope"

const undoChangeSchema = z.object({
  changeId: z.string().min(1).max(100),
}).strict()

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const { items } = await withOrgScope(orgId, async (tx) => {
    const changes = await tx.budgetChangeLog.findMany({
      where: { planId, organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    // Resolve user names — user table is Tier 4 (not yet RLS-protected);
    // queried via tx so it shares the same SET LOCAL transaction context.
    const userIds = [...new Set(changes.map((c: any) => c.userId).filter(Boolean))] as string[]
    const users = userIds.length > 0
      ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : []
    const userMap = new Map(users.map((u: { id: string; name: string | null }) => [u.id, u.name || "Unknown"]))

    const items = changes.map((c: any) => ({
      id: c.id,
      action: c.action,
      entityType: c.entityType,
      entityId: c.entityId,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      category: (c.snapshot as any)?.category || null,
      userName: c.userId ? (userMap.get(c.userId) || "Unknown") : "System",
      createdAt: c.createdAt.toISOString(),
    }))

    return { items }
  })

  return NextResponse.json({ success: true, data: { items, total: items.length } })
}

/**
 * POST /api/budgeting/changelog — Undo a specific change
 * Body: { changeId: string }
 */
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
    data = undoChangeSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { changeId } = data

  // Phase 5.2 Stage 2 Tier 2 — wrap all mutations in withOrgScope so
  // the RLS session variable is set when budget_change_logs policies land.
  const result = await withOrgScope(orgId, async (tx) => {
    const change = await tx.budgetChangeLog.findFirst({
      where: { id: changeId, organizationId: orgId },
    })
    if (!change) return { notFound: true } as const

    // Only support undo for field updates on lines
    if (change.action !== "update" || change.entityType !== "line" || !change.field || change.oldValue == null) {
      return { notUndoable: true } as const
    }

    // Revert the field to oldValue — scope update to caller's org (defense-in-depth)
    const oldVal = change.oldValue as any
    const updated = await tx.budgetLine.updateMany({
      where: { id: change.entityId, organizationId: orgId },
      data: { [change.field]: typeof oldVal === "object" ? oldVal : Number(oldVal) },
    })
    if (updated.count === 0) return { lineNotFound: true } as const

    // Delete the changelog entry (scoped by org)
    await tx.budgetChangeLog.deleteMany({ where: { id: changeId, organizationId: orgId } })

    return { reverted: change.field, to: oldVal }
  })

  if ("notFound" in result) return NextResponse.json({ error: "Change not found" }, { status: 404 })
  if ("notUndoable" in result) return NextResponse.json({ error: "Only field updates can be undone" }, { status: 400 })
  if ("lineNotFound" in result) return NextResponse.json({ error: "Target line not found in this organization" }, { status: 404 })

  return NextResponse.json({ success: true, data: result })
}
