/**
 * Phase 7.G Turn LXXXXV (Phase 7.E #1 D.5b) — commodity data abstraction.
 *
 * Per LXXXV vendor pick #3: free-tier commodity data sources only (TCMB
 * FX + WorldBank CPI + commodities RSS). Avoid paid Bloomberg / Refinitiv
 * tier — adds $500-2000/mo cost without proportional CFO value for v1.
 *
 * **Why an abstraction:** caller (intel scheduler hook + admin manual
 * trigger) doesn't care which source produced a series. The adapter
 * normalizes to `CommodityDataPoint[]` and the persistence layer handles
 * the Prisma `IntelDataPoint` upsert + in-memory fallback uniformly.
 *
 * **Schema target (post-migrate):** `IntelDataPoint` Prisma model
 * (added LXXXXI). Keyed by `(organizationId, sourceCode, metric, datetime)`
 * unique constraint — adapters MUST set sourceCode that uniquely identifies
 * the adapter for de-dup correctness.
 *
 * **Fallback (pre-migrate):** in-memory Map keyed by the same composite key.
 * Loses on restart but the next scheduler tick re-fetches from the upstream
 * API + re-populates. Acceptable since adapters are idempotent.
 */

/** A normalized data point from a commodity / macro / FX source. */
export interface CommodityDataPoint {
  /** Source-stable identifier for the adapter. e.g. "tcmb-fx-rates",
   *  "worldbank-cpi", "commodities-rss-brent". MUST match across runs. */
  sourceCode: string
  /** Metric identifier within the source. e.g. "USD_AZN", "AZ_CPI_YOY",
   *  "BRENT_USD_BBL". Adapter-defined; consumers (variance explainer)
   *  reference these by literal string. */
  metric: string
  /** Observation datetime. For daily series use UTC midnight; for monthly
   *  use 1st-of-month UTC; for arbitrary use the source's exact timestamp. */
  datetime: Date
  /** Numeric value in the unit declared in `unit`. Must be a finite number
   *  (NaN/Infinity drop the row in ingest). */
  value: number
  /** Display unit. e.g. "AZN/USD", "%", "USD/bbl". Optional — caller
   *  may infer from metric naming convention. */
  unit?: string
  /** Pristine source response for forensics + future re-parsing without
   *  re-fetching. Optional (RSS adapters often pass null). */
  raw?: Record<string, unknown> | null
}

/** Result envelope from one adapter run — same shape across all 3 sources
 *  so caller can aggregate them uniformly. */
export interface CommodityFetchResult {
  /** Adapter identifier (matches `sourceCode` of all returned data points). */
  source: string
  /** Successfully parsed data points — pre-dedup, pre-write. */
  dataPoints: CommodityDataPoint[]
  /** Per-step errors (network, JSON parse, schema mismatch). Empty on clean run. */
  errors: string[]
  /** Did the adapter run hit the upstream API or short-circuit (no-op)? */
  fetched: boolean
}

/** Adapter contract — every commodity source implements this. Pure
 *  function from `(now)` → fetched data points. The adapter is responsible
 *  for: HTTP call, response parsing, schema validation, normalization.
 *  It is NOT responsible for: persistence (caller handles upsert),
 *  scheduling (scheduler decides cadence), org-scoping (caller fans out). */
export interface CommodityAdapter {
  /** Stable source identifier. Same value populates `sourceCode` on every
   *  data point this adapter emits. */
  readonly source: string
  /** Human-readable label for admin UI. e.g. "TCMB FX Rates (Türkiye)". */
  readonly label: string
  /** Run one fetch + parse cycle. `now` is the adapter's reference time
   *  for "what's the latest" queries (pass a fake date in tests). */
  fetch(now?: Date): Promise<CommodityFetchResult>
}

/** What an adapter expects in its options bag — kept minimal so
 *  factory + tests can swap implementations cleanly. */
export interface CommodityAdapterOptions {
  /** Override fetch (Node 18+ global). Tests inject a mock. */
  fetchImpl?: typeof fetch
}
