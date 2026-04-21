import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const updateSectionSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  sectionType: z.string().max(50).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
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
    data = updateSectionSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, sectionType, sortOrder } = data

  const result = await prisma.budgetSection.updateMany({
    where: { id, organizationId: orgId },
    data: {
      ...(name !== undefined && { name }),
      ...(sectionType !== undefined && { sectionType }),
      ...(sortOrder !== undefined && { sortOrder }),
    },
  })

  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.budgetSection.findFirst({ where: { id, organizationId: orgId } })
  return NextResponse.json({ success: true, data: updated })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  await prisma.budgetSection.deleteMany({ where: { id, organizationId: orgId } })
  return NextResponse.json({ success: true, data: null })
}
