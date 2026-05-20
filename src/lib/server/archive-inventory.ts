/**
 * Phase 7.M Step 4.d (2026-05-19) — read + restore helpers for the
 * admin archive UI.
 *
 * Soft-deleted rows live across four tables today (Phase 7.M Step 4):
 *   • budget_lines
 *   • balance_sheet_lines
 *   • cash_flow_entries
 *   • counterparties
 *
 * The admin Archive page summarises archived rows by entity + period
 * + table, exposes "Restore" (clears `deletedAt`) and "Purge"
 * (hard-delete, irreversible). This module concentrates the DB
 * primitives so route handlers stay thin.
 */
import type { PrismaClient } from "@prisma/client"
import { restoreStamp } from "./soft-delete"

export interface ArchiveBucket {
  /** Which table the row lives in. */
  table:
    | "budget_lines"
    | "balance_sheet_lines"
    | "cash_flow_entries"
    | "counterparties"
  /** Company code for filtering (NULL for org-scoped cash_flow_entries). */
  companyCode: string | null
  /** Identifier of the soft-delete batch — the deletedBy stamp. */
  deletedBy: string
  /** Most-recent deletion time in the bucket. */
  deletedAt: string
  /** How many rows are archived in this bucket. */
  rowCount: number
  /** Stable bucket id used by restore/purge endpoints. */
  bucketId: string
}

const TABLES = [
  "budget_lines",
  "balance_sheet_lines",
  "cash_flow_entries",
  "counterparties",
] as const
export type ArchiveTable = (typeof TABLES)[number]

/**
 * Roll up archived rows per (table, companyCode, deletedBy, day-of-
 * deletedAt). One bucket = one logical "archive operation" you can
 * preview, restore, or purge as a unit.
 */
export async function listArchiveBuckets(
  prisma: PrismaClient,
  organizationId: string,
): Promise<ArchiveBucket[]> {
  const buckets: ArchiveBucket[] = []

  // ── budget_lines ────────────────────────────────────────────────
  const bl = await prisma.budgetLine.findMany({
    where: { organizationId, deletedAt: { not: null } },
    select: {
      deletedAt: true,
      deletedBy: true,
      companyId: true,
    },
  })
  const blCodes = await prisma.company.findMany({
    where: {
      organizationId,
      id: { in: bl.map((r) => r.companyId).filter((id): id is string => !!id) },
    },
    select: { id: true, code: true },
  })
  const codeById = new Map(blCodes.map((c) => [c.id, c.code]))
  pushBuckets(buckets, "budget_lines", bl, (r) =>
    r.companyId ? (codeById.get(r.companyId) ?? null) : null,
  )

  // ── balance_sheet_lines (plan-scoped → resolve company via lines) ─
  const bsl = await prisma.balanceSheetLine.findMany({
    where: { organizationId, deletedAt: { not: null } },
    select: { deletedAt: true, deletedBy: true, planId: true },
  })
  // BS is plan-scoped; we tag the bucket with the plan id so the UI
  // can show "plan_2026" rather than guessing a company. (Mapping to
  // company would require an extra join across budget_lines which a
  // soft-deleted plan may not have any more.)
  pushBuckets(buckets, "balance_sheet_lines", bsl, () => null)

  // ── cash_flow_entries (org-scoped) ─────────────────────────────
  const cf = await prisma.cashFlowEntry.findMany({
    where: { organizationId, deletedAt: { not: null } },
    select: { deletedAt: true, deletedBy: true },
  })
  pushBuckets(
    buckets,
    "cash_flow_entries",
    cf.map((r) => ({ ...r, companyId: null })),
    () => null,
  )

  // ── counterparties (per-company) ───────────────────────────────
  const cp = await prisma.counterparty.findMany({
    where: { organizationId, deletedAt: { not: null } },
    select: { deletedAt: true, deletedBy: true, companyId: true },
  })
  const cpCodes = await prisma.company.findMany({
    where: { organizationId, id: { in: cp.map((r) => r.companyId) } },
    select: { id: true, code: true },
  })
  const cpCodeById = new Map(cpCodes.map((c) => [c.id, c.code]))
  pushBuckets(buckets, "counterparties", cp, (r) =>
    cpCodeById.get(r.companyId) ?? null,
  )

  return buckets.sort((a, b) =>
    a.deletedAt > b.deletedAt ? -1 : a.deletedAt < b.deletedAt ? 1 : 0,
  )
}

function pushBuckets<
  T extends { deletedAt: Date | null; deletedBy: string | null; companyId?: string | null },
>(
  out: ArchiveBucket[],
  table: ArchiveTable,
  rows: ReadonlyArray<T>,
  resolveCode: (r: T) => string | null,
): void {
  const map = new Map<
    string,
    {
      companyCode: string | null
      deletedBy: string
      deletedAt: Date
      rowCount: number
    }
  >()
  for (const r of rows) {
    if (!r.deletedAt) continue
    const code = resolveCode(r)
    const by = r.deletedBy ?? "system"
    // Bucket = (table, code, by, day(deletedAt)).
    const day = r.deletedAt.toISOString().slice(0, 10)
    const key = `${table}::${code ?? "-"}::${by}::${day}`
    const cur = map.get(key)
    if (cur) {
      cur.rowCount += 1
      if (r.deletedAt > cur.deletedAt) cur.deletedAt = r.deletedAt
    } else {
      map.set(key, {
        companyCode: code,
        deletedBy: by,
        deletedAt: r.deletedAt,
        rowCount: 1,
      })
    }
  }
  for (const [key, v] of map) {
    out.push({
      table,
      companyCode: v.companyCode,
      deletedBy: v.deletedBy,
      deletedAt: v.deletedAt.toISOString(),
      rowCount: v.rowCount,
      bucketId: key,
    })
  }
}

export interface RestoreInput {
  table: ArchiveTable
  /** ISO timestamp of the bucket — restores rows deleted on that day. */
  deletedAtDay: string
  /** User id that performed the original soft-delete. */
  deletedBy: string
  /** Optional company-code filter. */
  companyCode: string | null
}

/**
 * Clear `deletedAt` + `deletedBy` for every row matching the bucket.
 * Returns the count of restored rows.
 */
export async function restoreBucket(
  prisma: PrismaClient,
  organizationId: string,
  input: RestoreInput,
): Promise<number> {
  const dayStart = new Date(`${input.deletedAtDay}T00:00:00Z`)
  const dayEnd = new Date(`${input.deletedAtDay}T23:59:59.999Z`)
  const stamp = restoreStamp()

  switch (input.table) {
    case "budget_lines": {
      let companyIds: string[] = []
      if (input.companyCode) {
        const c = await prisma.company.findFirst({
          where: { organizationId, code: input.companyCode },
          select: { id: true },
        })
        if (c) companyIds = [c.id]
        else return 0
      }
      const res = await prisma.budgetLine.updateMany({
        where: {
          organizationId,
          deletedAt: { gte: dayStart, lte: dayEnd, not: null },
          deletedBy: input.deletedBy,
          ...(companyIds.length > 0 ? { companyId: { in: companyIds } } : {}),
        },
        data: stamp,
      })
      return res.count
    }
    case "balance_sheet_lines": {
      const res = await prisma.balanceSheetLine.updateMany({
        where: {
          organizationId,
          deletedAt: { gte: dayStart, lte: dayEnd, not: null },
          deletedBy: input.deletedBy,
        },
        data: stamp,
      })
      return res.count
    }
    case "cash_flow_entries": {
      const res = await prisma.cashFlowEntry.updateMany({
        where: {
          organizationId,
          deletedAt: { gte: dayStart, lte: dayEnd, not: null },
          deletedBy: input.deletedBy,
        },
        data: stamp,
      })
      return res.count
    }
    case "counterparties": {
      let companyIds: string[] = []
      if (input.companyCode) {
        const c = await prisma.company.findFirst({
          where: { organizationId, code: input.companyCode },
          select: { id: true },
        })
        if (c) companyIds = [c.id]
        else return 0
      }
      const res = await prisma.counterparty.updateMany({
        where: {
          organizationId,
          deletedAt: { gte: dayStart, lte: dayEnd, not: null },
          deletedBy: input.deletedBy,
          ...(companyIds.length > 0 ? { companyId: { in: companyIds } } : {}),
        },
        data: stamp,
      })
      return res.count
    }
  }
}
