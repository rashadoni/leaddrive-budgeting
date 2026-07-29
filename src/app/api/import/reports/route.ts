/**
 * Phase 11.34 (2026-07-29) — the reader `ImportBatchReport` never had.
 *
 * GET /api/import/reports
 *
 * Query string:
 *   runId?     — all file-group rows of one import run
 *   year?      — target year of the import
 *   verdict?   — green | yellow | red
 *   evidence?  — db-readback | parse-self-check
 *   committed? — "1"/"true": only imports whose write committed
 *   cursor?    — opaque `<ISO-8601>|<id>` from the previous page's nextCursor
 *   limit?     — page size (default 50, max 200)
 *   detail?    — "1"/"true": include the full reconciliation `report` JSON.
 *                Off by default because that column holds per-sheet drift for
 *                every sheet of every file in the run and would dominate a
 *                list response.
 *
 * Auth: `manager`, matching the audit-events reader. An import verdict carries
 * the same class of business-impact detail as the audit log (which companies
 * were written, how far the sums drifted), so viewer-tier is not granted it.
 * Note this is a LOWER bar than the admin-only routes that WRITE these rows —
 * deliberately: a verdict that only its own author can read is not evidence.
 *
 * Response:
 *   { reports: ShapedBatchReport[], nextCursor: string | null, hasMore: boolean }
 */
import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
import { withOrgScope } from "@/lib/db/with-org-scope"
import {
  parseBatchReportQuery,
  buildBatchReportWhere,
  shapeBatchReport,
  nextBatchReportCursor,
  BatchReportQueryError,
  type BatchReportRow,
} from "@/lib/import/batch-reports"

const RATE_LIMIT = { name: "import-batch-reports-list", max: 60, windowMs: 60_000 }

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${orgId}:${session.userId}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  const { searchParams } = new URL(request.url)
  let query
  try {
    query = parseBatchReportQuery(searchParams)
  } catch (err) {
    if (err instanceof BatchReportQueryError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
  const detailRaw = searchParams.get("detail")?.trim().toLowerCase()
  const includeReport = detailRaw === "1" || detailRaw === "true"

  const where = buildBatchReportWhere(orgId, query) as Prisma.ImportBatchReportWhereInput

  // Fetch one extra row to decide `hasMore` without a second count query.
  const rows = (await withOrgScope(orgId, (tx) =>
    tx.importBatchReport.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
  )) as unknown as BatchReportRow[]

  const hasMore = rows.length > query.limit
  const page = hasMore ? rows.slice(0, query.limit) : rows

  return NextResponse.json({
    reports: page.map((r) => shapeBatchReport(r, includeReport)),
    nextCursor: nextBatchReportCursor(page, hasMore),
    hasMore,
  })
}
