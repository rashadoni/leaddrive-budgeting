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
  deltaToReach,
  type CorrectionRejection,
} from "@/lib/budgeting/manual-correction"

const bodySchema = z
  .object({
    companyId: z.string().min(1),
    planId: z.string().min(1),
    accountId: z.string().min(1),
    period: z.string().min(7),
    /** The adjustment to write. Omit when using `setTo`. */
    amount: z.number().optional(),
    /**
     * Phase 14.3 — "this figure should be X". The route reads what the cell
     * currently holds and writes the difference, so the caller expresses the
     * OUTCOME and the system still records an attributed adjustment rather
     * than editing an imported row. Exactly one of `amount` / `setTo`.
     */
    setTo: z.number().optional(),
    lineType: z.enum(["revenue", "cogs", "expense"]),
    reason: z.string(),
  })
  .refine((b) => (b.amount === undefined) !== (b.setTo === undefined), {
    message: "Provide exactly one of `amount` (an adjustment) or `setTo` (a target figure)",
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

  // `setTo` needs the cell's current contents, which needs the org scope, so
  // the amount is resolved inside the transaction below. Validate everything
  // that does not depend on it first — a bad reason should not cost a query.
  const input = {
    ...parsed,
    amount: parsed.amount ?? Number.NaN,
    organizationId: orgId,
    actorUserId: userId,
  }
  const rejection = rejectCorrection(
    parsed.setTo === undefined ? input : { ...input, amount: parsed.setTo || 1 },
  )
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

  // `monthIndex` is ZERO-BASED — 0 is January — while `period` is 1-based.
  //
  // The importer writes `monthIndex: m` from a `for (m = 0; m < 12; m++)` loop
  // whose period string is `${year}-${m + 1}`, and every reader compensates:
  // `pnl/route.ts` does `bl.monthIndex + 1`. This route shipped writing the
  // 1-based number, so a correction dated April would have been stored as May
  // and shown a month late in every total that buckets by month.
  //
  // Caught 2026-08-02 while answering a question about missing months on the
  // COGS tab, not by a test: nothing compares a correction's month against the
  // period it was entered for. The test below now does. Production had zero
  // corrections at the time, so nothing was mis-dated.
  const month = Number(input.period.slice(5, 7)) - 1

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

      // 14.3 — resolve "set it to X" into the adjustment that gets there.
      //
      // Summed over every LIVE row in the cell, corrections included: the
      // target is what the reader sees, and what they see already contains
      // any earlier adjustment. Computing against the imported rows alone
      // would silently double whatever was corrected before.
      let amount = parsed.amount ?? 0
      let setToFrom: number | null = null
      if (parsed.setTo !== undefined) {
        const agg = await tx.budgetLine.aggregate({
          _sum: { plannedAmount: true },
          where: {
            organizationId: orgId,
            planId: plan.id,
            companyId: input.companyId,
            accountId: account.id,
            monthIndex: month,
            deletedAt: null,
          },
        })
        const current = agg._sum.plannedAmount ?? 0
        const resolved = deltaToReach(current, parsed.setTo)
        if ("rejection" in resolved) return { setToRejected: resolved.rejection }
        amount = resolved.delta
        setToFrom = resolved.from
      }

      const line = await tx.budgetLine.create({
        data: {
          organizationId: orgId,
          planId: plan.id,
          companyId: input.companyId,
          accountId: account.id,
          lineType: input.lineType,
          plannedAmount: amount,
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
            amount,
            lineType: input.lineType,
            reason: input.reason.trim(),
          },
        },
      })
      return { line, setToFrom, setTo: parsed.setTo ?? null }
    })

    if ("setToRejected" in created) {
      return NextResponse.json(
        {
          error: created.setToRejected,
          message:
            created.setToRejected === "already_equals"
              ? "That cell already holds this figure — within half a qəpik. A correction that changes nothing would still sit in every total and every review queue."
              : "The target figure is not a finite number.",
        },
        { status: 400 },
      )
    }
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
      ...(created.setTo !== null
        ? { setTo: { from: created.setToFrom, to: created.setTo, delta: created.line.plannedAmount } }
        : {}),
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
