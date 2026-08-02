/**
 * Phase 13.6 (2026-08-02) — write a manual correction.
 *
 * `POST` adds an adjustment ROW. It never edits an imported one: the imported
 * rows are what the workbook said, and that is what makes re-import safe, the
 * cross-foot meaningful, and the question "did we read it wrong, or was it
 * wrong?" answerable at all. See `manual-correction.ts` for the full argument.
 *
 * `GET` returns this org's corrections, review-flagged first — the queue a
 * person works through after an import has rewritten cells they had corrected.
 */
import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { logAuditEvent } from "@/lib/audit/log"
import {
  MANUAL_CORRECTION_ORIGIN,
  rejectCorrection,
  correctionStamp,
  type CorrectionRejection,
} from "@/lib/budgeting/manual-correction"

const bodySchema = z.object({
  companyId: z.string().min(1),
  planId: z.string().min(1),
  accountId: z.string().min(1),
  period: z.string().min(7),
  amount: z.number(),
  lineType: z.enum(["revenue", "cogs", "expense"]),
  reason: z.string(),
})

/** One sentence per refusal, so the caller can show it rather than a code. */
const REJECTION_MESSAGE: Record<CorrectionRejection, string> = {
  empty_reason:
    "A correction needs a reason. Six months from now it is the only thing that distinguishes it from a mistake.",
  zero_amount:
    "A zero adjustment changes nothing and would sit in every total and every review queue being nothing.",
  bad_period: "Corrections are monthly — use YYYY-MM, the same shape as the rows they sit beside.",
  missing_scope: "A correction must name a company, a plan and an account.",
}

export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { orgId, userId } = session

  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await req.json())
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const input = { ...parsed, organizationId: orgId, actorUserId: userId }
  const rejection = rejectCorrection(input)
  if (rejection) {
    return NextResponse.json(
      { error: rejection, message: REJECTION_MESSAGE[rejection] },
      { status: 400 },
    )
  }

  // A correction writes into a period like any other mutation, so it is
  // subject to the same lock. Deliberately NOT exempt: "the period is closed"
  // and "the number is wrong" are both true at once, and the resolution is a
  // conversation with whoever locked it, not a side door.
  const lock = await getActivePeriodLock(prisma, orgId, input.period)
  if (lock) {
    return lockedResponse(lock, {
      prisma,
      orgId,
      userId,
      route: "POST /api/budgeting/corrections",
    })
  }

  const month = Number(input.period.slice(5, 7))

  try {
    const created = await withOrgScope(orgId, async (tx) => {
      // The account and plan must belong to this org. RLS already scopes the
      // reads, so a foreign id simply returns nothing — 404 rather than a
      // foreign-key error that would leak whether the id exists elsewhere.
      const [account, plan] = await Promise.all([
        tx.chartOfAccount.findFirst({
          where: { id: input.accountId, organizationId: orgId },
          select: { id: true, code: true },
        }),
        tx.budgetPlan.findFirst({
          where: { id: input.planId, organizationId: orgId, deletedAt: null },
          select: { id: true, year: true },
        }),
      ])
      if (!account || !plan) return { notFound: true as const }

      const line = await tx.budgetLine.create({
        data: {
          organizationId: orgId,
          planId: plan.id,
          companyId: input.companyId,
          accountId: account.id,
          lineType: input.lineType,
          plannedAmount: input.amount,
          monthIndex: month,
          // A correction names itself in `sourceDocument` too, so the one
          // field every export and drill-down already prints cannot show it as
          // if it came from a file.
          sourceDocument: `manual-correction:${input.period}`,
          ...correctionStamp({
            reason: input.reason,
            actorUserId: userId,
            now: new Date(),
          }),
        },
        select: { id: true, plannedAmount: true, correctionAt: true },
      })

      await logAuditEvent(tx, {
        organizationId: orgId,
        actorUserId: userId,
        event: {
          action: "budget_correction_create",
          entityType: "BudgetLine",
          entityId: line.id,
          metadata: {
            companyId: input.companyId,
            planId: plan.id,
            accountCode: account.code,
            period: input.period,
            amount: input.amount,
            lineType: input.lineType,
            reason: input.reason.trim(),
          },
        },
      })
      return { line }
    })

    if ("notFound" in created) {
      return NextResponse.json(
        { error: "Account or plan not found in this organization" },
        { status: 404 },
      )
    }

    // Deliberately does NOT recompute here. The correction changes the rows;
    // turning that into indicators is the recompute pipeline's job and it is
    // async above 50 pairs. Firing it inline would make a single-row edit take
    // as long as an import, and — more importantly — would let the caller
    // believe the derived figures had already moved when for a large company
    // they have not.
    return NextResponse.json({
      ok: true,
      correction: created.line,
      next: "Re-run the statement check to see whether this closes the gap.",
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to write correction" },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { orgId } = session
  const companyId = req.nextUrl.searchParams.get("companyId")

  const rows = await withOrgScope(orgId, async (tx) =>
    tx.budgetLine.findMany({
      where: {
        organizationId: orgId,
        origin: MANUAL_CORRECTION_ORIGIN,
        deletedAt: null,
        ...(companyId ? { companyId } : {}),
      },
      select: {
        id: true,
        companyId: true,
        planId: true,
        lineType: true,
        plannedAmount: true,
        monthIndex: true,
        correctionReason: true,
        correctionBy: true,
        correctionAt: true,
        correctionReviewAt: true,
        account: { select: { code: true, name: true } },
      },
      // Review-flagged first: this endpoint is the queue, and the whole point
      // of the flag is that somebody looks at it.
      orderBy: [{ correctionReviewAt: "desc" }, { correctionAt: "desc" }],
      take: 500,
    }),
  )

  return NextResponse.json({
    corrections: rows,
    needsReview: rows.filter((r) => r.correctionReviewAt !== null).length,
  })
}
