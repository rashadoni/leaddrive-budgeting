import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const createTemplateSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(2000).optional().nullable(),
  lineType: z.string().max(50).optional(),
  lineSubtype: z.string().max(50).optional().nullable(),
  defaultAmount: z.number().min(0).max(999999999).optional(),
  unitPrice: z.number().min(0).max(999999999).optional().nullable(),
  unitCost: z.number().min(0).max(999999999).optional().nullable(),
  quantity: z.number().min(0).max(999999999).optional().nullable(),
  costModelKey: z.string().max(200).optional().nullable(),
  department: z.string().max(200).optional().nullable(),
}).strict()

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const templates = await prisma.budgetDirectionTemplate.findMany({
    where: { organizationId: orgId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })

  return NextResponse.json({ data: templates })
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
    data = createTemplateSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, description, lineType, lineSubtype, defaultAmount, unitPrice, unitCost, quantity, costModelKey, department } = data

  const template = await prisma.budgetDirectionTemplate.create({
    data: {
      organizationId: orgId,
      name: name.trim(),
      description: description || null,
      lineType: lineType || "revenue",
      lineSubtype: lineSubtype || null,
      defaultAmount: Number(defaultAmount) || 0,
      unitPrice: unitPrice != null ? Number(unitPrice) : null,
      unitCost: unitCost != null ? Number(unitCost) : null,
      quantity: quantity != null ? Number(quantity) : null,
      costModelKey: costModelKey || null,
      department: department || null,
    },
  })

  return NextResponse.json({ data: template })
}
