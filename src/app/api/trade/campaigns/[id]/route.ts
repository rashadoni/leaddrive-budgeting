/**
 * Trade campaign item — `PATCH | DELETE /api/trade/campaigns/[id]` (Phase 9.4).
 *
 * PATCH  (manager): edit fields/scopes while the campaign is editable
 *                   (draft | rejected). Scopes replace wholesale.
 * DELETE (manager): soft-delete an editable campaign.
 */
import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { campaignUpdateSchema, isCampaignEditable } from "@/lib/trade/campaigns"

const RATE_LIMIT = { name: "trade-campaigns-item", max: 30, windowMs: 60_000 }

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId
  const { id } = await params

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${orgId}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }
  let parsed
  try {
    parsed = campaignUpdateSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }

  const campaign = await prisma.tradeCampaign.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    select: { id: true, status: true, startDate: true, endDate: true },
  })
  if (!campaign) {
    return NextResponse.json({ ok: false, error: "Campaign not found" }, { status: 404 })
  }
  if (!isCampaignEditable(campaign.status)) {
    return NextResponse.json(
      { ok: false, error: `Campaign in status "${campaign.status}" is not editable` },
      { status: 409 },
    )
  }

  // Re-validate date order against the merged row.
  const startDate = parsed.startDate ? new Date(parsed.startDate) : campaign.startDate
  const endDate = parsed.endDate ? new Date(parsed.endDate) : campaign.endDate
  if (endDate < startDate) {
    return NextResponse.json(
      { ok: false, error: "endDate must be on or after startDate" },
      { status: 400 },
    )
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Codex review #6 — the editability pre-check above can go stale
    // between read and write (e.g. submit-for-approval racing this PATCH).
    // The write itself re-asserts org + not-deleted + editable status; the
    // scope replace runs after, only for the winner.
    const claimed = await tx.tradeCampaign.updateMany({
      where: { id, organizationId: orgId, deletedAt: null, status: { in: ["draft", "rejected"] } },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.goal !== undefined ? { goal: parsed.goal } : {}),
        startDate,
        endDate,
        ...(parsed.plannedBudgetAmount !== undefined
          ? { plannedBudgetAmount: parsed.plannedBudgetAmount }
          : {}),
        ...(parsed.expectedSalesUpliftAmount !== undefined
          ? { expectedSalesUpliftAmount: parsed.expectedSalesUpliftAmount }
          : {}),
        ...(parsed.expectedSalesUpliftPct !== undefined
          ? { expectedSalesUpliftPct: parsed.expectedSalesUpliftPct }
          : {}),
      },
    })
    if (claimed.count === 0) return null
    if (parsed.scopes) {
      await tx.tradeCampaignScope.deleteMany({ where: { campaignId: id, organizationId: orgId } })
      if (parsed.scopes.length > 0) {
        await tx.tradeCampaignScope.createMany({
          data: parsed.scopes.map((s) => ({
            organizationId: orgId,
            campaignId: id,
            scopeType: s.scopeType,
            scopeId: s.scopeId ?? null,
            scopeValue: s.scopeValue ?? null,
            include: s.include,
          })),
        })
      }
    }
    return tx.tradeCampaign.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, code: true, status: true, updatedAt: true },
    })
  })
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "Campaign changed concurrently and is no longer editable" },
      { status: 409 },
    )
  }

  return NextResponse.json({ ok: true, campaign: updated })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const { id } = await params

  const campaign = await prisma.tradeCampaign.findFirst({
    where: { id, organizationId: session.orgId, deletedAt: null },
    select: { id: true, status: true },
  })
  if (!campaign) {
    return NextResponse.json({ ok: false, error: "Campaign not found" }, { status: 404 })
  }
  if (!isCampaignEditable(campaign.status)) {
    return NextResponse.json(
      { ok: false, error: `Campaign in status "${campaign.status}" cannot be deleted` },
      { status: 409 },
    )
  }

  // Codex review #2 — a campaign with ledger postings is financial
  // history; void the entries first, then delete.
  const ledgerRefs = await prisma.tradeSpendLedger.count({
    where: { organizationId: session.orgId, campaignId: id, voidedAt: null },
  })
  if (ledgerRefs > 0) {
    return NextResponse.json(
      { ok: false, error: `Campaign has ${ledgerRefs} spend entries — void them before deleting` },
      { status: 409 },
    )
  }

  // Codex review #6 — soft-delete re-asserts org/editable/not-deleted in
  // the write itself (the pre-check can go stale under concurrency).
  const deleted = await prisma.tradeCampaign.updateMany({
    where: {
      id,
      organizationId: session.orgId,
      deletedAt: null,
      status: { in: ["draft", "rejected"] },
    },
    data: { deletedAt: new Date(), deletedBy: session.userId },
  })
  if (deleted.count === 0) {
    return NextResponse.json(
      { ok: false, error: "Campaign changed concurrently and can no longer be deleted" },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true })
}
