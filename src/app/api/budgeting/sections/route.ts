import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, requireRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"

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
  // Phase 7.G Turn LXII (audit M2 closure) — manager+ required.
  const auth = await requireRole(req, "manager")
  if (auth instanceof NextResponse) return auth
  const { orgId } = auth

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

  // Phase 7.G Turn LXVIII (Phase 4.2 fan-out). Verify plan belongs to caller's
  // org (cross-tenant guard) and check period-lock. Org-membership check is
  // load-bearing here — without it a viewer-promoted-to-manager could touch
  // other orgs' sections via guessable planId.
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    select: { id: true, periodType: true, year: true, month: true, quarter: true },
  })
  if (!plan) {
    return NextResponse.json({ error: "Plan not found in this organization" }, { status: 404 })
  }
  const periodKey = derivePeriodKey(plan)
  const lock = await getActivePeriodLock(prisma, orgId, periodKey)
  if (lock) return lockedResponse(lock)

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
