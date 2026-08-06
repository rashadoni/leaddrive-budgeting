import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { parseAssumptionInput, referencedCompanyIds } from "@/lib/budgeting/assumption-input"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  // Both tiers are returned for the whole plan, deliberately — the client
  // resolves precedence via `resolveAssumption` and needs to SEE the plan-level
  // default a company override is shadowing in order to show it as layered
  // rather than as the only value. Filtering server-side by companyId would
  // hide exactly that.
  const assumptions = await withOrgScope(orgId, (tx) =>
    tx.budgetAssumption.findMany({
      where: { organizationId: orgId, planId },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      include: { company: { select: { id: true, name: true, code: true } } },
    }),
  )
  return NextResponse.json(assumptions)
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  // Phase L8 — period-lock gate. Body may be a single object or an
  // array (bulk createMany). Both reference one planId — assert it's
  // consistent in the array case, then derive the period and check
  // the org's lockedPeriods. If the period is locked, reject with 423.
  const planId = Array.isArray(body) ? body[0]?.planId : body?.planId
  if (!planId || typeof planId !== "string") {
    return NextResponse.json({ error: "planId required in body" }, { status: 400 })
  }
  if (Array.isArray(body) && body.some((it: { planId?: unknown }) => it.planId !== planId)) {
    return NextResponse.json(
      { error: "All items in array must share the same planId" },
      { status: 400 },
    )
  }
  // Stage 3 RLS — plan check, lock check and write in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    const plan = await tx.budgetPlan.findFirst({
      where: { id: planId, organizationId: orgId },
      select: { id: true, periodType: true, year: true, month: true, quarter: true },
    })
    if (!plan) {
      return NextResponse.json({ error: "Plan not found in this organization" }, { status: 404 })
    }
    const lock = await getActivePeriodLock(tx, orgId, derivePeriodKey(plan))
    if (lock)
      return lockedResponse(lock, {
        prisma,
        orgId,
        userId: null, // route uses getOrgId-only auth; userId not extracted
        route: "POST /api/budgeting/assumptions",
      })

    // Phase 7.Q — parse through an explicit allow-list instead of spreading the
    // body. The spread let a caller set `organizationId` / `id` / `createdAt`,
    // and once `companyId` exists it would also let them attach a row to
    // another tenant's company. See `assumption-input.ts` for the full note.
    const items: unknown[] = Array.isArray(body) ? body : [body]
    const parsed = []
    for (let i = 0; i < items.length; i++) {
      const result = parseAssumptionInput(items[i])
      if (!result.ok) {
        return NextResponse.json(
          {
            error: Array.isArray(body) ? `Item ${i}: ${result.error}` : result.error,
          },
          { status: 400 },
        )
      }
      parsed.push(result.value)
    }

    // Cross-tenant company guard. `withOrgScope` sets the RLS GUC, so this
    // findMany cannot see another org's companies — an id from a foreign tenant
    // simply fails to come back and is reported as unknown. One query for the
    // whole batch, not one per row.
    const companyIds = referencedCompanyIds(parsed)
    if (companyIds.length > 0) {
      const found = await tx.company.findMany({
        where: { id: { in: companyIds }, organizationId: orgId },
        select: { id: true },
      })
      const known = new Set(found.map((c) => c.id))
      const unknown = companyIds.filter((id) => !known.has(id))
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: `Company not found in this organization: ${unknown.join(", ")}` },
          { status: 404 },
        )
      }
    }

    if (Array.isArray(body)) {
      const results = await tx.budgetAssumption.createMany({
        data: parsed.map((item) => ({ ...item, planId, organizationId: orgId })),
        skipDuplicates: true,
      })
      return NextResponse.json(results, { status: 201 })
    }

    const assumption = await tx.budgetAssumption.create({
      data: { ...parsed[0], planId, organizationId: orgId },
    })
    return NextResponse.json(assumption, { status: 201 })
  })
}
