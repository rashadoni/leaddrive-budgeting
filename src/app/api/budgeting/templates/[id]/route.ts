import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional().nullable(),
  lineType: z.string().max(50).optional(),
  lineSubtype: z.string().max(50).optional().nullable(),
  defaultAmount: z.number().min(0).max(999999999).optional(),
  unitPrice: z.number().min(0).max(999999999).optional().nullable(),
  unitCost: z.number().min(0).max(999999999).optional().nullable(),
  quantity: z.number().min(0).max(999999999).optional().nullable(),
  costModelKey: z.string().max(200).optional().nullable(),
  department: z.string().max(200).optional().nullable(),
  isActive: z.boolean().optional(),
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
    data = updateTemplateSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, description, lineType, lineSubtype, defaultAmount, unitPrice, unitCost, quantity, costModelKey, department, isActive } = data

  const template = await prisma.budgetDirectionTemplate.update({
    where: { id, organizationId: orgId },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description || null }),
      ...(lineType !== undefined && { lineType }),
      ...(lineSubtype !== undefined && { lineSubtype: lineSubtype || null }),
      ...(defaultAmount !== undefined && { defaultAmount: Number(defaultAmount) }),
      ...(unitPrice !== undefined && { unitPrice: unitPrice != null ? Number(unitPrice) : null }),
      ...(unitCost !== undefined && { unitCost: unitCost != null ? Number(unitCost) : null }),
      ...(quantity !== undefined && { quantity: quantity != null ? Number(quantity) : null }),
      ...(costModelKey !== undefined && { costModelKey: costModelKey || null }),
      ...(department !== undefined && { department: department || null }),
      ...(isActive !== undefined && { isActive }),
    },
  })

  return NextResponse.json({ data: template })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  await prisma.budgetDirectionTemplate.delete({
    where: { id, organizationId: orgId },
  })

  return NextResponse.json({ data: null })
}
