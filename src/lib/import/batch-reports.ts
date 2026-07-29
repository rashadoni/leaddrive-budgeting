/**
 * Phase 11.34 (2026-07-29) — read side for `ImportBatchReport`.
 *
 * The table has been written on every multi-file import since Phase 11.2
 * (`multi-file-orchestrator.ts`) and had **no reader at all** — not a route,
 * not a page, not a script. A verdict nobody can retrieve is not evidence: it
 * is a row that makes the system look audited while the reconciliation result
 * is reachable only by opening a psql session against production.
 *
 * That matters most for the distinction the table goes out of its way to
 * record. `evidence` separates `db-readback` (sums re-queried from the
 * database after the write) from `parse-self-check` (a parse-time compare that
 * proves nothing about what landed). A green verdict backed by the second is a
 * far weaker claim than one backed by the first, and until this reader existed
 * nobody could tell them apart after the fact.
 *
 * Pure query-parsing / shaping helpers, so the route stays thin and this is
 * unit-testable without a database.
 */

export type ImportVerdict = "green" | "yellow" | "red"
export type ImportEvidence = "db-readback" | "parse-self-check"

const VERDICTS = new Set<string>(["green", "yellow", "red"])
const EVIDENCE = new Set<string>(["db-readback", "parse-self-check"])

export const BATCH_REPORT_DEFAULT_LIMIT = 50
export const BATCH_REPORT_MAX_LIMIT = 200

export interface BatchReportQuery {
  runId?: string
  year?: number
  verdict?: ImportVerdict
  evidence?: ImportEvidence
  /** Only reports whose write actually committed. */
  committedOnly: boolean
  limit: number
  /** Opaque keyset cursor: `<ISO-8601>|<id>`. */
  cursor?: { createdAt: Date; id: string }
}

export class BatchReportQueryError extends Error {}

/** Parse `<ISO-8601>|<id>`. Throws `BatchReportQueryError` on a malformed value. */
export function parseBatchReportCursor(raw: string): { createdAt: Date; id: string } {
  const sep = raw.indexOf("|")
  if (sep <= 0 || sep === raw.length - 1) {
    throw new BatchReportQueryError("cursor must be '<ISO-8601>|<id>'")
  }
  const createdAt = new Date(raw.slice(0, sep))
  if (Number.isNaN(createdAt.getTime())) {
    throw new BatchReportQueryError("cursor timestamp is not a valid ISO-8601 date")
  }
  return { createdAt, id: raw.slice(sep + 1) }
}

/**
 * Validate the query string.
 *
 * An unrecognised `verdict` or `evidence` is REJECTED rather than ignored: a
 * silently dropped filter returns the full list, and a reviewer scanning for
 * red imports would read "no red imports" off a filter that never applied.
 */
export function parseBatchReportQuery(params: URLSearchParams): BatchReportQuery {
  const out: BatchReportQuery = {
    committedOnly: false,
    limit: BATCH_REPORT_DEFAULT_LIMIT,
  }

  const runId = params.get("runId")?.trim()
  if (runId) out.runId = runId

  const yearRaw = params.get("year")
  if (yearRaw != null && yearRaw !== "") {
    const year = Number(yearRaw)
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      throw new BatchReportQueryError(`year "${yearRaw}" is not a plausible calendar year`)
    }
    out.year = year
  }

  const verdict = params.get("verdict")?.trim()
  if (verdict) {
    if (!VERDICTS.has(verdict)) {
      throw new BatchReportQueryError(
        `verdict "${verdict}" is not one of green | yellow | red`,
      )
    }
    out.verdict = verdict as ImportVerdict
  }

  const evidence = params.get("evidence")?.trim()
  if (evidence) {
    if (!EVIDENCE.has(evidence)) {
      throw new BatchReportQueryError(
        `evidence "${evidence}" is not one of db-readback | parse-self-check`,
      )
    }
    out.evidence = evidence as ImportEvidence
  }

  const committed = params.get("committed")?.trim().toLowerCase()
  if (committed === "1" || committed === "true") out.committedOnly = true

  const limitRaw = params.get("limit")
  if (limitRaw != null && limitRaw !== "") {
    const limit = Number(limitRaw)
    if (!Number.isInteger(limit) || limit < 1) {
      throw new BatchReportQueryError(`limit "${limitRaw}" must be a positive integer`)
    }
    out.limit = Math.min(limit, BATCH_REPORT_MAX_LIMIT)
  }

  const cursor = params.get("cursor")
  if (cursor) out.cursor = parseBatchReportCursor(cursor)

  return out
}

/**
 * Prisma `where` for one org.
 *
 * The cursor clause is composite on `(createdAt, id)` — the same shape the
 * audit-events reader uses, and for the same reason: a bulk import writes one
 * row per file-group inside a single transaction, so several rows routinely
 * share an exact millisecond. A strict `lt: createdAt` would drop every
 * same-ms sibling past the page boundary, which on this table means losing
 * whole file-groups of a run rather than a stray row.
 */
export function buildBatchReportWhere(
  organizationId: string,
  q: BatchReportQuery,
): Record<string, unknown> {
  const where: Record<string, unknown> = { organizationId }
  if (q.runId) where.runId = q.runId
  if (q.year !== undefined) where.year = q.year
  if (q.verdict) where.verdict = q.verdict
  if (q.evidence) where.evidence = q.evidence
  if (q.committedOnly) where.committed = true
  if (q.cursor) {
    where.OR = [
      { createdAt: { lt: q.cursor.createdAt } },
      { createdAt: q.cursor.createdAt, id: { lt: q.cursor.id } },
    ]
  }
  return where
}

export interface BatchReportRow {
  id: string
  runId: string
  fileType: string
  filenames: string[]
  year: number
  verdict: string
  evidence: string
  sheetsVerified: number
  sheetsUnverified: number
  rowsInserted: number
  committed: boolean
  actorUserId: string | null
  createdAt: Date
  report: unknown
}

export interface ShapedBatchReport {
  id: string
  runId: string
  fileType: string
  filenames: string[]
  year: number
  verdict: string
  evidence: string
  sheetsVerified: number
  sheetsUnverified: number
  rowsInserted: number
  committed: boolean
  actorUserId: string | null
  createdAt: string
  /**
   * True when the verdict rests on a parse-time self-compare rather than a
   * post-write database read. Surfaced as its own flag because "green" alone
   * reads as verified, and these two greens are not the same claim.
   */
  verdictUnverified: boolean
  /** Full reconciliation detail — only when the caller asked for it. */
  report?: unknown
}

export function shapeBatchReport(row: BatchReportRow, includeReport: boolean): ShapedBatchReport {
  const shaped: ShapedBatchReport = {
    id: row.id,
    runId: row.runId,
    fileType: row.fileType,
    filenames: row.filenames,
    year: row.year,
    verdict: row.verdict,
    evidence: row.evidence,
    sheetsVerified: row.sheetsVerified,
    sheetsUnverified: row.sheetsUnverified,
    rowsInserted: row.rowsInserted,
    committed: row.committed,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
    verdictUnverified: row.evidence !== "db-readback",
  }
  if (includeReport) shaped.report = row.report
  return shaped
}

/** Cursor for the last row of a page, or null when there is no next page. */
export function nextBatchReportCursor(
  rows: ReadonlyArray<BatchReportRow>,
  hasMore: boolean,
): string | null {
  if (!hasMore || rows.length === 0) return null
  const last = rows[rows.length - 1]
  return `${last.createdAt.toISOString()}|${last.id}`
}
