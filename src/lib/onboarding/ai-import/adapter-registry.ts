/**
 * Phase 7.M Tier 4 (2026-05-19) — AI Import: Adapter registry.
 *
 * Maps a sheet classification (PLF / BS / CF / KPI / CAPEX / Land / Sales /
 * Descriptions) to the right parser adapter. The orchestrator iterates
 * classifications and dispatches to the matching adapter — the registry
 * is the seam where "new file shape" → "wire up an adapter" plugs in.
 *
 * Each adapter handler returns a uniform `AdapterRunResult`:
 *   • `summary` — short metric for logs / UI ("17 land parcels, 22,595 ha")
 *   • `expectedSums` — Map<reconcileKey, number> for Phase 7.M-style
 *     bit-perfect reconciliation
 *   • `applyToDb` — async fn that mutates DB inside a Prisma transaction
 *     (gated by the orchestrator on reconciliation verdict)
 *   • `warnings` — non-fatal issues
 *
 * Pure structural: nothing here writes to DB or hits LLM. All side-effects
 * happen inside the adapter's `applyToDb` (called only if reconciliation
 * is green).
 */
import type { Prisma, PrismaClient } from "@prisma/client"
import type * as XLSXType from "xlsx"
import type { AccountType } from "../ai-mapper/types"
import type { ReconciliationReport } from "../reconciliation"
import type { SheetDataType } from "./sheet-classifier"

export interface SemanticCoaDecision {
  sourceLabel: string
  targetCode: string | null
  confidence: number
  action?: "map" | "skip"
}

export interface AdapterSemanticCoaCandidate {
  targetCode: string
  accountType: AccountType
  confidence: number
  source: string
  matchedLabel: string
  reasoning: string
}

export interface AdapterSemanticCoaMapping {
  sourceLabel: string
  targetCode: string | null
  confidence: number
  action: "map" | "skip"
  source: "approved" | "existing-coa" | "standard-dictionary"
  matchedLabel?: string
  reasoning: string
}

export interface AdapterSemanticCoaReviewItem {
  dataType: "PLF" | "BS" | "CF"
  sourceLabel: string
  reason: string
  candidates: AdapterSemanticCoaCandidate[]
}

export interface AdapterRunInput {
  /** Full xlsx workbook object.
   *  Phase 8 D3 (2026-05-28) — tightened from a narrow in-house
   *  `{ Sheets, SheetNames }` shape to the real `XLSX.WorkBook` so
   *  downstream parsers can drop the `as any` bridging casts. xlsx
   *  is already a hard dep of every parser in this chain, so
   *  importing the type here is free. */
  workbook: XLSXType.WorkBook
  /** Sheet name within the workbook the adapter should read. */
  sheetName: string
  /** Resolved entity code (or null for cross-entity adapters). */
  entityCode: string | null
  /** Year scope (e.g. 2026). */
  year: number
  /** Organisation id. */
  organizationId: string
  /** XLSX module reference. Kept loose so test fixtures can stub
   *  without rebuilding the whole module surface; production callers
   *  pass the real `import * as XLSX from 'xlsx'`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any
  /** Decouple plan: which plan kind this sheet writes into — "actual"
   *  (realized results, terminal source) or "budget" (forward target).
   *  Defaults to "actual" when unset. Set from the classification's
   *  `planKind` (derived from the workbook section). */
  targetPlanKind?: "actual" | "budget"
  /** Reviewer/template-approved mappings for no-code rows in this sheet. */
  semanticCoaMappings?: SemanticCoaDecision[]
}

export interface AdapterRunResult {
  /** One-line description of what was parsed (for UI/logs). */
  summary: string
  /** Number of items the adapter parsed (rows / facts / parcels / …). */
  itemCount: number
  /** Non-fatal warnings emitted during parsing. */
  warnings: string[]
  /** No-code CoA resolution preview. Low-confidence review items block apply. */
  semanticCoa?: {
    mappings: AdapterSemanticCoaMapping[]
    reviewItems: AdapterSemanticCoaReviewItem[]
  }
  /** Apply step — invoked by orchestrator AFTER reconciliation passes. */
  applyToDb: (
    /**
     * The transaction client to use. Adapters that touch multiple
     * tables MUST use this client (not the outer prisma) so the whole
     * sheet either commits or rolls back atomically.
     */
    tx: Prisma.TransactionClient,
  ) => Promise<{
    rowsInserted: number
    /**
     * Post-write reconciliation the batch layer computed by RE-READING the
     * rows this adapter just wrote, inside the same transaction.
     *
     * Phase 11.2 (2026-07-29) — this channel did not exist, so every adapter
     * that ran a batch function discarded `result.reconciliation` and
     * returned only `rowsInserted`. The orchestrator therefore had no
     * post-write evidence at all and fell back to comparing the parsed
     * expected sums against themselves — a verdict that is green by
     * construction and proves nothing. Missing rows, doubled rows and
     * under-archived rows from a previous import were all invisible.
     *
     * Adapters that write nothing reconcilable (JSON blobs on
     * `Company.settings` — descriptions, land registry, forward forecast)
     * leave this undefined; the orchestrator records them as
     * `unverified` rather than folding them into a green verdict.
     */
    reconciliation?: ReconciliationReport
    /**
     * Company codes this adapter wrote to, when it resolves them ITSELF
     * (per-row) rather than from the sheet's single `entityCode`. The
     * orchestrator unions these into the recompute pass.
     *
     * Without it a cross-entity register (court cases / audit findings /
     * counterparty — one sheet naming several companies, so entityCode is
     * null) reported ZERO touched companies: the facts committed but no
     * indicator was recomputed, so the terminal showed nothing until an
     * unrelated financial import happened to fire a recompute. Found
     * 2026-07-15 loading the client's court-disputes file.
     */
    touchedCompanyCodes?: string[]
  }>
}

export type AdapterHandler = (
  input: AdapterRunInput,
) => Promise<AdapterRunResult>

/**
 * Registry mapping a classification → handler. Multiple classifications
 * can share a handler (e.g. KPI_FARMING + KPI_PROCESSING both go to
 * the KPI adapter).
 */
export interface AdapterRegistry {
  get(dataType: SheetDataType): AdapterHandler | null
  list(): SheetDataType[]
}

/**
 * Build the default registry. Each handler is a thin shim around
 * existing Phase 7.M adapters (azseker-workbook-* + import-batch
 * functions). When a new adapter ships, add one line here.
 *
 * The handlers are stub-style for now (record-in/intent-out); the
 * orchestrator will wire them to the real Phase 7.M parsers in
 * Phase D of this work. This file is the seam; the actual binding
 * happens later when we finalise the workbook→adapter integration
 * shape.
 */
export function buildDefaultRegistry(
  // Reserved for handlers that need the prisma client to look up
  // company ids etc. (e.g. KPI adapter resolves companyCode → companyId).
  _prisma: PrismaClient,
): AdapterRegistry {
  const handlers = new Map<SheetDataType, AdapterHandler>()

  // INFO_SUMMARY / UNKNOWN — no-op adapter. The orchestrator will skip
  // these but we register a handler so callers don't crash.
  const noop: AdapterHandler = async (input) => ({
    summary: `Sheet "${input.sheetName}" classified as info/unknown — no action`,
    itemCount: 0,
    warnings: [],
    applyToDb: async () => ({ rowsInserted: 0 }),
  })
  handlers.set("INFO_SUMMARY", noop)
  handlers.set("UNKNOWN", noop)

  // PLF / BS / CF / KPI_FARMING / KPI_PROCESSING / CAPEX / SALES /
  // LAND_REGISTRY / DESCRIPTIONS handlers are wired in Phase D of
  // the AI Import work (this file ships the seam + tests so the
  // orchestrator can be built against a stable interface).

  return {
    get(dataType) {
      return handlers.get(dataType) ?? null
    },
    list() {
      return Array.from(handlers.keys())
    },
  }
}

/**
 * Register a custom adapter at runtime. Used by:
 *   • Phase D wiring code (binds the real PLF/BS/CF/KPI/CAPEX adapters)
 *   • Tests that want to inject a mock handler
 */
export function registerAdapter(
  registry: AdapterRegistry & {
    _internal?: { handlers: Map<SheetDataType, AdapterHandler> }
  },
  dataType: SheetDataType,
  handler: AdapterHandler,
): void {
  // Best-effort: if registry exposes internal handlers map, mutate it.
  // The default registry does NOT expose it — use `buildRegistryWith()`
  // to compose a fresh registry with extra handlers.
  if (registry._internal?.handlers) {
    registry._internal.handlers.set(dataType, handler)
  } else {
    throw new Error(
      `Registry does not support runtime registration. Use buildRegistryWith() to compose.`,
    )
  }
}

/**
 * Compose a registry with explicit handler overrides. Used by tests and
 * by Phase D where we wire real adapters to types.
 */
export function buildRegistryWith(
  baseHandlers: Partial<Record<SheetDataType, AdapterHandler>>,
): AdapterRegistry {
  const handlers = new Map<SheetDataType, AdapterHandler>()
  for (const [k, v] of Object.entries(baseHandlers) as Array<
    [SheetDataType, AdapterHandler]
  >) {
    if (v) handlers.set(k, v)
  }
  return {
    get(dataType) {
      return handlers.get(dataType) ?? null
    },
    list() {
      return Array.from(handlers.keys())
    },
  }
}
