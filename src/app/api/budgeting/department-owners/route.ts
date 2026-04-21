import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { prisma } from "@/lib/prisma"
import { getSession, isAuthError } from "@/lib/api-auth"

const assignOwnerSchema = z.object({
  departmentId: z.string().min(1).max(100),
  userId: z.string().min(1).max(100),
  canEdit: z.boolean().optional(),
  canApprove: z.boolean().optional(),
}).strict()

// GET — list department owners for the org
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { orgId } = session

  const owners = await prisma.budgetDepartmentOwner.findMany({
    where: { organizationId: orgId },
    include: {
      budgetDept: { select: { id: true, key: true, label: true } },
      user: { select: { id: true, name: true, email: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(owners)
}

// POST — assign a user as department owner
export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Only admin can manage department owners
  if (session.role !== "admin" && session.role !== "manager") {
    return NextResponse.json({ error: "Only admin/manager can manage department owners" }, { status: 403 })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = assignOwnerSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { departmentId, userId, canEdit, canApprove } = data

  const owner = await prisma.budgetDepartmentOwner.upsert({
    where: {
      organizationId_departmentId_userId: {
        organizationId: session.orgId,
        departmentId,
        userId,
      },
    },
    update: {
      canEdit: canEdit ?? true,
      canApprove: canApprove ?? false,
    },
    create: {
      organizationId: session.orgId,
      departmentId,
      userId,
      canEdit: canEdit ?? true,
      canApprove: canApprove ?? false,
    },
    include: {
      budgetDept: { select: { id: true, key: true, label: true } },
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  })

  return NextResponse.json(owner, { status: 201 })
}

// DELETE — remove department owner assignment
export async function DELETE(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (session.role !== "admin" && session.role !== "manager") {
    return NextResponse.json({ error: "Only admin/manager can manage department owners" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }

  await prisma.budgetDepartmentOwner.deleteMany({
    where: { id, organizationId: session.orgId },
  })

  return NextResponse.json({ success: true })
}
