/**
 * Trade campaigns — `GET | POST /api/trade/campaigns` (Phase 9.4).
 *
 * GET  (viewer):  live campaigns with scopes, newest first.
 * POST (manager): create a DRAFT campaign (+ scopes). Activation goes
 * through POST /api/trade/campaigns/[id]/submit → ApprovalRequest.
 */
import { NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import {
  campaignCreateSchema,
  campaignCodeFromName,
} from "@/lib/trade/campaigns"
import { rollupCampaignSpend } from "@/lib/trade/ledger"

const RATE_LIMIT = { name: "trade-campaigns-post", max: 30, windowMs: 60_000 }

const CAMPAIGN_SELECT = {
  id: true,
  code: true,
  name: true,
  goal: true,
  startDate: true,
  endDate: true,
  status: true,
  plannedBudgetAmount: true,
  expectedSalesUpliftAmount: true,
  expectedSalesUpliftPct: true,
  approvalRequestId: true,
  ownerUserId: true,
  currencyCode: true,
  createdAt: true,
  updatedAt: true,
  scopes: {
    select: { id: true, scopeType: true, scopeId: true, scopeValue: true, include: true },
  },
} as const

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }

  const campaigns = await prisma.tradeCampaign.findMany({
    where: { organizationId: session.orgId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: CAMPAIGN_SELECT,
  })

  // T1 (audit §1.2) — per-campaign spend rollup from campaign-tagged
  // ledger postings, so the card answers spent/remaining, not just plan.
  const ledger = await prisma.tradeSpendLedger.findMany({
    where: {
      organizationId: session.orgId,
      voidedAt: null,
      campaignId: { in: campaigns.map((c) => c.id) },
    },
    select: {
      campaignId: true,
      entryKind: true,
      amount: true,
      spendType: { select: { id: true, key: true, label: true, accrualMethod: true } },
    },
  })
  const rollups = rollupCampaignSpend(ledger)
  const withSpend = campaigns.map((c) => {
    const spend = rollups.get(c.id) ?? { committed: 0, accrued: 0, actual: 0, control: 0 }
    return { ...c, spend: { ...spend, remaining: Math.round((c.plannedBudgetAmount - spend.control) * 100) / 100 } }
  })
  return NextResponse.json({ ok: true, campaigns: withSpend })
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  let parsed
  try {
    parsed = campaignCreateSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }

  const code = parsed.code ?? campaignCodeFromName(parsed.name)
  try {
    const campaign = await prisma.tradeCampaign.create({
      data: {
        organizationId: orgId,
        code,
        name: parsed.name,
        goal: parsed.goal ?? null,
        startDate: new Date(parsed.startDate),
        endDate: new Date(parsed.endDate),
        plannedBudgetAmount: parsed.plannedBudgetAmount,
        expectedSalesUpliftAmount: parsed.expectedSalesUpliftAmount ?? null,
        expectedSalesUpliftPct: parsed.expectedSalesUpliftPct ?? null,
        ownerUserId: session.userId,
        scopes: {
          create: parsed.scopes.map((s) => ({
            organizationId: orgId,
            scopeType: s.scopeType,
            scopeId: s.scopeId ?? null,
            scopeValue: s.scopeValue ?? null,
            include: s.include,
          })),
        },
      },
      select: CAMPAIGN_SELECT,
    })
    return NextResponse.json({ ok: true, campaign }, { status: 201 })
  } catch (e) {
    // P2002 = (organizationId, code) unique collision.
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { ok: false, error: `Campaign code "${code}" already exists` },
        { status: 409 },
      )
    }
    throw e
  }
}
