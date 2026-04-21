/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const undoChangeSchema = z.object({
  changeId: z.string().min(1).max(100),
}).strict()

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const changes = await prisma.budgetChangeLog.findMany({
    where: { planId, organizationId: orgId },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  // Resolve user names
  const userIds = [...new Set(changes.map((c: any) => c.userId).filter(Boolean))] as string[]
  const users = userIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
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

  const change = await prisma.budgetChangeLog.findFirst({
    where: { id: changeId, organizationId: orgId },
  })
  if (!change) return NextResponse.json({ error: "Change not found" }, { status: 404 })

  // Only support undo for field updates on lines
  if (change.action !== "update" || change.entityType !== "line" || !change.field || change.oldValue == null) {
    return NextResponse.json({ error: "Only field updates can be undone" }, { status: 400 })
  }

  // Revert the field to oldValue — scope update to caller's org (defense-in-depth)
  const oldVal = change.oldValue as any
  const result = await prisma.budgetLine.updateMany({
    where: { id: change.entityId, organizationId: orgId },
    data: { [change.field]: typeof oldVal === "object" ? oldVal : Number(oldVal) },
  })
  if (result.count === 0) {
    return NextResponse.json({ error: "Target line not found in this organization" }, { status: 404 })
  }

  // Delete the changelog entry (scoped by org)
  await prisma.budgetChangeLog.deleteMany({ where: { id: changeId, organizationId: orgId } })

  return NextResponse.json({ success: true, data: { reverted: change.field, to: oldVal } })
}
