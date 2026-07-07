/**
 * Trade spend ledger — `GET | POST /api/trade/spend` (Phase 9.6).
 *
 * GET  ?year&month (viewer): month's live entries + Plan/Accrued/Actual/
 *      Control summary per spend type (control per accrual method).
 * POST (manager): manual posting (plan | accrued | actual; negative =
 *      credit correction). On-invoice/retro AUTO-accrual arrives with
 *      the 9.5 invoice adapter — until then postings are manual.
 */
import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
// Stage 3 RLS — the global client is kept ONLY for lockedResponse's
// fire-and-forget 423-audit (must not ride the scoped tx: it can commit
// before the void write fires). All data access goes through the
// withOrgScope tx.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { spendEntrySchema, summarizeLedger } from "@/lib/trade/ledger"
import { findFirstActiveLockInPeriods } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeys } from "@/lib/budgeting/period-lock-http"
import { recomputeTradePacing } from "@/lib/trade/pacing-recompute"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"

const RATE_LIMIT = { name: "trade-spend-post", max: 60, windowMs: 60_000 }

const ENTRY_SELECT = {
  id: true,
  entryKind: true,
  entryDate: true,
  amount: true,
  currencyCode: true,
  sourceDocument: true,
  campaignId: true,
  channelId: true,
  createdBy: true,
  createdAt: true,
  voidedAt: true,
  spendType: { select: { id: true, key: true, label: true, accrualMethod: true } },
} as const

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const now = new Date()
  const year = Number(request.nextUrl.searchParams.get("year") ?? now.getUTCFullYear())
  const month = Number(request.nextUrl.searchParams.get("month") ?? now.getUTCMonth() + 1)

  const orgId = session.orgId
  // Stage 3 RLS — reads in the org-scoped tx.
  const { withNames, summary } = await withOrgScope(orgId, async (tx) => {
    const entries = await tx.tradeSpendLedger.findMany({
      where: { organizationId: orgId, year, month, voidedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: ENTRY_SELECT,
    })

    // T5 (audit §1.9) — accountability: resolve poster names for the UI.
    const userIds = [...new Set(entries.map((e) => e.createdBy))]
    const channelIds = [...new Set(entries.map((e) => e.channelId).filter((v): v is string => !!v))]
    const users = await tx.user.findMany({
      where: { id: { in: userIds }, organizationId: orgId },
      select: { id: true, name: true, email: true },
    })
    const channels = await tx.tradeChannel.findMany({
      where: { id: { in: channelIds }, organizationId: orgId },
      select: { id: true, name: true },
    })
    const nameById = new Map(users.map((u) => [u.id, u.name || u.email]))
    const channelNameById = new Map(channels.map((c) => [c.id, c.name]))
    const withNames = entries.map((e) => ({
      ...e,
      createdByName: nameById.get(e.createdBy) ?? e.createdBy,
      channelName: e.channelId ? (channelNameById.get(e.channelId) ?? null) : null,
    }))
    return { withNames, summary: summarizeLedger(entries) }
  })

  return NextResponse.json({
    ok: true,
    year,
    month,
    entries: withNames,
    summary,
  })
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${orgId}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  let parsed
  try {
    parsed = spendEntrySchema.parse(await request.json())
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const entryDate = new Date(parsed.entryDate + "T00:00:00Z")

  // Stage 3 RLS — guards, lock check, create, recompute and audit run in
  // ONE org-scoped tx (atomic: a posting and its snapshot can't diverge).
  return withOrgScope(orgId, async (tx) => {
    // Spend type + optional campaign must belong to this org.
    const spendType = await tx.tradeSpendType.findFirst({
      where: { id: parsed.spendTypeId, organizationId: orgId, isActive: true },
      select: { id: true, key: true },
    })
    if (!spendType) {
      return NextResponse.json({ ok: false, error: "Spend type not found" }, { status: 404 })
    }
    if (parsed.campaignId) {
      const campaign = await tx.tradeCampaign.findFirst({
        where: { id: parsed.campaignId, organizationId: orgId, deletedAt: null },
        select: { id: true, status: true },
      })
      if (!campaign) {
        return NextResponse.json({ ok: false, error: "Campaign not found" }, { status: 404 })
      }
      // Codex review #2 — real money (accrued/actual) only against an
      // APPROVED campaign; plan postings (commitments) may reference a
      // campaign still moving through approval.
      const allowed =
        parsed.entryKind === "plan"
          ? ["draft", "pending_approval", "approved"]
          : ["approved"]
      if (!allowed.includes(campaign.status)) {
        return NextResponse.json(
          {
            ok: false,
            error: `Campaign in status "${campaign.status}" cannot take ${parsed.entryKind} postings`,
          },
          { status: 409 },
        )
      }
    }
    if (parsed.channelId) {
      const channel = await tx.tradeChannel.findFirst({
        where: { id: parsed.channelId, organizationId: orgId, deletedAt: null },
        select: { id: true },
      })
      if (!channel) {
        return NextResponse.json({ ok: false, error: "Channel not found" }, { status: 404 })
      }
    }

    // T4 (audit §1.4) — a posting into a CFO-locked period gets 423, same
    // contract as every other financial mutation on the platform.
    const lock = await findFirstActiveLockInPeriods(
      tx,
      orgId,
      containingPeriodKeys(entryDate.getUTCFullYear(), entryDate.getUTCMonth() + 1),
    )
    if (lock) {
      // 423-audit rides the GLOBAL client (fire-and-forget must survive
      // this tx ending).
      return lockedResponse(lock, {
        prisma,
        orgId,
        userId: session.userId,
        route: "POST /api/trade/spend",
      })
    }

    const entry = await tx.tradeSpendLedger.create({
      data: {
        organizationId: orgId,
        entryKind: parsed.entryKind,
        spendTypeId: parsed.spendTypeId,
        campaignId: parsed.campaignId ?? null,
        channelId: parsed.channelId ?? null,
        entryDate,
        year: entryDate.getUTCFullYear(),
        month: entryDate.getUTCMonth() + 1,
        amount: parsed.amount,
        sourceDocument: parsed.note ?? null,
        createdBy: session.userId,
      },
      select: ENTRY_SELECT,
    })

    // R1 — the dashboard must never show yesterday's picture: recompute
    // pacing snapshots + alerts for the affected month in the same request.
    await recomputeTradePacing(tx, orgId, entryDate.getUTCFullYear(), entryDate.getUTCMonth() + 1)

    // R8 — every manual posting leaves an audit-trail row (best-effort,
    // never reverses the write; platform contract).
    await logAuditEvent(tx, {
      organizationId: orgId,
      actorUserId: session.userId,
      event: {
        action: "trade_spend_entry",
        entityType: "TradeSpendLedger",
        entityId: entry.id,
        metadata: {
          op: "post",
          entryKind: parsed.entryKind,
          amount: parsed.amount,
          spendTypeKey: spendType.key,
          entryDate: parsed.entryDate,
          ...(parsed.campaignId ? { campaignId: parsed.campaignId } : {}),
          ...(parsed.channelId ? { channelId: parsed.channelId } : {}),
        },
      },
      context: buildAuditContext({
        route: "POST /api/trade/spend",
        userAgent: request.headers.get("user-agent") ?? undefined,
      }),
    })

    return NextResponse.json({ ok: true, entry }, { status: 201 })
  })
}
