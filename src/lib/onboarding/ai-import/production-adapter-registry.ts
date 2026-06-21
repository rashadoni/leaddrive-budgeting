/**
 * Phase 7.M Tier 5 (2026-05-20) — Production adapter registry.
 *
 * Wires the existing per-sheet parsers + soft-data adapters into the
 * `AdapterRegistry` shape the multi-file orchestrator iterates. Each handler
 * parses ONE sheet (no DB writes), builds `expectedSums` for cross-file
 * conflict detection, and returns `applyToDb(tx)` that uses the outer tx to
 * call the matching batch function or write to `Company.settings` /
 * `Organization.settings` for the soft-data sheets.
 *
 * Phase 8 D1 (2026-05-29): the per-handler factories moved to
 * `production-adapter-handlers-financial.ts` (PLF/BS/CF/KPI) and
 * `production-adapter-handlers-soft.ts` (Land/CAPEX/Descriptions/
 * ForwardForecast/Companies/OpsFacts/BudgetActuals/SalesForecast/noop); the
 * shared per-orchestrator context lives in `prod-adapter-context.ts`. This
 * file is now just the assembler that resolves+caches the context and wires
 * the handlers into the registry. `buildProductionAdapterRegistry` stays the
 * sole public export (consumed by the ai-auto-multi route + its test).
 */
import type { PrismaClient } from "@prisma/client"
import {
  buildRegistryWith,
  type AdapterHandler,
  type AdapterRegistry,
  type AdapterRunInput,
} from "./adapter-registry"
import { type OrgContext, resolveOrgContext } from "./prod-adapter-context"
import {
  makePlfHandler,
  makeBsHandler,
  makeCfHandler,
  makeKpiHandler,
} from "./production-adapter-handlers-financial"
import {
  makeLandRegistryHandler,
  makeCapexHandler,
  makeDescriptionsHandler,
  makeForwardForecastHandler,
  makeCompaniesHandler,
  makeOpsFactsHandler,
  makeBudgetActualsHandler,
  makeSalesForecastHandler,
  makeCounterpartyHandler,
  makeLegalCasesHandler,
  noopHandler,
} from "./production-adapter-handlers-soft"

// ──────────────────────────────────────────────────────────────────────
// Public entry — build the production registry
// ──────────────────────────────────────────────────────────────────────

/**
 * Build a registry that wires the AI Import classification → real
 * Phase 7.M parsers + batch functions. Uses an internal closure to
 * resolve+cache plan/companies per orchestrator invocation.
 *
 * Use ONE registry per multi-file orchestrator call so the context
 * stays scoped to (org, year). Calling `buildProductionAdapterRegistry`
 * again starts a fresh cache.
 */
export function buildProductionAdapterRegistry(
  prisma: PrismaClient,
): AdapterRegistry {
  // Shared context ref — populated lazily on first handler invocation.
  // Re-resolves on each org/year combination via the orgKey check.
  const ctxRef: { value: OrgContext | null; orgKey: string | null } = {
    value: null,
    orgKey: null,
  }
  // ensureCtx receives the org/year from the AdapterRunInput closure.
  // We can't bake them in at build time (registry is shared across
  // calls within one orchestrator invocation but the input arrives
  // per-handler). Solution: each handler resolves its own context if
  // the cached one doesn't match.
  // Per-(org, year, kind) context cache. Decouple plan Y5b: a single
  // import can touch BOTH an "actual" plan and a "budget" plan (e.g. a
  // PLF "Actual >>>" sheet and a sales-forecast sheet in the same
  // upload), so the cache MUST be keyed by kind. A single shared ctxRef
  // (pre-Y5b) would resolve once and route EVERY later sheet to whichever
  // kind happened to resolve first — silently writing budget rows into
  // the actuals plan (the terminal's P&L source) or vice-versa.
  const ctxByKey = new Map<string, OrgContext>()
  function makeEnsure(input: AdapterRunInput): () => Promise<OrgContext> {
    return async () => {
      const kind = input.targetPlanKind ?? "actual"
      const key = `${input.organizationId}::${input.year}::${kind}`
      const cached = ctxByKey.get(key)
      if (cached) {
        ctxRef.value = cached
        return cached
      }
      const next = await resolveOrgContext(
        prisma,
        input.organizationId,
        input.year,
        kind,
      )
      ctxByKey.set(key, next)
      ctxRef.value = next
      ctxRef.orgKey = key
      return next
    }
  }
  // Wrapper that injects ensureCtx into the per-input handler call.
  function wrap(make: (
    prisma: PrismaClient,
    ctxRef: { value: OrgContext | null },
    ensureCtx: () => Promise<OrgContext>,
  ) => AdapterHandler): AdapterHandler {
    return async (input) => {
      const handler = make(prisma, ctxRef, makeEnsure(input))
      return handler(input)
    }
  }
  return buildRegistryWith({
    PLF: wrap(makePlfHandler),
    BS: wrap(makeBsHandler),
    CF: wrap(makeCfHandler),
    KPI_FARMING: wrap((p, c, e) => makeKpiHandler(p, c, e, "farming")),
    KPI_PROCESSING: wrap((p, c, e) => makeKpiHandler(p, c, e, "processing")),
    SALES: wrap((p, c, e) => makeKpiHandler(p, c, e, "sales")),
    LAND_REGISTRY: wrap(makeLandRegistryHandler),
    CAPEX: wrap(makeCapexHandler),
    DESCRIPTIONS: wrap(makeDescriptionsHandler),
    COUNTERPARTY: wrap(makeCounterpartyHandler),
    LEGAL_CASES: wrap(makeLegalCasesHandler),
    // forward-forecast file-type uses INFO_SUMMARY classification on
    // its main sheet (İcmal). The file-type detector picks it up by
    // having ≥3 INFO_SUMMARY sheets without PLF/BS/CF. So we wire the
    // INFO_SUMMARY classification to the forward-forecast handler —
    // safer than nothing, and the handler is a noop for sheets that
    // aren't actually İcmal-shape.
    INFO_SUMMARY: wrap(makeForwardForecastHandler),
    // Phase 7.M Tier 6 — onboarding consolidation. COMPANIES doesn't
    // need org context (it's bootstrapping companies, not writing data
    // into existing ones), so we don't wrap it with the ensureCtx helper.
    COMPANIES: makeCompaniesHandler(prisma),
    // Phase 7.M Tier 7 — import consolidation. OPS_FACTS reuses the
    // shared org-context (companyCode → companyId map) like KPI handlers.
    OPS_FACTS: wrap(makeOpsFactsHandler),
    // Phase 7.M Tier 7 (Phase 3) — BUDGET_ACTUALS writes to budget_actuals
    // table via planId resolved from shared org-context.
    BUDGET_ACTUALS: wrap(makeBudgetActualsHandler),
    // Phase 7.M Tier 7 (Phase 4) — SALES_FORECAST writes to sales_forecasts
    // table via departmentLabel → departmentId resolved from shared
    // org-context (deptLabelToId map).
    SALES_FORECAST: wrap(makeSalesForecastHandler),
    UNKNOWN: noopHandler,
  })
}
