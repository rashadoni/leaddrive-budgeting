/**
 * Phase 7.L — GET /api/admin/recent-crossings/[sourceCode]
 *
 * Returns aggregate recent-crossings for one external source. Used by
 * the admin Data Sources page widget. Admin role required.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getRecentCrossingsForSource } from "@/lib/server/get-recent-crossings-for-source"

export const maxDuration = 5

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sourceCode: string }> },
) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const { sourceCode } = await params
  if (!sourceCode || typeof sourceCode !== "string") {
    return NextResponse.json({ error: "sourceCode required" }, { status: 400 })
  }

  try {
    const summaries = await getRecentCrossingsForSource(
      prisma,
      session.orgId,
      sourceCode,
      5,
    )
    return NextResponse.json({ crossings: summaries })
  } catch (err) {
    console.error("[recent-crossings GET] failed:", err)
    return NextResponse.json(
      { error: "Failed to fetch recent crossings" },
      { status: 500 },
    )
  }
}
