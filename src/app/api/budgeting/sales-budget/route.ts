import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const lines = await prisma.salesBudgetLine.findMany({
    where: { organizationId: orgId, planId },
    include: { productLine: true },
    orderBy: [{ productLine: { sortOrder: "asc" } }, { month: "asc" }],
  })
  return NextResponse.json(lines)
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  // Support bulk upsert
  if (Array.isArray(body)) {
    const results = await Promise.all(
      body.map((item: any) =>
        prisma.salesBudgetLine.upsert({
          where: {
            planId_productLineId_year_month: {
              planId: item.planId,
              productLineId: item.productLineId,
              year: item.year,
              month: item.month,
            },
          },
          update: { quantity: item.quantity, unitPrice: item.unitPrice, amount: item.amount, notes: item.notes },
          create: { ...item, organizationId: orgId },
        })
      )
    )
    return NextResponse.json(results, { status: 201 })
  }

  const line = await prisma.salesBudgetLine.create({
    data: { ...body, organizationId: orgId },
  })
  return NextResponse.json(line, { status: 201 })
}
