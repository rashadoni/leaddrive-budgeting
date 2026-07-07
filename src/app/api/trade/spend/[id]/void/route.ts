/**
 * Void a spend posting — `POST /api/trade/spend/[id]/void` (Phase 9.6).
 * Rows are never deleted; void stamps the entry out of every sum.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
// Stage 3 RLS — global client retained ONLY for lockedResponse's
// fire-and-forget 423-audit; data access rides the withOrgScope tx.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { findFirstActiveLockInPeriods } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeys } from "@/lib/budgeting/period-lock-http"
import { recomputeTradePacing } from "@/lib/trade/pacing-recompute"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const { id } = await params
  const orgId = session.orgId

  // Stage 3 RLS — lock check, void, recompute and audit in ONE
  // org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    // T4 (audit §1.4) — voiding a posting in a locked period changes that
    // period's totals just like a new posting would → same 423 gate.
    const target = await tx.tradeSpendLedger.findFirst({
      where: { id, organizationId: orgId },
      select: {
        year: true,
        month: true,
        entryKind: true,
        amount: true,
        entryDate: true,
        campaignId: true,
        channelId: true,
        spendType: { select: { key: true } },
      },
    })
    if (target) {
      const lock = await findFirstActiveLockInPeriods(
        tx,
        orgId,
        containingPeriodKeys(target.year, target.month),
      )
      if (lock) {
        // 423-audit rides the GLOBAL client (fire-and-forget must
        // survive this tx ending).
        return lockedResponse(lock, {
          prisma,
          orgId,
          userId: session.userId,
          route: "POST /api/trade/spend/[id]/void",
        })
      }
    }

    const voided = await tx.tradeSpendLedger.updateMany({
      where: { id, organizationId: orgId, voidedAt: null },
      data: { voidedAt: new Date(), voidedBy: session.userId },
    })
    if (voided.count === 0) {
      return NextResponse.json({ ok: false, error: "Entry not found or already voided" }, { status: 404 })
    }

    // R1 — voids change the month's totals; refresh snapshots + alerts.
    if (target) {
      await recomputeTradePacing(tx, orgId, target.year, target.month)

      // R8 — void is a period mutation; it gets its own trail row.
      await logAuditEvent(tx, {
        organizationId: orgId,
        actorUserId: session.userId,
        event: {
          action: "trade_spend_entry",
          entityType: "TradeSpendLedger",
          entityId: id,
          metadata: {
            op: "void",
            entryKind: target.entryKind,
            amount: target.amount,
            spendTypeKey: target.spendType.key,
            entryDate: target.entryDate.toISOString().slice(0, 10),
            ...(target.campaignId ? { campaignId: target.campaignId } : {}),
            ...(target.channelId ? { channelId: target.channelId } : {}),
          },
        },
        context: buildAuditContext({
          route: "POST /api/trade/spend/[id]/void",
          userAgent: request.headers.get("user-agent") ?? undefined,
        }),
      })
    }
    return NextResponse.json({ ok: true })
  })
}
