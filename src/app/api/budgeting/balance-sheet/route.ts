import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const lines = await prisma.balanceSheetLine.findMany({
    where: { organizationId: orgId, planId },
    orderBy: [{ lineType: "asc" }, { accountCode: "asc" }, { month: "asc" }],
  })

  // Group by lineType
  type BSRow = (typeof lines)[number]
  const assets = lines.filter((l: BSRow) => l.lineType === "asset")
  const liabilities = lines.filter((l: BSRow) => l.lineType === "liability")
  const equity = lines.filter((l: BSRow) => l.lineType === "equity")

  return NextResponse.json({ assets, liabilities, equity, all: lines })
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  if (Array.isArray(body)) {
    const results = await prisma.balanceSheetLine.createMany({
      data: body.map((item: any) => ({ ...item, organizationId: orgId })),
      skipDuplicates: true,
    })
    return NextResponse.json(results, { status: 201 })
  }

  const line = await prisma.balanceSheetLine.create({
    data: { ...body, organizationId: orgId },
  })
  return NextResponse.json(line, { status: 201 })
}
