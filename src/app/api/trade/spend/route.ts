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
import { prisma } from "@/lib/prisma"
import { spendEntrySchema, summarizeLedger } from "@/lib/trade/ledger"

const RATE_LIMIT = { name: "trade-spend-post", max: 60, windowMs: 60_000 }

const ENTRY_SELECT = {
  id: true,
  entryKind: true,
  entryDate: true,
  amount: true,
  currencyCode: true,
  sourceDocument: true,
  campaignId: true,
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

  const entries = await prisma.tradeSpendLedger.findMany({
    where: { organizationId: session.orgId, year, month, voidedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: ENTRY_SELECT,
  })

  return NextResponse.json({
    ok: true,
    year,
    month,
    entries,
    summary: summarizeLedger(entries),
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

  // Spend type + optional campaign must belong to this org.
  const spendType = await prisma.tradeSpendType.findFirst({
    where: { id: parsed.spendTypeId, organizationId: orgId, isActive: true },
    select: { id: true },
  })
  if (!spendType) {
    return NextResponse.json({ ok: false, error: "Spend type not found" }, { status: 404 })
  }
  if (parsed.campaignId) {
    const campaign = await prisma.tradeCampaign.findFirst({
      where: { id: parsed.campaignId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    })
    if (!campaign) {
      return NextResponse.json({ ok: false, error: "Campaign not found" }, { status: 404 })
    }
  }

  const entryDate = new Date(parsed.entryDate + "T00:00:00Z")
  const entry = await prisma.tradeSpendLedger.create({
    data: {
      organizationId: orgId,
      entryKind: parsed.entryKind,
      spendTypeId: parsed.spendTypeId,
      campaignId: parsed.campaignId ?? null,
      entryDate,
      year: entryDate.getUTCFullYear(),
      month: entryDate.getUTCMonth() + 1,
      amount: parsed.amount,
      sourceDocument: parsed.note ?? null,
      createdBy: session.userId,
    },
    select: ENTRY_SELECT,
  })

  return NextResponse.json({ ok: true, entry }, { status: 201 })
}
