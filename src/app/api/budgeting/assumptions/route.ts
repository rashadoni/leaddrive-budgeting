import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const assumptions = await prisma.budgetAssumption.findMany({
    where: { organizationId: orgId, planId },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  })
  return NextResponse.json(assumptions)
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  if (Array.isArray(body)) {
    const results = await prisma.budgetAssumption.createMany({
      data: body.map((item: any) => ({ ...item, organizationId: orgId })),
      skipDuplicates: true,
    })
    return NextResponse.json(results, { status: 201 })
  }

  const assumption = await prisma.budgetAssumption.create({
    data: { ...body, organizationId: orgId },
  })
  return NextResponse.json(assumption, { status: 201 })
}
