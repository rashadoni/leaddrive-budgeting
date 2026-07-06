/**
 * Void a spend posting — `POST /api/trade/spend/[id]/void` (Phase 9.6).
 * Rows are never deleted; void stamps the entry out of every sum.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const { id } = await params

  const voided = await prisma.tradeSpendLedger.updateMany({
    where: { id, organizationId: session.orgId, voidedAt: null },
    data: { voidedAt: new Date(), voidedBy: session.userId },
  })
  if (voided.count === 0) {
    return NextResponse.json({ ok: false, error: "Entry not found or already voided" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
