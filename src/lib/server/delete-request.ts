/**
 * Phase 11.76 (2026-07-31) — one parser for the delete-data request body.
 *
 * The preview endpoint and the commit endpoint MUST read the scope out of the
 * request in exactly the same way, or the number the operator confirms is not
 * the number that gets deleted. They used to parse it twice, in two files,
 * with two different company-code ceilings.
 *
 * Every field is optional and every default reproduces the pre-11.76
 * behaviour, so a client that sends only `{ companyCodes, year }` gets what it
 * always got.
 */

// Imported from the dependency-free vocabulary module, NOT from `archive.ts`:
// this parser runs in route handlers whose tests mock the whole archive
// module, and a parser that breaks under a mock is a parser nobody tests.
import {
  IMPORT_RESET_CATEGORIES,
  type ImportResetSelection,
} from "./import-reset-categories"

/**
 * Ceiling on companies per request. Was 200, which silently truncated a
 * "delete everything" on a holding with more entities than that — and a
 * truncated list also fails the `isWholeHolding` test, so the org-level sweeps
 * never fired and the operator was told the group was empty when it was not.
 */
export const MAX_COMPANY_CODES = 1000

export function parseCompanyCodes(body: {
  companyCode?: unknown
  companyCodes?: unknown
}): string[] {
  if (Array.isArray(body.companyCodes)) {
    return [
      ...new Set(
        body.companyCodes.filter(
          (c): c is string => typeof c === "string" && c.length > 0,
        ),
      ),
    ].slice(0, MAX_COMPANY_CODES)
  }
  return typeof body.companyCode === "string" && body.companyCode.length > 0
    ? [body.companyCode]
    : []
}

/**
 * The literal an operator types when the scope is wider than one named
 * company. Exported so nobody re-types the string.
 */
export const WIDEST_CONFIRM_TOKEN = "ALL"

/** The company half of a delete request body — exactly two legal shapes. */
export interface CompanyTarget {
  companyCode?: string
  companyCodes?: string[]
}

/**
 * Phase 11.77 (2026-07-31) — the ONE place that decides the request's company
 * shape, and the ONE place that decides the token that shape demands.
 *
 * They used to be decided twice: `payload.ts` sent a lone company as
 * `companyCode`, `tier.ts` asked the operator for "ALL", and the route
 * computed the expected token off the body — so "Remove one company" 400'd on
 * every attempt with `confirmCode must equal "ACME"`. Two deciders, one
 * contract, guaranteed drift.
 *
 * Now the client builds its body with `companyTarget()` and asks
 * `expectedConfirmCode()` — the same function the route validates with — what
 * that body will be checked against. Drift is not "unlikely"; there is no
 * second implementation left to drift from.
 */
export function companyTarget(codes: readonly string[]): CompanyTarget {
  const clean = [...new Set(codes.filter((c) => typeof c === "string" && c.length > 0))]
  return clean.length === 1 ? { companyCode: clean[0] } : { companyCodes: clean }
}

/**
 * What `confirmCode` must equal for this body. Mirrors — and is now the sole
 * implementation of — the route's safety gate: a bulk payload ALWAYS demands
 * the widest token, because a mixed
 * `{companyCode:"SAFE", companyCodes:["A","B"], confirmCode:"SAFE"}` would
 * otherwise wipe A and B on a confirmation that named neither.
 */
export function expectedConfirmCode(body: {
  companyCode?: unknown
  companyCodes?: unknown
}): string {
  const codes = Array.isArray(body.companyCodes)
    ? parseCompanyCodes({ companyCodes: body.companyCodes })
    : []
  if (codes.length > 0) return WIDEST_CONFIRM_TOKEN
  return typeof body.companyCode === "string" && body.companyCode.length > 0
    ? body.companyCode
    : WIDEST_CONFIRM_TOKEN
}

export function parseYears(body: { year?: unknown; years?: unknown }): {
  year?: number
  years?: number[]
} {
  const years = Array.isArray(body.years)
    ? [
        ...new Set(
          body.years.filter(
            (y): y is number => typeof y === "number" && Number.isInteger(y),
          ),
        ),
      ].sort((a, b) => a - b)
    : []
  const year =
    typeof body.year === "number" && Number.isInteger(body.year) ? body.year : undefined
  return years.length > 0 ? { years, year: years.length === 1 ? years[0] : undefined } : { year }
}

/**
 * Categories + the two provenance switches. An unknown category name is
 * dropped rather than rejected: a stale client must never be able to delete
 * MORE than the names it sent.
 */
export function parseDeleteSelection(body: {
  year?: unknown
  years?: unknown
  include?: unknown
  includeUnscoped?: unknown
  includeManualActuals?: unknown
}): ImportResetSelection & { year?: number } {
  const known = new Set<string>(IMPORT_RESET_CATEGORIES)
  const include = Array.isArray(body.include)
    ? body.include.filter((c): c is string => typeof c === "string" && known.has(c))
    : undefined
  return {
    ...parseYears(body),
    ...(include && include.length > 0 ? { include } : {}),
    ...(typeof body.includeUnscoped === "boolean"
      ? { includeUnscoped: body.includeUnscoped }
      : {}),
    ...(body.includeManualActuals === true ? { includeManualActuals: true } : {}),
  }
}

/**
 * Every year the request covers, for the period-lock gate. An empty list means
 * "all years", which the caller must treat as covering every locked period.
 */
export function selectedYears(selection: { year?: number; years?: number[] }): number[] {
  if (selection.years && selection.years.length > 0) return selection.years
  return selection.year ? [selection.year] : []
}

/**
 * Phase 11.78 (2026-07-31) — the ONE line that decides whether a delete can
 * ever be undone from the Delete data screen.
 *
 * Every audit event a delete writes carries `metadata.year`, and it carries it
 * ONLY when exactly one year was named — a two-year or an all-years delete
 * records `years: [...]` and leaves `year` undefined. The restore list filters
 * on `year != null` (RestoreTask), because the restore endpoint is scoped by
 * one company and one year and has no other way to reconstruct the operation.
 *
 * So "you can bring this back from this page" is not a property of a table, or
 * of a soft-delete column: it is a property of THIS request's year list. The
 * rows of a multi-year delete are soft-archived exactly like the rows of a
 * single-year one, and an engineer can clear their `deletedAt` — but the
 * operator, on this page, cannot. The screen used to promise otherwise on
 * every multi-year delete and on 100 % of Tasks B and D, which are all-years
 * by construction.
 *
 * `archive.ts` writes the metadata through `auditYearFor`, and the UI asks
 * `producesRestorableEvent` what to say. One rule, two readers.
 */
export function auditYearFor(years: readonly number[]): number | undefined {
  return years.length === 1 ? years[0] : undefined
}

/**
 * True when the delete over `years` will show up in the restore list — i.e.
 * when the operator, and not only technical support, can reverse it.
 */
export function producesRestorableEvent(years: readonly number[]): boolean {
  return auditYearFor(years) !== undefined
}
