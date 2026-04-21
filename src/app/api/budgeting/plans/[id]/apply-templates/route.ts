import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const applyTemplatesSchema = z.object({
  templateIds: z.array(z.string().min(1).max(100)).min(1).max(100),
}).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(req, "manager")
  if (session instanceof NextResponse) return session
  const { orgId } = session
  const { id: planId } = await params

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = applyTemplatesSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { templateIds } = data

  // Verify plan exists
  const plan = await prisma.budgetPlan.findFirst({ where: { id: planId, organizationId: orgId } })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  // Get templates
  const templates = await prisma.budgetDirectionTemplate.findMany({
    where: { id: { in: templateIds }, organizationId: orgId, isActive: true },
  })

  // Get existing line categories in this plan to skip duplicates
  const existingLines = await prisma.budgetLine.findMany({
    where: { planId, organizationId: orgId },
    select: { category: true, lineType: true },
  })
  const existingKeys = new Set(existingLines.map((l: { category: string; lineType: string }) => `${l.category}||${l.lineType}`))

  let created = 0
  let skipped = 0

  for (const t of templates) {
    const key = `${t.name}||${t.lineType}`
    if (existingKeys.has(key)) {
      skipped++
      continue
    }

    await prisma.budgetLine.create({
      data: {
        organizationId: orgId,
        planId,
        category: t.name,
        department: t.department,
        lineType: t.lineType,
        lineSubtype: t.lineSubtype,
        plannedAmount: t.defaultAmount,
        unitPrice: t.unitPrice,
        unitCost: t.unitCost,
        quantity: t.quantity,
        costModelKey: t.costModelKey,
        notes: `template:${t.id}`,
      },
    })
    created++
  }

  return NextResponse.json({ data: { created, skipped } })
}
