import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const createSectionSchema = z.object({
  planId: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  sectionType: z.string().max(50).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
}).strict()

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const sections = await prisma.budgetSection.findMany({
    where: { planId, organizationId: orgId },
    orderBy: { sortOrder: "asc" },
  })

  return NextResponse.json({ success: true, data: sections })
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
    data = createSectionSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { planId, name, sectionType, sortOrder } = data

  const section = await prisma.budgetSection.create({
    data: {
      organizationId: orgId,
      planId,
      name,
      sectionType: sectionType || "expense",
      sortOrder: sortOrder ?? 0,
    },
  })

  return NextResponse.json({ success: true, data: section }, { status: 201 })
}
