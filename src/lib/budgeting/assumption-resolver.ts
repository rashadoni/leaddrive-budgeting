/**
 * Phase 7.Q (2026-08-06) — resolving a budget driver for one company.
 *
 * `BudgetAssumption` rows live in two tiers (see the migration
 * `20260806120000_assumption_company_scope`):
 *
 *   companyId IS NULL  — the plan-level DEFAULT, applies to every company
 *   companyId = X      — X's OVERRIDE, wins over the default for the same key
 *
 * This module is the ONLY place that precedence may be expressed. Two tiers
 * is exactly the kind of rule that gets re-implemented slightly differently at
 * the third call site, and then a scenario and the tab that documents it
 * disagree about what the holding assumed — which is the failure this whole
 * feature exists to prevent.
 *
 * Pure by design: it takes rows, not a Prisma client. Every consumer already
 * has the rows in hand (the tab fetches them, the scenario engine loads them
 * once per plan), and purity is what lets the precedence be tested on a box
 * with no database.
 *
 * ── On duplicates ───────────────────────────────────────────────────────
 * There is no UNIQUE constraint on (planId, key, companyId) — the table
 * predates this feature and live data may already hold repeated keys, so the
 * migration does not risk a failing index build. That makes duplicates a real
 * input here, not a "can't happen". The resolver is therefore TOTAL: it always
 * picks one row by a deterministic order (lowest sortOrder → oldest createdAt →
 * lowest id) and reports `ambiguous: true` so the caller can surface the
 * collision instead of silently trusting a coin flip.
 *
 * Deterministic tie-breaking matters more than which row wins: an unstable
 * choice would make the same scenario produce different numbers on different
 * runs, and nobody would be able to reproduce a board figure.
 */

/**
 * The subset of `BudgetAssumption` this module needs. Declared structurally
 * rather than importing Prisma's generated type so callers may pass rows that
 * came from an API response (Dates arrive as strings over JSON) as easily as
 * rows straight from the database.
 */
export interface AssumptionRowLike {
  id: string
  key: string
  value: number
  unit?: string | null
  companyId?: string | null
  sortOrder?: number | null
  createdAt?: Date | string | null
}

export interface ResolvedAssumption<Row extends AssumptionRowLike = AssumptionRowLike> {
  key: string
  value: number
  unit: string | null
  /** Which tier supplied the value — `"company"` beats `"plan"`. */
  tier: "company" | "plan"
  /** The winning row, so a caller can cite the source rather than the number alone. */
  source: Row
  /**
   * True when more than one row competed AT THE WINNING TIER. A company
   * override shadowing a plan default is normal layering and is NOT ambiguous;
   * two plan defaults for the same key is a data problem worth showing.
   */
  ambiguous: boolean
}

/** Milliseconds since epoch, or `null` for a missing/unparseable timestamp. */
function createdAtMs(row: AssumptionRowLike): number | null {
  const raw = row.createdAt
  if (raw == null) return null
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(raw)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Total order over rows within one tier: lowest sortOrder first, then oldest,
 * then lowest id. Every field falls back to a defined value so the comparator
 * never returns NaN — a NaN comparator makes `Array.prototype.sort` implementation-
 * defined, which is the non-reproducibility this is here to avoid.
 *
 * Rows with no `createdAt` sort AFTER rows that have one: an unsaved draft
 * should not outrank a persisted default.
 */
function compareWithinTier(a: AssumptionRowLike, b: AssumptionRowLike): number {
  const sortA = a.sortOrder ?? 0
  const sortB = b.sortOrder ?? 0
  if (sortA !== sortB) return sortA - sortB

  const timeA = createdAtMs(a)
  const timeB = createdAtMs(b)
  if (timeA !== timeB) {
    if (timeA === null) return 1
    if (timeB === null) return -1
    return timeA - timeB
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Resolve one driver for one company.
 *
 * `companyId === null` asks for the plan-level default explicitly — used by the
 * tab when showing what the holding assumes before any company is selected.
 *
 * Returns `null` when the key is absent entirely. Callers MUST treat that as
 * "the holding has not stated this assumption" and say so, rather than
 * substituting a constant — a silent fallback is how `assumedImportShare: 0.3`
 * came to stand in for sixty different businesses.
 */
export function resolveAssumption<Row extends AssumptionRowLike>(
  rows: readonly Row[],
  key: string,
  companyId: string | null,
): ResolvedAssumption<Row> | null {
  const forKey = rows.filter((r) => r.key === key)
  if (forKey.length === 0) return null

  // A null companyId on the QUERY means "give me the default", so it must not
  // match rows belonging to some company. Only a non-null query id can select
  // the override tier.
  const overrides = companyId === null ? [] : forKey.filter((r) => r.companyId === companyId)
  const defaults = forKey.filter((r) => r.companyId == null)

  const tier: "company" | "plan" = overrides.length > 0 ? "company" : "plan"
  const candidates = overrides.length > 0 ? overrides : defaults
  if (candidates.length === 0) return null

  const winner = [...candidates].sort(compareWithinTier)[0]
  return {
    key,
    value: winner.value,
    unit: winner.unit ?? null,
    tier,
    source: winner,
    ambiguous: candidates.length > 1,
  }
}

/**
 * Resolve every distinct key at once, keyed by `key`.
 *
 * Prefer this over calling `resolveAssumption` in a loop when a consumer needs
 * the whole driver set for a company — the scenario engine reads a dozen keys
 * per company across ~60 companies, and the per-key filter is O(rows) each
 * time.
 */
export function resolveAssumptions<Row extends AssumptionRowLike>(
  rows: readonly Row[],
  companyId: string | null,
): Map<string, ResolvedAssumption<Row>> {
  const byKey = new Map<string, Row[]>()
  for (const row of rows) {
    const bucket = byKey.get(row.key)
    if (bucket) bucket.push(row)
    else byKey.set(row.key, [row])
  }

  const out = new Map<string, ResolvedAssumption<Row>>()
  for (const [key, bucket] of byKey) {
    const resolved = resolveAssumption(bucket, key, companyId)
    if (resolved) out.set(key, resolved)
  }
  return out
}

/**
 * Numeric read for a caller that only wants the value — e.g. a formula that
 * needs `import_share` and has nowhere sensible to show provenance.
 *
 * Returns `null`, never a default, for the same reason `resolveAssumption`
 * does. A caller that genuinely has a fallback should write it at the call
 * site where the fallback can be named and disclosed.
 */
export function assumptionValue(
  rows: readonly AssumptionRowLike[],
  key: string,
  companyId: string | null,
): number | null {
  return resolveAssumption(rows, key, companyId)?.value ?? null
}

/**
 * Every key that resolved to more than one row at its winning tier, for the
 * given company. The tab renders these as a warning; ignoring the return value
 * is a legitimate choice for a consumer that only needs numbers.
 */
export function ambiguousKeys(
  rows: readonly AssumptionRowLike[],
  companyId: string | null,
): string[] {
  const out: string[] = []
  for (const [key, resolved] of resolveAssumptions(rows, companyId)) {
    if (resolved.ambiguous) out.push(key)
  }
  return out.sort()
}
