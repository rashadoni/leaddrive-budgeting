/**
 * Phase 7.M Step 4 (2026-05-18) — archive & restore helpers.
 *
 * Single chokepoint for self-service archive operations. Every archive
 * action goes through `archiveRows()` so the soft-delete stamp and the
 * audit_event row are written in the same Prisma transaction — partial
 * application is impossible.
 *
 * Why a transaction
 * ─────────────────
 * If the `updateMany` succeeds but the audit `create` throws, the data
 * is archived but the IFRS-required trail is missing. If the audit
 * write succeeds but the `updateMany` is rolled back, the audit lies.
 * Both halves are wrapped in `prisma.$transaction` so the database
 * enforces all-or-nothing.
 *
 * What's intentionally NOT here
 * ─────────────────────────────
 *  • The UI / API route lives in `src/app/api/admin/archive/route.ts`
 *    (Phase 7.M Step 4d). This module is the pure execution layer.
 *  • Permissions checks belong to the route (it has the session); this
 *    helper just trusts the userId it's given.
 *  • Hard delete (physical row removal) is the cleanup job's concern
 *    — not exposed here so a finance user can't accidentally bypass
 *    the 90-day retention.
 */

import type { PrismaClient } from "@prisma/client"
import { logAuditEvent } from "@/lib/audit/log"
import { archiveStamp, restoreStamp } from "./soft-delete"

export type ArchiveEntityKind =
  | "BudgetLine"
  | "BalanceSheetLine"
  | "CashFlowEntry"
  | "Counterparty"

export interface ArchiveScope {
  /** Tenant — required, defense-in-depth at the SQL level. */
  organizationId: string
  /** Which table to operate on. */
  entityKind: ArchiveEntityKind
  /** Limit to a single company. Required for BudgetLine and
   *  Counterparty (they have companyId). OPTIONAL but honoured for
   *  BalanceSheetLine (scopes by its `companyId` column) and
   *  CashFlowEntry (scopes by the `<companyCode>::…` sourceId prefix).
   *  Omit it on BS/CF for a deliberate org-wide-per-year archive. */
  companyCode?: string
  /** Limit to a specific calendar year. Required for BudgetLine via
   *  plan.year filter, and for BalanceSheetLine / CashFlowEntry which
   *  have a `year` column. Ignored for Counterparty (uses `period`). */
  year?: number
  /** Limit to a specific period label (e.g. "2026" or "2026-Q1").
   *  Only meaningful for Counterparty rows where the year doesn't apply. */
  period?: string
}

export interface ArchiveActionArgs {
  prisma: PrismaClient
  /** The Session.userId of the operator. Pass "system" for cron / CLI. */
  actorUserId: string
  /** Free-text reason — surfaced in the audit log for the 7-year trail. */
  reason?: string
  /** What to archive. */
  scope: ArchiveScope
}

export interface ArchiveResult {
  rowsAffected: number
  auditEventId: string | null
}

/**
 * Build a Prisma `where` filter for the requested scope. Returns
 * `null` when the scope is too narrow / structurally impossible (e.g.
 * BudgetLine without a companyCode AND year — we refuse to archive
 * the whole tenant in a single transaction).
 */
async function buildScopeWhere(
  prisma: PrismaClient,
  scope: ArchiveScope,
): Promise<Record<string, unknown> | null> {
  const base: Record<string, unknown> = {
    organizationId: scope.organizationId,
    deletedAt: null,
  }

  if (scope.entityKind === "BudgetLine") {
    if (!scope.companyCode || !scope.year) return null
    const company = await prisma.company.findFirst({
      where: { organizationId: scope.organizationId, code: scope.companyCode },
      select: { id: true },
    })
    if (!company) return null
    base.companyId = company.id
    base.plan = { year: scope.year }
    return base
  }

  if (scope.entityKind === "BalanceSheetLine") {
    if (!scope.year) return null
    base.year = scope.year
    // Phase 3 fix (2026-06-20): balance_sheet_lines HAS a `companyId`
    // column, so scope to the single company when one is given.
    // Previously this returned org+year only — archiving one company's
    // BS would silently wipe EVERY company's BS for that year. With no
    // companyCode the scope stays org-wide-per-year (the "ALL" path the
    // confirmCode="ALL" gate guards).
    if (scope.companyCode) {
      const company = await prisma.company.findFirst({
        where: { organizationId: scope.organizationId, code: scope.companyCode },
        select: { id: true },
      })
      if (!company) return null
      base.companyId = company.id
    }
    return base
  }

  if (scope.entityKind === "CashFlowEntry") {
    if (!scope.year) return null
    base.year = scope.year
    // Phase 3 fix (2026-06-20): cash_flow_entries has no companyId
    // column, but every row's `sourceId` is prefixed `<companyCode>::…`
    // (verified 2424/2424 live rows). Scope by that prefix when a
    // company is given — the "::" delimiter prevents prefix collisions
    // (e.g. "AZSEKER::" never matches "AZSEKER-AZSF::"). Previously this
    // returned org+year only — same all-companies wipe risk as BS above.
    // No companyCode → org-wide-per-year ("ALL" path).
    if (scope.companyCode) {
      const company = await prisma.company.findFirst({
        where: { organizationId: scope.organizationId, code: scope.companyCode },
        select: { id: true },
      })
      if (!company) return null
      base.sourceId = { startsWith: `${scope.companyCode}::` }
    }
    return base
  }

  if (scope.entityKind === "Counterparty") {
    if (!scope.companyCode) return null
    const company = await prisma.company.findFirst({
      where: { organizationId: scope.organizationId, code: scope.companyCode },
      select: { id: true },
    })
    if (!company) return null
    base.companyId = company.id
    if (scope.period) base.period = scope.period
    return base
  }

  return null
}

/**
 * Soft-archive every row matching the scope. Writes one audit event
 * with `metadata.rowsAffected`. Idempotent in the sense that running
 * twice has no effect on the second call (where clause excludes
 * already-archived rows).
 */
export async function archiveRows(
  args: ArchiveActionArgs,
): Promise<ArchiveResult> {
  const { prisma, actorUserId, reason, scope } = args
  const where = await buildScopeWhere(prisma, scope)
  if (!where) {
    throw new Error(
      `archiveRows: invalid scope for ${scope.entityKind} (need companyCode + year for BudgetLine; year for BalanceSheetLine/CashFlowEntry; companyCode for Counterparty)`,
    )
  }
  const stamp = archiveStamp(actorUserId)
  const entityId = `${scope.companyCode ?? "ALL"}:${scope.year ?? scope.period ?? "ALL"}`

  return prisma.$transaction(async (tx) => {
    let rowsAffected = 0
    switch (scope.entityKind) {
      case "BudgetLine": {
        const r = await tx.budgetLine.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "BalanceSheetLine": {
        const r = await tx.balanceSheetLine.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "CashFlowEntry": {
        const r = await tx.cashFlowEntry.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "Counterparty": {
        const r = await tx.counterparty.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
    }

    const audit = await logAuditEvent(tx as PrismaClient, {
      organizationId: scope.organizationId,
      actorUserId,
      event: {
        action: "data_archive",
        entityType: scope.entityKind,
        entityId,
        metadata: {
          entityKind: scope.entityKind,
          companyCode: scope.companyCode,
          year: scope.year,
          period: scope.period,
          rowsAffected,
          reason,
        },
      },
    })

    return {
      rowsAffected,
      auditEventId: audit.ok ? audit.id : null,
    }
  })
}

/**
 * Reverse of `archiveRows` — clears deletedAt/deletedBy on rows
 * matching the scope AND the original `deletedBy` (so a finance user
 * can only restore what THEY archived, unless an admin uses the
 * org-wide restore in the admin UI).
 */
export async function restoreRows(
  args: ArchiveActionArgs & { matchDeletedBy?: string },
): Promise<ArchiveResult> {
  const { prisma, actorUserId, reason, scope } = args
  // Build the same scope but invert the soft-delete filter — we want
  // rows that ARE archived to be restored.
  const where = await buildScopeWhere(prisma, scope)
  if (!where) {
    throw new Error(`restoreRows: invalid scope for ${scope.entityKind}`)
  }
  // Override the deletedAt: null filter — we want only archived rows.
  delete (where as Record<string, unknown>).deletedAt
  ;(where as Record<string, unknown>).deletedAt = { not: null }
  if (args.matchDeletedBy) {
    ;(where as Record<string, unknown>).deletedBy = args.matchDeletedBy
  }
  const stamp = restoreStamp()
  const entityId = `${scope.companyCode ?? "ALL"}:${scope.year ?? scope.period ?? "ALL"}`

  return prisma.$transaction(async (tx) => {
    let rowsAffected = 0
    switch (scope.entityKind) {
      case "BudgetLine": {
        const r = await tx.budgetLine.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "BalanceSheetLine": {
        const r = await tx.balanceSheetLine.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "CashFlowEntry": {
        const r = await tx.cashFlowEntry.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
      case "Counterparty": {
        const r = await tx.counterparty.updateMany({
          where: where as never,
          data: stamp,
        })
        rowsAffected = r.count
        break
      }
    }

    const audit = await logAuditEvent(tx as PrismaClient, {
      organizationId: scope.organizationId,
      actorUserId,
      event: {
        action: "data_restore",
        entityType: scope.entityKind,
        entityId,
        metadata: {
          entityKind: scope.entityKind,
          companyCode: scope.companyCode,
          year: scope.year,
          period: scope.period,
          rowsAffected,
          reason,
        },
      },
    })

    return {
      rowsAffected,
      auditEventId: audit.ok ? audit.id : null,
    }
  })
}
