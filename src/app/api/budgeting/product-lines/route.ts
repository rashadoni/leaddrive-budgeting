import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const lines = await prisma.productLine.findMany({
    where: { organizationId: orgId },
    include: { salesBudgetLines: true, costComponents: true },
    orderBy: { sortOrder: "asc" },
  })
  return NextResponse.json(lines)
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const line = await prisma.productLine.create({
    data: { ...body, organizationId: orgId },
  })
  return NextResponse.json(line, { status: 201 })
}
