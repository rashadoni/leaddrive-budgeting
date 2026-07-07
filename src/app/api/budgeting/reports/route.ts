import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { getOrgId } from "@/lib/api-auth";
import { withOrgScope } from "@/lib/db/with-org-scope";

const createReportSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(2000).optional().nullable(),
  entityType: z.string().min(1),
  planId: z.string().optional().nullable(),
  columns: z.array(
    z.object({
      field: z.string(),
      label: z.string().optional(),
      aggregate: z.enum(["count", "sum", "avg", "min", "max"]).optional(),
    }),
  ),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: z.string(),
        value: z.any(),
      }),
    )
    .optional()
    .default([]),
  groupBy: z.string().optional().nullable(),
  periodGroupBy: z.enum(["month", "quarter", "year"]).optional().nullable(),
  sortBy: z.string().optional().nullable(),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  chartType: z.string().optional().default("table"),
  chartConfig: z.any().optional().nullable(),
  computedFields: z.array(z.string()).optional().nullable(),
  isShared: z.boolean().optional().default(false),
});

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req);
  if (!orgId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);

  const { reports, total } = await withOrgScope(orgId, async (tx) => {
    const reports = await tx.savedBudgetReport.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const total = await tx.savedBudgetReport.count({
      where: { organizationId: orgId },
    });
    return { reports, total };
  });

  return NextResponse.json({
    success: true,
    data: reports,
    total,
    page,
    limit,
  });
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req);
  if (!orgId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let data;
  try {
    data = createReportSchema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const report = await withOrgScope(orgId, (tx) =>
    tx.savedBudgetReport.create({
      data: {
        organizationId: orgId,
        name: data.name,
        description: data.description ?? null,
        entityType: data.entityType,
        planId: data.planId ?? null,
        columns: data.columns as any,
        filters: data.filters as any,
        groupBy: data.groupBy ?? null,
        periodGroupBy: data.periodGroupBy ?? null,
        sortBy: data.sortBy ?? null,
        sortOrder: data.sortOrder,
        chartType: data.chartType,
        chartConfig: data.chartConfig ?? null,
        computedFields: data.computedFields ?? Prisma.JsonNull,
        isShared: data.isShared,
      },
    }),
  );

  return NextResponse.json({ success: true, data: report }, { status: 201 });
}
