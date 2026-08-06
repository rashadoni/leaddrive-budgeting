/**
 * Phase 7.Q (2026-08-06) — whitelist + normalize a client-supplied assumption.
 *
 * The POST handler used to write `{ ...body, organizationId: orgId }` straight
 * into `create`. That was survivable while the model held only scalars owned by
 * the row itself. It stops being survivable the moment `companyId` exists,
 * because a spread lets a caller name ANY company id — including one belonging
 * to another tenant — and the FK would happily accept it. That is the same
 * shape of bug as d0c997ef ("a filter could name another tenant"), one level
 * deeper: not a filter naming a foreign company, but a stored row pointing at
 * one.
 *
 * The spread also let a caller set `id`, `organizationId`, `createdAt` and
 * `updatedAt` — overwriting the tenant column outright, or back-dating a row so
 * the resolver's oldest-wins tie-break could be gamed.
 *
 * So: an explicit allow-list, and `companyId` is returned for the CALLER to
 * verify against the org in the same transaction. This module cannot do that
 * check itself without a database, and it is deliberately pure so the parsing
 * rules can be tested on a box with no Postgres.
 */

/** Fields a client may write. Anything else in the body is dropped silently. */
export interface AssumptionInput {
  category: string
  key: string
  label: string
  value: number
  unit: string | null
  period: string | null
  notes: string | null
  sortOrder: number
  companyId: string | null
}

export type AssumptionParseResult =
  | { ok: true; value: AssumptionInput }
  | { ok: false; error: string }

/** Same shape, every field optional — a PATCH may touch one column. */
export type AssumptionPatch = Partial<AssumptionInput>

export type AssumptionPatchResult =
  | { ok: true; value: AssumptionPatch }
  | { ok: false; error: string }

/**
 * `period` describes how the driver is expressed, not a fiscal period. Kept as
 * a closed set so the tab can render a unit-aware label and a formula consumer
 * can annualize without guessing.
 */
export const ASSUMPTION_PERIODS = ["monthly", "quarterly", "annual", "per_unit"] as const

const MAX_TEXT = 200
const MAX_NOTES = 2000

function trimmedString(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const t = raw.trim()
  return t.length === 0 ? null : t
}

/**
 * Numbers arrive from a form as strings often enough that rejecting them would
 * just push the same `Number(...)` into the UI layer. Non-finite values are
 * refused outright: an Infinity or NaN driver silently poisons every figure
 * derived from it, and a stored NaN cannot be spotted by reading the tab.
 */
function finiteNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "string") {
    const t = raw.trim()
    if (t.length === 0) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Parse a create payload. `planId` is NOT returned — the route already resolved
 * and org-verified the plan before reaching here, and echoing the client's copy
 * back into the write would reintroduce the thing this module removes.
 */
export function parseAssumptionInput(body: unknown): AssumptionParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Body must be an object" }
  }
  const b = body as Record<string, unknown>

  const key = trimmedString(b.key)
  if (!key) return { ok: false, error: "key is required" }
  if (key.length > MAX_TEXT) return { ok: false, error: `key exceeds ${MAX_TEXT} characters` }

  const label = trimmedString(b.label) ?? key
  if (label.length > MAX_TEXT) return { ok: false, error: `label exceeds ${MAX_TEXT} characters` }

  const category = trimmedString(b.category) ?? "other"
  if (category.length > MAX_TEXT) {
    return { ok: false, error: `category exceeds ${MAX_TEXT} characters` }
  }

  // A driver with no number is not a driver. `value` defaults to 0 in the
  // schema, but defaulting HERE would turn a typo'd "0.o7" into a silent zero —
  // the exact class of error this tab exists to make visible.
  const value = finiteNumber(b.value)
  if (value === null) return { ok: false, error: "value must be a finite number" }

  const period = trimmedString(b.period)
  if (period && !(ASSUMPTION_PERIODS as readonly string[]).includes(period)) {
    return { ok: false, error: `period must be one of: ${ASSUMPTION_PERIODS.join(", ")}` }
  }

  const notes = trimmedString(b.notes)
  if (notes && notes.length > MAX_NOTES) {
    return { ok: false, error: `notes exceeds ${MAX_NOTES} characters` }
  }

  const unit = trimmedString(b.unit)
  if (unit && unit.length > MAX_TEXT) {
    return { ok: false, error: `unit exceeds ${MAX_TEXT} characters` }
  }

  const sortOrderRaw = b.sortOrder === undefined || b.sortOrder === null ? 0 : finiteNumber(b.sortOrder)
  if (sortOrderRaw === null) return { ok: false, error: "sortOrder must be a finite number" }

  return {
    ok: true,
    value: {
      category,
      key,
      label,
      value,
      unit,
      period,
      notes,
      sortOrder: Math.trunc(sortOrderRaw),
      companyId: trimmedString(b.companyId),
    },
  }
}

/**
 * Parse a partial update. Distinguishes "absent" (leave alone) from "null"
 * (clear it) — `companyId: null` is how the UI promotes a company override back
 * to a plan-level default, so it must be a real, expressible edit rather than
 * an omission.
 */
export function parseAssumptionPatch(body: unknown): AssumptionPatchResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Body must be an object" }
  }
  const b = body as Record<string, unknown>
  const patch: AssumptionPatch = {}

  if ("key" in b) {
    const key = trimmedString(b.key)
    if (!key) return { ok: false, error: "key cannot be empty" }
    if (key.length > MAX_TEXT) return { ok: false, error: `key exceeds ${MAX_TEXT} characters` }
    patch.key = key
  }
  if ("label" in b) {
    const label = trimmedString(b.label)
    if (!label) return { ok: false, error: "label cannot be empty" }
    if (label.length > MAX_TEXT) return { ok: false, error: `label exceeds ${MAX_TEXT} characters` }
    patch.label = label
  }
  if ("category" in b) {
    const category = trimmedString(b.category)
    if (!category) return { ok: false, error: "category cannot be empty" }
    patch.category = category
  }
  if ("value" in b) {
    const value = finiteNumber(b.value)
    if (value === null) return { ok: false, error: "value must be a finite number" }
    patch.value = value
  }
  if ("unit" in b) patch.unit = trimmedString(b.unit)
  if ("notes" in b) {
    const notes = trimmedString(b.notes)
    if (notes && notes.length > MAX_NOTES) {
      return { ok: false, error: `notes exceeds ${MAX_NOTES} characters` }
    }
    patch.notes = notes
  }
  if ("period" in b) {
    const period = trimmedString(b.period)
    if (period && !(ASSUMPTION_PERIODS as readonly string[]).includes(period)) {
      return { ok: false, error: `period must be one of: ${ASSUMPTION_PERIODS.join(", ")}` }
    }
    patch.period = period
  }
  if ("sortOrder" in b) {
    const sortOrder = finiteNumber(b.sortOrder)
    if (sortOrder === null) return { ok: false, error: "sortOrder must be a finite number" }
    patch.sortOrder = Math.trunc(sortOrder)
  }
  if ("companyId" in b) patch.companyId = trimmedString(b.companyId)

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No writable fields in body" }
  }
  return { ok: true, value: patch }
}

/**
 * Every distinct company id a batch wants to reference, for a single
 * `findMany({ id: { in } })` org check rather than one query per row.
 */
export function referencedCompanyIds(inputs: readonly { companyId: string | null }[]): string[] {
  const ids = new Set<string>()
  for (const i of inputs) if (i.companyId) ids.add(i.companyId)
  return [...ids]
}
