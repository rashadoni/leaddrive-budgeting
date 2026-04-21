import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const salesForecastSchema = z.object({
  year: z.number().int().min(2020).max(2050),
  entries: z.array(z.object({
    departmentId: z.string().min(1).max(100),
    month: z.number().int().min(1).max(12),
    amount: z.number().min(0).max(999999999),
    notes: z.string().max(500).optional(),
  })).min(1).max(5000),
}).strict()

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const year = Number(req.nextUrl.searchParams.get("year") || new Date().getFullYear())
  if (isNaN(year) || year < 2020 || year > 2050) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 })
  }

  const entries = await prisma.salesForecast.findMany({
    where: { organizationId: orgId, year },
    include: { budgetDept: { select: { id: true, key: true, label: true } } },
    orderBy: [{ budgetDept: { sortOrder: "asc" } }, { month: "asc" }],
  })

  return NextResponse.json({ success: true, data: entries })
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
    data = salesForecastSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { year, entries } = data

  const results = await prisma.$transaction(
    entries
      .filter((e) => e.departmentId && e.month >= 1 && e.month <= 12)
      .map((e) =>
        prisma.salesForecast.upsert({
          where: {
            organizationId_departmentId_year_month: {
              organizationId: orgId,
              departmentId: e.departmentId,
              year,
              month: e.month,
            },
          },
          update: { amount: Number(e.amount) || 0, notes: e.notes || null },
          create: {
            organizationId: orgId,
            departmentId: e.departmentId,
            year,
            month: e.month,
            amount: Number(e.amount) || 0,
            notes: e.notes || null,
          },
        })
      )
  )

  return NextResponse.json({ success: true, count: results.length }, { status: 201 })
}
