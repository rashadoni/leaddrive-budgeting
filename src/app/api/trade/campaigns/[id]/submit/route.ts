/**
 * Submit a trade campaign for finance approval —
 * `POST /api/trade/campaigns/[id]/submit` (Phase 9.4).
 *
 * draft | rejected → pending_approval + an ApprovalRequest
 * (`trade_campaign_activate`). The reviewer decides via the existing
 * PATCH /api/budgeting/approval-requests/[id], whose apply branch flips
 * the campaign to approved / rejected / back-to-draft (on cancel).
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
// Stage 3 RLS — global client retained ONLY for the fire-and-forget
// reviewer notification (must survive the scoped tx ending).
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { canSubmitCampaign } from "@/lib/trade/campaigns"
import type { TradeCampaignActivateChange } from "@/lib/budgeting/approval-request"
import { notifyApprovalCreated } from "@/lib/budgeting/approval-notifications"

const RATE_LIMIT = { name: "trade-campaigns-submit", max: 20, windowMs: 60_000 }

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId
  const { id } = await params

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${orgId}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  // Stage 3 RLS — read, guarded flip and request create in ONE
  // org-scoped tx.
  const outcome = await withOrgScope(orgId, async (tx) => {
    const campaign = await tx.tradeCampaign.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        plannedBudgetAmount: true,
      },
    })
    if (!campaign) {
      return { error: NextResponse.json({ ok: false, error: "Campaign not found" }, { status: 404 }) }
    }
    if (!canSubmitCampaign(campaign.status)) {
      return {
        error: NextResponse.json(
          { ok: false, error: `Campaign in status "${campaign.status}" cannot be submitted` },
          { status: 409 },
        ),
      }
    }

    const proposedChange: TradeCampaignActivateChange = {
      campaignId: campaign.id,
      campaignCode: campaign.code,
      campaignName: campaign.name,
      plannedBudgetAmount: campaign.plannedBudgetAmount,
      startDate: campaign.startDate.toISOString().slice(0, 10),
      endDate: campaign.endDate.toISOString().slice(0, 10),
    }

    // Guarded flip — a concurrent submit loses the race and 409s below.
    const flipped = await tx.tradeCampaign.updateMany({
      where: { id: campaign.id, organizationId: orgId, status: campaign.status, deletedAt: null },
      data: { status: "pending_approval", approvalRequestId: null },
    })
    if (flipped.count !== 1) {
      return {
        error: NextResponse.json(
          { ok: false, error: "Campaign was modified concurrently — reload and retry" },
          { status: 409 },
        ),
      }
    }
    const approvalRequest = await tx.approvalRequest.create({
      data: {
        organizationId: orgId,
        requestType: "trade_campaign_activate",
        targetType: "TradeCampaign",
        targetId: campaign.id,
        proposedChange: proposedChange as unknown as object,
        requestedBy: session.userId,
      },
      select: { id: true, status: true, requestedAt: true },
    })
    return { approvalRequest, campaign }
  })
  if ("error" in outcome) return outcome.error
  const { approvalRequest, campaign } = outcome

  // Best-effort reviewer notification — same contract as the generic
  // approval-requests POST route.
  void notifyApprovalCreated(prisma, {
    orgId,
    requestType: "trade_campaign_activate",
    requesterUserId: session.userId,
    requesterName: session.name || session.email || session.userId,
    reason: `Campaign "${campaign.name}" (${campaign.code}) activation`,
  }).catch(() => {})

  return NextResponse.json({ ok: true, approvalRequest }, { status: 201 })
}
