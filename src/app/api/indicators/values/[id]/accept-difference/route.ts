/**
 * Phase 13.7 (2026-08-02) — sign for a difference the data cannot close.
 *
 * 11.91 makes a disagreement with the client's own statement impossible to
 * ignore, which is the point. Sometimes the platform is right and the workbook
 * is stale, and then no correction to our data will ever clear the marker.
 * AZSF 2025 is the live case: that block does not cross-foot in EITHER
 * direction — −95,053 with `PLF.08.*`, +79,438 without, the difference being
 * exactly `PLF.08.01` = 174,491. The workbook disagrees with itself.
 *
 * Without this endpoint the only way to silence that marker is to falsify a
 * row, and the feature would have produced exactly the behaviour it exists to
 * prevent.
 *
 * Three things this deliberately does NOT do:
 *   · It does not write `lastReconciledAt`. An accepted difference is a
 *     decision ABOUT a disagreement, not the absence of one, and the
 *     decision-grade gate must keep seeing it that way.
 *   · It does not clear `reconExpected`. The screen must still be able to show
 *     both numbers — accepting is not forgetting.
 *   · It does not accept "this cell", it accepts THIS GAP. The delta is
 *     recorded, and the next check compares against it; a moved number is a
 *     different disagreement nobody has looked at.
 */
import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { logAuditEvent } from "@/lib/audit/log"

const bodySchema = z.object({ reason: z.string() })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Manager, not editor. Accepting a difference is signing that the platform
  // is right and the client's own paperwork is wrong — a judgement above the
  // bar for entering a number.
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  const { orgId, userId } = session
  const { id } = await params

  let reason: string
  try {
    reason = bodySchema.parse(await req.json()).reason
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (reason.trim().length < 10) {
    return NextResponse.json(
      {
        error: "reason_too_short",
        message:
          "Say why the difference is acceptable. This signature is what someone reads instead of the discrepancy, and it has to answer them.",
      },
      { status: 400 },
    )
  }

  const now = new Date()
  const result = await withOrgScope(orgId, async (tx) => {
    const iv = await tx.indicatorValue.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        value: true,
        reconStatus: true,
        reconExpected: true,
        indicator: { select: { code: true } },
      },
    })
    if (!iv) return { notFound: true as const }
    // Only a KNOWN disagreement can be accepted. Signing for a value nobody
    // has checked would create the appearance of scrutiny where there was
    // none — the exact thing 11.91 exists to stop.
    if (iv.reconStatus !== "mismatched") {
      return { notMismatched: iv.reconStatus ?? null }
    }
    if (iv.reconExpected === null) return { notMismatched: "no_expected" as const }

    const delta = iv.value - iv.reconExpected
    await tx.indicatorValue.update({
      where: { id: iv.id },
      data: {
        reconStatus: "accepted",
        reconAcceptedBy: userId,
        reconAcceptedReason: reason.trim(),
        reconAcceptedAt: now,
        // The gap that was signed for. This is what makes the signature
        // re-verifiable instead of a mute button.
        reconAcceptedDelta: delta,
        // Deliberately untouched: `lastReconciledAt` stays null, so the gate
        // still withholds decision-grade. Accepting a difference is not
        // reconciling it.
      },
    })
    await logAuditEvent(tx, {
      organizationId: orgId,
      actorUserId: userId,
      event: {
        action: "indicator_difference_accept",
        entityType: "IndicatorValue",
        entityId: iv.id,
        metadata: {
          indicatorCode: iv.indicator.code,
          value: iv.value,
          expected: iv.reconExpected,
          delta,
          reason: reason.trim(),
        },
      },
    })
    return { accepted: { id: iv.id, delta } }
  })

  if ("notFound" in result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if ("notMismatched" in result) {
    return NextResponse.json(
      {
        error: "not_a_known_difference",
        message:
          "Only a value the statement check has already flagged can be accepted. Run the check first — signing for something nobody compared would create the appearance of scrutiny where there was none.",
        reconStatus: result.notMismatched,
      },
      { status: 409 },
    )
  }
  return NextResponse.json({
    ok: true,
    ...result.accepted,
    note: "Recorded as an ACCEPTED difference, not a match. If the number moves, the signature stops covering it and the value returns to mismatched.",
  })
}
