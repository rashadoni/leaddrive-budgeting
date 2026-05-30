/**
 * Lightweight count-only sibling of `/api/budgeting/lines`.
 *
 * Phase 7.G perf gate: `TemplateSeedButton` previously called the full
 * `/lines` endpoint just to evaluate `if (lines.length > 0) return null`,
 * downloading 4.3 MB of BudgetLine rows on every `/budgeting` page load
 * (every tab — the button mounts in the page header). This endpoint
 * returns `{ count }` only — typically <200 bytes.
 *
 * Same auth + org-scope contract as the parent `/lines` route.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const planId = url.searchParams.get("planId")
  if (!planId) {
    return NextResponse.json({ error: "planId required" }, { status: 400 })
  }

  const count = await prisma.budgetLine.count({
    // Phase 8 fix: honor soft-delete — count only live lines.
    where: { planId, organizationId: session.orgId, deletedAt: null },
  })
  return NextResponse.json({ count })
}
