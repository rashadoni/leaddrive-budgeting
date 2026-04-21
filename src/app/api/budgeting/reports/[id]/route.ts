import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const updateReportSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional().nullable(),
  entityType: z.string().min(1).optional(),
  planId: z.string().optional().nullable(),
  columns: z.array(z.object({
    field: z.string(),
    label: z.string().optional(),
    aggregate: z.enum(["count", "sum", "avg", "min", "max"]).optional(),
  })).optional(),
  filters: z.array(z.object({
    field: z.string(),
    op: z.string(),
    value: z.any(),
  })).optional(),
  groupBy: z.string().optional().nullable(),
  periodGroupBy: z.enum(["month", "quarter", "year"]).optional().nullable(),
  sortBy: z.string().optional().nullable(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  chartType: z.string().optional(),
  chartConfig: z.any().optional().nullable(),
  computedFields: z.array(z.string()).optional().nullable(),
  isShared: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteParams) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const report = await prisma.savedBudgetReport.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 })

  return NextResponse.json({ success: true, data: report })
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  let body
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try { data = updateReportSchema.parse(body) } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const existing = await prisma.savedBudgetReport.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!existing) return NextResponse.json({ error: "Report not found" }, { status: 404 })

  const report = await prisma.savedBudgetReport.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.entityType !== undefined ? { entityType: data.entityType } : {}),
      ...(data.planId !== undefined ? { planId: data.planId } : {}),
      ...(data.columns !== undefined ? { columns: data.columns as any } : {}),
      ...(data.filters !== undefined ? { filters: data.filters as any } : {}),
      ...(data.groupBy !== undefined ? { groupBy: data.groupBy } : {}),
      ...(data.periodGroupBy !== undefined ? { periodGroupBy: data.periodGroupBy } : {}),
      ...(data.sortBy !== undefined ? { sortBy: data.sortBy } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      ...(data.chartType !== undefined ? { chartType: data.chartType } : {}),
      ...(data.chartConfig !== undefined ? { chartConfig: data.chartConfig } : {}),
      ...(data.computedFields !== undefined ? { computedFields: data.computedFields } : {}),
      ...(data.isShared !== undefined ? { isShared: data.isShared } : {}),
    },
  })

  return NextResponse.json({ success: true, data: report })
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.savedBudgetReport.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!existing) return NextResponse.json({ error: "Report not found" }, { status: 404 })

  await prisma.savedBudgetReport.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
