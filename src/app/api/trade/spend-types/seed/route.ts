/**
 * Seed default trade spend types — `POST /api/trade/spend-types/seed`
 * (Phase 9.2). Inserts the A2-assumption dictionary (6 types) for this
 * org; existing keys are left untouched (skipDuplicates). Idempotent.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { buildDefaultSpendTypeRows } from "@/lib/trade/spend-types"

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  // Stage 3 RLS — seed write runs in the org-scoped tx.
  const result = await withOrgScope(orgId, (tx) =>
    tx.tradeSpendType.createMany({
      data: buildDefaultSpendTypeRows(orgId),
      skipDuplicates: true,
    }),
  )

  return NextResponse.json({ ok: true, created: result.count })
}
