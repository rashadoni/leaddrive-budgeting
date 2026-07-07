import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { currentBakuYearNumber } from "@/lib/risk/periods"
import { getActivePeriodLock } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"

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

  const year = Number(req.nextUrl.searchParams.get("year") || currentBakuYearNumber())
  if (isNaN(year) || year < 2020 || year > 2050) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 })
  }

  const entries = await withOrgScope(orgId, (tx) =>
    tx.salesForecast.findMany({
      where: { organizationId: orgId, year },
      include: { budgetDept: { select: { id: true, key: true, label: true } } },
      orderBy: [{ budgetDept: { sortOrder: "asc" } }, { month: "asc" }],
    }),
  )

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

  // Stage 3 RLS — lock check + upsert batch in one org-scoped tx (the
  // former $transaction([array]) becomes a sequential loop inside it).
  // 60s timeout covers realistic payloads; the zod 5000 cap is theoretical.
  return withOrgScope(
    orgId,
    async (tx) => {
      // Phase L8 — period-lock gate (year-scoped forecast).
      const lock = await getActivePeriodLock(tx, orgId, String(year))
      if (lock)
        return lockedResponse(lock, {
          prisma,
          orgId,
          userId: null,
          route: "POST /api/budgeting/sales-forecast",
        })

      const valid = entries.filter((e) => e.departmentId && e.month >= 1 && e.month <= 12)
      let count = 0
      for (const e of valid) {
        await tx.salesForecast.upsert({
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
        count++
      }

      return NextResponse.json({ success: true, count }, { status: 201 })
    },
    { timeoutMs: 60_000 },
  )
}
