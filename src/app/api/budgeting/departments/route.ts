import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const createDeptSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  serviceKey: z.string().max(100).optional().nullable(),
  hasRevenue: z.boolean().optional(),
  color: z.string().max(20).optional().nullable(),
  sortOrder: z.number().int().min(0).max(999).optional(),
}).strict()

const updateDeptSchema = z.object({
  id: z.string().min(1).max(100),
  key: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(200).optional(),
  serviceKey: z.string().max(100).optional().nullable(),
  hasRevenue: z.boolean().optional(),
  color: z.string().max(20).optional().nullable(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "true"

  const departments = await prisma.budgetDepartment.findMany({
    where: { organizationId: orgId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { sortOrder: "asc" },
  })

  return NextResponse.json({ success: true, data: departments })
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

  let data
  try {
    data = createDeptSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { key, label, serviceKey, hasRevenue, color, sortOrder } = data

  const existing = await prisma.budgetDepartment.findUnique({
    where: { organizationId_key: { organizationId: orgId, key } },
  })
  if (existing) {
    return NextResponse.json({ error: `Department with key "${key}" already exists` }, { status: 409 })
  }

  const department = await prisma.budgetDepartment.create({
    data: {
      organizationId: orgId,
      key,
      label,
      serviceKey: serviceKey || null,
      hasRevenue: hasRevenue ?? true,
      color: color || null,
      sortOrder: sortOrder ?? 0,
    },
  })

  return NextResponse.json({ success: true, data: department }, { status: 201 })
}

export async function PUT(req: NextRequest) {
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
    data = updateDeptSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { id, ...updates } = data

  const department = await prisma.budgetDepartment.update({
    where: { id, organizationId: orgId },
    data: updates,
  })

  return NextResponse.json({ success: true, data: department })
}

export async function DELETE(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  // Soft-delete: deactivate instead of removing (preserves FK references)
  const department = await prisma.budgetDepartment.update({
    where: { id, organizationId: orgId },
    data: { isActive: false },
  })

  return NextResponse.json({ success: true, data: department })
}
