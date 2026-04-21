import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const accounts = await prisma.chartOfAccount.findMany({
    where: { organizationId: orgId },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  })
  return NextResponse.json(accounts)
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const account = await prisma.chartOfAccount.create({
    data: { ...body, organizationId: orgId },
  })
  return NextResponse.json(account, { status: 201 })
}
