import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, requireRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"
import { resolveCostModelKey } from "@/lib/budgeting/cost-model-map"
import { currentBakuYearMonth } from "@/lib/risk/periods"
import { findFirstActiveLockInPeriods, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeys } from "@/lib/budgeting/period-lock-http"

const syncActualsSchema = z.object({
  planId: z.string().min(1).max(100),
}).strict()

// SECURITY (Phase A leftover, Turn 25 cont'd Day 1): tightened from
// `getOrgId` (any authenticated user) to `requireRole("editor")`.
// POST writes external actuals into the org's plan — viewers should
// not be able to mutate financial data, even read-only roles
// shouldn't trigger writes accidentally.
export async function POST(req: NextRequest) {
  const session = await requireRole(req, "editor")
  if (isAuthError(session)) return session
  const { orgId, userId } = session

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = syncActualsSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { planId } = data

  const [plan, lines] = await Promise.all([
    prisma.budgetPlan.findFirst({ where: { id: planId, organizationId: orgId } }),
    prisma.budgetLine.findMany({ where: { planId, organizationId: orgId, isAutoActual: true }, include: { account: { select: { code: true, name: true } } } }),
  ])

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  if (lines.length === 0) {
    return NextResponse.json({ success: true, data: { synced: 0 } })
  }

  const costModel = await loadAndCompute(orgId).catch(() => null)
  if (!costModel) {
    return NextResponse.json({ error: "Cost model unavailable" }, { status: 503 })
  }

  const { year, month } = currentBakuYearMonth()
  const currentDate = `${year}-${String(month).padStart(2, "0")}-01`

  // Phase 7.G Turn LXIX (Phase 4.2 bulk-mutation gate). sync-actuals
  // writes/updates actuals at the CURRENT month. Lock check covers
  // both the plan's period (annual/quarterly/monthly) AND the current
  // month's containing periods (year/quarter/month). Any matched lock
  // rejects — we never want auto-sync to bleed into a closed period.
  const periodsToCheck = Array.from(
    new Set([derivePeriodKey(plan), ...containingPeriodKeys(year, month)]),
  )
  const syncLock = await findFirstActiveLockInPeriods(prisma, orgId, periodsToCheck)
  if (syncLock) return lockedResponse(syncLock, { prisma, orgId, userId, route: "POST /api/budgeting/sync-actuals" })

  let synced = 0

  for (const line of lines) {
    if (!line.costModelKey) continue
    const amount = resolveCostModelKey(costModel, line.costModelKey)
    if (amount <= 0) continue

    // Upsert: find existing actual for this account.code+month or create new
    const lineAccountCode = (line as any).account?.code ?? ""
    const existing = await prisma.budgetActual.findFirst({
      where: {
        planId,
        organizationId: orgId,
        category: lineAccountCode,
        description: { startsWith: "auto-sync:" },
      },
    })

    // Phase 3.1 v1.2 — stamp monthIndex (0-indexed) so VarianceTab
    // sparkline can attribute the actual to its month. `month` is
    // 1-indexed from `currentBakuYearMonth()`, hence -1.
    const monthIndex = month - 1
    if (existing) {
      await prisma.budgetActual.update({
        where: { id: existing.id },
        data: { actualAmount: amount, expenseDate: currentDate, monthIndex },
      })
    } else {
      await prisma.budgetActual.create({
        data: {
          organizationId: orgId,
          planId,
          category: lineAccountCode,
          department: line.department,
          lineType: line.lineType,
          actualAmount: amount,
          expenseDate: currentDate,
          monthIndex,
          description: `auto-sync: ${line.costModelKey}`,
        },
      })
    }
    synced++
  }

  return NextResponse.json({ success: true, data: { synced } })
}
