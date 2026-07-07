import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { resolveAccountId } from "@/lib/budgeting/chart-of-accounts"

const applyTemplatesSchema = z.object({
  templateIds: z.array(z.string().min(1).max(100)).min(1).max(100),
}).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(req, "manager")
  if (session instanceof NextResponse) return session
  const { orgId, userId } = session
  const { id: planId } = await params

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = applyTemplatesSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { templateIds } = data

  // Stage 3 RLS — plan check, lock, template reads + line-create loop in
  // one org-scoped tx (30s: bounded by templateIds, max 100).
  return withOrgScope(
    orgId,
    async (tx) => {
      // Verify plan exists
      const plan = await tx.budgetPlan.findFirst({ where: { id: planId, organizationId: orgId } })
      if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

      // Phase 7.G Turn LXIX architect Round-1 ⚠️ closure — period-lock guard
      // (apply-templates creates new budgetLine rows in the plan's period).
      const lock = await getActivePeriodLock(tx, orgId, derivePeriodKey(plan))
      if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "POST /api/budgeting/plans/[id]/apply-templates" })

      // Get templates
      const templates = await tx.budgetDirectionTemplate.findMany({
        where: { id: { in: templateIds }, organizationId: orgId, isActive: true },
      })

      // Get existing lines in this plan to skip duplicates (keyed by account.code)
      const existingLines = await tx.budgetLine.findMany({
        // deletedAt:null (2026-05-31): only LIVE lines count as "already present".
        where: { planId, organizationId: orgId, deletedAt: null },
        select: { accountId: true, lineType: true, account: { select: { code: true } } },
      })
      const existingKeys = new Set(existingLines.map((l: { accountId: string; lineType: string; account: { code: string } }) => `${l.account?.code ?? l.accountId}||${l.lineType}`))

      let created = 0
      let skipped = 0
      let skippedNoAccount = 0

      for (const t of templates) {
        const key = `${t.name}||${t.lineType}`
        if (existingKeys.has(key)) {
          skipped++
          continue
        }

        // BudgetLine.accountId is a REQUIRED ChartOfAccount FK since Phase 2.1.
        // A template whose name is not a resolvable code can't produce a line.
        const accountId = await resolveAccountId(tx, orgId, t.name)
        if (!accountId) {
          skippedNoAccount++
          continue
        }

        await tx.budgetLine.create({
          data: {
            organizationId: orgId,
            planId,
            department: t.department,
            lineType: t.lineType,
            lineSubtype: t.lineSubtype,
            plannedAmount: t.defaultAmount,
            unitPrice: t.unitPrice,
            unitCost: t.unitCost,
            quantity: t.quantity,
            costModelKey: t.costModelKey,
            notes: `template:${t.id}`,
            accountId,
          },
        })
        created++
      }

      return NextResponse.json({ data: { created, skipped, skippedNoAccount } })
    },
    { timeoutMs: 30_000 },
  )
}
