/** Shared response shapes for the Delete data screen. */

export interface CompanyRow {
  id: string
  code: string
  name: string
  level: number
  parentCompanyId: string | null
}

export interface PreviewCompany {
  companyCode: string
  companyId: string
  breakdown: Record<string, number>
  rowsAffected: number
}

export interface Preview {
  year?: number
  years: number[]
  companies: PreviewCompany[]
  breakdown: Record<string, number>
  rowsAffected: number
  orphanBudgetLine: number
  isWholeHolding: boolean
  yearIndex?: Array<{ year: number; rows: number }>
}

export interface PeriodLockInfo {
  period: string
  lockedAt: string
  lockedBy: string
  reason?: string
}

/** Everything the run can end as. `RunResult` renders exactly one of these. */
export type RunOutcome =
  | {
      kind: "done"
      rowsAffected: number
      breakdown: Record<string, number>
      recomputed: number
      companiesDeleted: string[]
    }
  | {
      kind: "partial"
      rowsAffected: number
      breakdown: Record<string, number>
      companiesDeleted: string[]
      companiesFailed: string[]
      orphanTailRemains: boolean
    }
  | { kind: "drift"; expected: number; actual: number; preview: Preview }
  | { kind: "locked"; period: string; reason?: string }
  | { kind: "rateLimited"; retryAfterSeconds: number }
  | { kind: "failed"; message: string }

export interface AuditRow {
  id: string
  action: string
  entityType: string
  entityId: string | null
  createdAt: string
  actor: string | null
  companyCode?: string
  year?: number
  years?: number[]
  rowsAffected?: number
  reason?: string
  breakdown?: Record<string, number>
  /**
   * The exact `deletedAt` this deletion stamped, ISO-8601 — the key that lets
   * a restore bring back THIS deletion and not every archived generation of
   * the same company-year. Absent on events recorded before 2026-07-31, and
   * those cannot be restored from the page at all (see ARCHIVE_GENERATION_KEY
   * in `src/lib/server/archive.ts`).
   */
  archivedAt?: string
}
