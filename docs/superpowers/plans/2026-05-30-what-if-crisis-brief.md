# What-if "Crisis Brief" — Phase 1 Implementation Plan (B2 — cause-accurate P&L recompute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click on a crisis scenario re-derives every indicator from a small set of economic **shocks** (revenue/price/input-cost/FX/yield) via a consistent per-company P&L recompute, with NO DB writes, cascades the HeatMap into its scenario colours worst-first, swings the revenue-weighted holding composite, and streams a CFO-grounded AI "Crisis Brief" — instantly revertible.

**Architecture:** Reuse the proven in-memory recompute path (`buildContext` + `recomputeIndicator` with the existing `scenarioOverrides` hook — already exercised by `/api/indicators/matrix/preview`). The override surface is the **resolved financial scalars** (`revenue`, `cogs`, `gross_profit`, `opex`, `ebitda`, `net_income`, `total_input_cost`, `imported_input_cost`, `yield_per_ha`) — confirmed against live data (spec §B). A scenario carries a `shock` block; `resolveShockOverrides` reads each company's baseline scalars and recomputes the dependent P&L chain consistently into a flat `scenarioOverrides` map. New code: the shock schema + resolver, an orchestration module (`simulateByDrivers`) wrapping the recompute loop + `deriveParentComposites` for the holding swing, an AI narrative generator mirroring `variance-explainer.ts`, an extended `?mode=drivers` route branch, and a `ScenarioPanel` enhancement (cascade + score tween + narrative stream + revert).

**Tech Stack:** Next.js 16 (App Router) · Prisma · PostgreSQL · TypeScript (tsc must stay 0) · vitest · Anthropic SDK (`getAnthropicClient`, Sonnet) · hand-rolled `terminalStore`.

**Spec:** `docs/superpowers/specs/2026-05-30-what-if-crisis-brief-design.md` — **read §B (transmission findings + the B2 shock schema + the 3 flagship scenarios) before starting.**

**Two mandatory gates:**
- **Task 8 — Financial-correctness verification.** "The numbers must be right, not just dramatic." P&L-recompute consistency, CFO-defensible direction+magnitude, DB cross-check, no-writes proof, holding-swing Σ-math.
- **Task 9 — UX/UI review.** Clarity, interactivity, intuitiveness vs the validated mockup `public/crisis-mockup.html`.

---

## Grounding facts (verified against the live DB 2026-05-30 — do not re-guess)

- `buildContext(ds, args)` — `args.scenarioOverrides?: Record<string, number>` is applied to `state.context` AFTER all resolvers run, BEFORE formula eval; non-finite override values are silently skipped. `args.period` is a parsed `Period` object (`parsePeriod('2026')`), NOT a string. Returns `{ context: FormulaContext; inputs; functions }`. `recompute.ts:296`.
- `recomputeIndicator(ds, args)` — `args` = `{ organizationId, companyId, definition: IndicatorDefinitionLike, period: string, scenarioOverrides?, baseCurrency?, industry?, withSparkline? }`. `period` here is a **string** (`'2026'`; parsed internally). Returns `{ ok: boolean; status: IndicatorStatus; value: number }`. **Does NOT persist.** `recompute.ts:485`.
- `IndicatorDefinitionLike = { id: string; code?: string; formula: string; thresholds: unknown; requiredInputs: string[] }` (`recompute.ts:382`).
- `createPrismaDataSource(prisma)` builds a `RecomputeDataSource`. Preview-loop pattern: `src/app/api/indicators/matrix/preview/route.ts:242-309`.
- **Resolved financial scalars** (the override surface), per `indicator_values.inputs.resolved` on a food-processing company: `revenue, cogs, gross_profit, opex, ebitda, net_income, da_total, total_cost, total_input_cost, domestic_input_cost, imported_input_cost` and (FX indicator only) `fx_usd, fx_eur, fx_azn`. Agro adds `yield_per_ha`, and `hectares_planted` comes via `company.settings.hectaresPlanted`.
- **Formulas read DERIVED scalars** (verified): `FP_GROSS_MARGIN = gross_profit/revenue*100`, `IND_EBITDA_MARGIN = ebitda/revenue*100`, `FP_OPEX_RATIO = opex/revenue*100`, `SVC_NET_MARGIN = net_income/revenue*100`, `FX_IMPORTED_INPUT = imported_input_cost/total_input_cost*100`, `AGRO_REVENUE_PER_HA = revenue/hectares_planted`, `AGRO_YIELD_PER_HA = yield_per_ha`. → overriding `cogs` alone is INERT; the engine must recompute `gross_profit/ebitda/net_income` consistently (B2).
- **Live data:** 8 companies under root `AZSEKER`. Operational leaves + 2026 revenue: `AZSEKER-FARM` agro 10.72M · `AZSEKER-CPC` food_proc 6.48M · `AZSEKER-AZSF` food_proc 2.25M (EBITDA −649K) · `AZSEKER-MALT` food_proc 546K (EBITDA −518K) · `AZSEKER-EDEN` agro 258K (EBITDA −1.90M) · `AZSEKER-HORIZON` services 0 · `AZSEKER-PROMALT` food_proc 0. **`imported_input_cost = 0` for every company** → naive `fx_usd` moves nothing (hence `assumedImportShare` for the FX scenario).
- **`companies` table has NO `revenue` column** — revenue is derived as `MAX(inputs.resolved.revenue)` per company from `indicator_values` (matrix route pattern `route.ts:311-316`). Task 4 MUST source revenue this way, not `select: { revenue: true }`.
- AI narrative pattern (canonical): `src/lib/risk/variance-explainer.ts` — `SYSTEM_PROMPT` · pure `buildExplainerPrompt` · pure `validateAndShape` · `runExplainer(input, opts)` with `opts.client` seam, `max_tokens` guard, `extractJsonFromText` from `@/lib/onboarding/ai-mapper/json-extract`, captures `response.model` + `usage`. `getAnthropicClient()` + `AI_MODEL` from `src/lib/ai/client.ts`.
- `computeCompositeByCompany(cells: readonly HeatMapCell[], companyIds?, riskTagsByCompany?): Map<string, CompositeScore>` (`composite-score.ts:178`). `deriveParentComposites(companies: ReadonlyArray<{ id; parentCompanyId?; revenue? }>, leafById): Map<string, CompositeScore>` (`:225`). `CompositeScore = { score: number|null; band; contributingCount; totalCount }`. `HeatMapCell = { companyId; indicatorId; value; status; weight? }` (`heatmap-matrix.ts:13`).
- `terminalStore`: `setScenarioDelta(delta: ReadonlyMap<string,string>|null, label)`, `clearScenarioDelta()`, state `scenarioDelta`, `activeScenarioCode`, `activeScenarioLabel` (`:197,436`).
- Simulate route: `GET` at `src/app/api/scenarios/[id]/simulate/route.ts`, `{ params: Promise<{ id }> }`, legacy `simulateScenario` + `buildDeltaMap`, returns `{ ...result, deltaMap }`.
- `Scenario.overrides` is a JSON column → **no Prisma migration**; `shock` is a new key alongside legacy `adjustments`.
- Dev server is LaunchAgent-managed (port 3000). Restart before live verification: `launchctl kickstart -k gui/501/com.budgetpro.dev` (run with `dangerouslyDisableSandbox: true`). Never `npm run dev`.
- `npx tsx` hits an npm-cache EPERM under the sandbox — for one-off scripts run with `dangerouslyDisableSandbox: true`, or query the DB via the postgres MCP.

---

## File Structure

**Create:**
- `src/lib/risk/scenario-shock.ts` — `ScenarioShock` type, `ResolvedScalars` type, `hasShock()` type-guard, `resolveShockOverrides(shock, baseline)` pure B2 P&L recompute → flat `scenarioOverrides`.
- `src/lib/risk/scenario-shock.test.ts`
- `src/lib/risk/scenario-rederive.ts` — `simulateByDrivers(ds, input, deps?)` orchestration + result types. Per-company baseline read → `resolveShockOverrides` → scenario recompute (no persist) → deltas + holding swing.
- `src/lib/risk/scenario-rederive.test.ts`
- `src/lib/risk/scenario-narrative.ts` — `CrisisBriefInput/Output`, `SYSTEM_PROMPT`, pure `buildCrisisBriefPrompt`, pure `validateAndShape`, `runCrisisBrief`.
- `src/lib/risk/scenario-narrative.test.ts`
- `src/features/terminal/lib/cascade-order.ts` — `orderCascade(deltas)` pure worst-first ordering.
- `src/features/terminal/lib/cascade-order.test.ts`
- `scripts/seed-crisis-scenarios.ts` — author + upsert the catalog as shocks.
- `scripts/seed-crisis-scenarios.test.ts`

**Modify:**
- `src/app/api/scenarios/[id]/simulate/route.ts` — `?mode=drivers` branch (fetch companies + indicator defs + baseline IVs incl. `inputs`; derive revenue from `inputs.resolved.revenue`; run `simulateByDrivers`; optional `runCrisisBrief` with graceful degrade).
- `src/features/terminal/store/terminalStore.ts` — `scenarioBrief` slice + `setScenarioBrief`/`clearScenarioBrief`; `clearScenarioDelta` also clears the brief.
- `src/features/terminal/components/ScenarioPanel.tsx` — drivers-mode fetch + cascade + score tween + line-by-line narrative + revert.
- `docs/ROADMAP.md` + `docs/CARRYOVER.md`.

**Reuse unchanged:** `scenario-simulator.ts` (legacy), `recompute.ts`, `composite-score.ts`, `ai/client.ts`, `heatmap-matrix.ts`.

---

## Task 0: Driver transmission — ALREADY VERIFIED via SQL (spec §B)

Transmission was confirmed read-only against the live DB (recorded in spec §B): the margin formulas read derived scalars, `imported_input_cost=0` everywhere, and the override surface is the resolved financial scalars. **No tsx spike needed.** The B2 engine overrides exactly the scalars the formulas read, so transmission is structural, not probabilistic.

- [ ] **Step 1:** Re-read spec §B and confirm the resolved-scalar list above matches a fresh query for ONE food-processing + ONE agro company:

```sql
SELECT c.code, iv.inputs->'resolved' FROM indicator_values iv
JOIN companies c ON c.id=iv."companyId"
JOIN indicator_definitions d ON d.id=iv."indicatorId"
WHERE iv.period='2026' AND d.code='IND_EBITDA_MARGIN' AND c.code IN ('AZSEKER-CPC','AZSEKER-EDEN');
```
Run via the postgres MCP (conn `postgresql://rashadrahimov:@localhost:5432/budgetpro`). Confirm `revenue/cogs/gross_profit/opex/ebitda/net_income` are present. **Gate:** if a scalar named in `resolveShockOverrides` is absent, fix the resolver-var name before Task 1.

---

## Task 1: Scenario shock schema + `resolveShockOverrides` (B2 P&L recompute)

**Files:**
- Create: `src/lib/risk/scenario-shock.ts`
- Test: `src/lib/risk/scenario-shock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { hasShock, resolveShockOverrides, type ScenarioShock, type ResolvedScalars } from './scenario-shock'

const base: ResolvedScalars = {
  revenue: 1000, cogs: 600, opex: 200, gross_profit: 400, ebitda: 200, net_income: 150,
  da_total: 50, total_input_cost: 600, imported_input_cost: 0, yield_per_ha: 10,
}

describe('hasShock', () => {
  it('true when overrides.shock has at least one non-zero field', () => {
    expect(hasShock({ shock: { inputCostShock: 0.3 } })).toBe(true)
  })
  it('false for legacy adjustments / empty / all-zero / null', () => {
    expect(hasShock({ adjustments: [] })).toBe(false)
    expect(hasShock({ shock: {} })).toBe(false)
    expect(hasShock({ shock: { revenueShock: 0, inputCostShock: 0 } })).toBe(false)
    expect(hasShock(null)).toBe(false)
  })
})

describe('resolveShockOverrides — consistent P&L recompute', () => {
  it('input-cost +25% raises cogs, compresses gross_profit/ebitda/net_income (revenue unchanged)', () => {
    const o = resolveShockOverrides({ inputCostShock: 0.25 }, base)
    // new_cogs = 600 + 600*0.25 = 750 ; new_gross_profit = 1000 - 750 = 250
    expect(o.cogs).toBeCloseTo(750)
    expect(o.gross_profit).toBeCloseTo(250)
    expect(o.ebitda).toBeCloseTo(250 - 200)        // 50
    expect(o.net_income).toBeCloseTo(50 - 50)       // 0
    expect(o.revenue).toBeCloseTo(1000)
    expect(o.total_input_cost).toBeCloseTo(750)
  })
  it('revenue (volume) −30% scales revenue AND variable cogs together', () => {
    const o = resolveShockOverrides({ revenueShock: -0.3 }, base)
    expect(o.revenue).toBeCloseTo(700)
    expect(o.cogs).toBeCloseTo(420)                 // 600*0.7
    expect(o.gross_profit).toBeCloseTo(280)         // 700-420
    expect(o.ebitda).toBeCloseTo(80)                // 280-200
  })
  it('price −20% scales revenue only → margin compresses hard', () => {
    const o = resolveShockOverrides({ priceShock: -0.2 }, base)
    expect(o.revenue).toBeCloseTo(800)
    expect(o.cogs).toBeCloseTo(600)                 // unchanged
    expect(o.gross_profit).toBeCloseTo(200)         // 800-600
  })
  it('fxShock with assumedImportShare raises cost when imported_input_cost==0', () => {
    const o = resolveShockOverrides({ fxShock: 0.2, assumedImportShare: 0.3 }, base)
    // importBase = cogs*0.3 = 180 ; cost_increase = 180*0.2 = 36 ; new_cogs = 636
    expect(o.cogs).toBeCloseTo(636)
    expect(o.gross_profit).toBeCloseTo(1000 - 636)
    expect(o.imported_input_cost).toBeCloseTo(180 * 1.2)  // 216
    expect(o.total_input_cost).toBeCloseTo(636)
  })
  it('yieldShock −30% lowers yield_per_ha', () => {
    const o = resolveShockOverrides({ yieldShock: -0.3 }, base)
    expect(o.yield_per_ha).toBeCloseTo(7)
  })
  it('skips non-finite baseline scalars (missing for some company)', () => {
    const o = resolveShockOverrides({ inputCostShock: 0.25 }, { revenue: NaN, cogs: NaN } as ResolvedScalars)
    expect(Object.keys(o).every((k) => Number.isFinite(o[k]))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/risk/scenario-shock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Phase 1 "Crisis Brief" — economic-shock schema + B2 P&L recompute.
 *
 * Spec §B: margin formulas read DERIVED scalars (gross_profit, ebitda,
 * net_income) — not primitives — so overriding `cogs` alone is inert. This
 * module reads a company's baseline resolved scalars and recomputes the
 * dependent P&L chain CONSISTENTLY from a small set of economic shocks, then
 * returns a flat `scenarioOverrides` map for buildContext.
 *
 * Pure module — no DB, no Prisma. NO side effects.
 */

export interface ScenarioShock {
  /** Δ sales VOLUME, fraction (−0.30 = −30%): scales revenue AND variable cogs. */
  revenueShock?: number
  /** Δ selling PRICE, fraction (−0.20): scales revenue only → margin compresses. */
  priceShock?: number
  /** Δ input cost, fraction (+0.25): scales cogs only → margin compresses. */
  inputCostShock?: number
  /** AZN devaluation fraction (0.20 = −20%): raises cost on the FX-exposed input share. */
  fxShock?: number
  /** 0..1 — used for fxShock WHEN imported_input_cost==0 (current data). */
  assumedImportShare?: number
  /** Δ yield_per_ha, fraction (−0.30). */
  yieldShock?: number
}

/** The resolved financial scalars the recompute pipeline exposes per company
 *  (subset we read/override). Missing fields tolerated (Number.isFinite guard). */
export interface ResolvedScalars {
  revenue: number
  cogs: number
  opex: number
  gross_profit: number
  ebitda: number
  net_income: number
  da_total: number
  total_input_cost: number
  imported_input_cost: number
  yield_per_ha?: number
}

const SHOCK_KEYS: (keyof ScenarioShock)[] = [
  'revenueShock', 'priceShock', 'inputCostShock', 'fxShock', 'assumedImportShare', 'yieldShock',
]

/** Type-guard: does this overrides blob carry a shock with ≥1 non-zero effect? */
export function hasShock(overrides: unknown): overrides is { shock: ScenarioShock } {
  if (!overrides || typeof overrides !== 'object') return false
  const shock = (overrides as { shock?: unknown }).shock
  if (!shock || typeof shock !== 'object') return false
  const s = shock as Record<string, unknown>
  // `assumedImportShare` alone is not an effect; require a real shock lever.
  const levers: (keyof ScenarioShock)[] = ['revenueShock', 'priceShock', 'inputCostShock', 'fxShock', 'yieldShock']
  return levers.some((k) => typeof s[k] === 'number' && Number.isFinite(s[k] as number) && (s[k] as number) !== 0)
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/**
 * B2 recompute. Reads baseline scalars, applies the shocks, recomputes the
 * dependent chain, and returns ONLY the finite, meaningful overrides. See
 * spec §B.2 for the model. Conservative: opex + da_total held fixed.
 */
export function resolveShockOverrides(
  shock: ScenarioShock,
  base: ResolvedScalars,
): Record<string, number> {
  const revenue = num(base.revenue)
  const cogs = num(base.cogs)
  const opex = num(base.opex)
  const daTotal = num(base.da_total)
  const importedCost = num(base.imported_input_cost)
  const yieldPerHa = base.yield_per_ha

  const volumeF = 1 + num(shock.revenueShock)
  const priceF = 1 + num(shock.priceShock)
  const fx = num(shock.fxShock)
  const importShare = num(shock.assumedImportShare)
  const inputCostShock = num(shock.inputCostShock)

  const new_revenue = revenue * volumeF * priceF
  const importBase = importedCost > 0 ? importedCost : cogs * importShare
  const cost_increase = importBase * fx + cogs * inputCostShock
  const new_cogs = cogs * volumeF + cost_increase
  const new_gross_profit = new_revenue - new_cogs
  const new_ebitda = new_gross_profit - opex
  const new_net_income = new_ebitda - daTotal

  const out: Record<string, number> = {}
  const put = (k: string, v: number) => { if (Number.isFinite(v)) out[k] = v }

  // Only emit overrides when there is a value to override against (baseline finite).
  if (Number.isFinite(revenue)) put('revenue', new_revenue)
  if (Number.isFinite(cogs)) {
    put('cogs', new_cogs)
    put('total_input_cost', new_cogs)
  }
  if (Number.isFinite(revenue) && Number.isFinite(cogs)) put('gross_profit', new_gross_profit)
  if (Number.isFinite(opex) && Number.isFinite(revenue) && Number.isFinite(cogs)) put('ebitda', new_ebitda)
  if (Number.isFinite(daTotal) && Number.isFinite(opex) && Number.isFinite(revenue) && Number.isFinite(cogs)) put('net_income', new_net_income)
  // FX scenario: surface the (assumed) imported cost so FX_IMPORTED_INPUT moves.
  if ((fx !== 0) && (importBase > 0)) put('imported_input_cost', importBase * (1 + fx))
  if (typeof yieldPerHa === 'number' && Number.isFinite(yieldPerHa) && shock.yieldShock) {
    put('yield_per_ha', yieldPerHa * (1 + num(shock.yieldShock)))
  }
  return out
}

/** Parse a raw `Scenario.overrides` blob into a typed ScenarioShock (or null). */
export function readShock(overrides: unknown): ScenarioShock | null {
  if (!hasShock(overrides)) return null
  const s = (overrides as { shock: Record<string, unknown> }).shock
  const out: ScenarioShock = {}
  for (const k of SHOCK_KEYS) if (typeof s[k] === 'number') out[k] = s[k] as number
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/risk/scenario-shock.test.ts`
Expected: PASS (2 + 6 cases).

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/risk/scenario-shock.ts src/lib/risk/scenario-shock.test.ts
git commit -m "feat(scenario): B2 economic-shock schema + consistent P&L recompute (Task 1)"
```

---

## Task 2: `simulateByDrivers` engine

**Files:**
- Create: `src/lib/risk/scenario-rederive.ts`
- Test: `src/lib/risk/scenario-rederive.test.ts`

**Design:** orchestration only. Per company: one baseline `buildContext` (union of all indicator `requiredInputs`) to read the resolved scalars → `resolveShockOverrides` → per-indicator `recomputeIndicator` with `scenarioOverrides` (no persist). Baseline VALUES come from the passed-in persisted IVs (the on-screen number). Composite swing = `computeCompositeByCompany` over baseline cells vs scenario cells → `deriveParentComposites`. `buildContext` + `recomputeIndicator` are injectable (`deps`) for a no-DB unit test.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { simulateByDrivers } from './scenario-rederive'

// DS whose every mutation throws — proves the engine never persists.
const noWriteDs = new Proxy({}, {
  get(_t, prop: string) {
    if (/^upsert|^create|^update|^delete|^persist/i.test(prop)) {
      return () => { throw new Error(`DB write attempted: ${prop}`) }
    }
    return () => undefined
  },
}) as never

describe('simulateByDrivers (B2)', () => {
  const companies = [
    { id: 'c1', code: 'CPC', name: 'CPC', parentCompanyId: 'p1', industry: 'food_processing', revenue: 1000 },
    { id: 'c2', code: 'EDEN', name: 'Eden', parentCompanyId: 'p1', industry: 'agro_crops', revenue: 500 },
    { id: 'p1', code: 'AZSEKER', name: 'Holding', parentCompanyId: null, industry: null, revenue: null },
  ]
  const indicators = [
    { id: 'i1', code: 'IND_EBITDA_MARGIN', formula: 'ebitda / revenue * 100', thresholds: {}, requiredInputs: ['budgetLine'], weight: 1.5 },
  ]
  const baselineIVs = [
    { companyId: 'c1', indicatorId: 'i1', value: 20, status: 'green' as const },
    { companyId: 'c2', indicatorId: 'i1', value: 10, status: 'amber' as const },
  ]
  const scenario = { code: 'INPUT_COST_30', overrides: { shock: { inputCostShock: 0.3 } } }

  it('recomputes scenario IVs via injected recompute, computes deltas + holding swing, NO writes', async () => {
    const fakeBuildContext = vi.fn(async () => ({
      context: { revenue: 1000, cogs: 600, opex: 200, gross_profit: 400, ebitda: 200, net_income: 150, da_total: 50, total_input_cost: 600, imported_input_cost: 0 },
      inputs: {}, functions: {},
    } as never))
    const fakeRecompute = vi.fn(async (_ds, args: { companyId: string; scenarioOverrides?: Record<string, number> }) => {
      const scen = !!args.scenarioOverrides && Object.keys(args.scenarioOverrides).length > 0
      if (args.companyId === 'c1') return { ok: true, value: scen ? 2 : 20, status: scen ? 'red' : 'green' } as never
      return { ok: true, value: scen ? -5 : 10, status: scen ? 'red' : 'amber' } as never
    })
    const r = await simulateByDrivers(noWriteDs, {
      organizationId: 'org1', scenario, period: '2026', companies, indicators, baselineIVs,
    }, { buildContext: fakeBuildContext, recomputeIndicator: fakeRecompute })

    const c1 = r.deltas.find((d) => d.companyId === 'c1')!
    expect(c1.baselineValue).toBe(20)
    expect(c1.scenarioValue).toBe(2)
    expect(c1.changed).toBe(true)
    expect(r.holdingScenarioScore! < r.holdingBaselineScore!).toBe(true)
    expect(r.worsened).toBeGreaterThan(0)
    // the override handed to recompute is the consistent scalar set (gross_profit < baseline)
    const scenCall = fakeRecompute.mock.calls.find((c) => (c[1] as { scenarioOverrides?: Record<string, number> }).scenarioOverrides && Object.keys((c[1] as { scenarioOverrides: Record<string, number> }).scenarioOverrides).length)
    expect(scenCall).toBeTruthy()
    expect((scenCall![1] as { scenarioOverrides: Record<string, number> }).scenarioOverrides.gross_profit).toBeCloseTo(1000 - (600 + 600 * 0.3))
  })

  it('a per-company recompute throw falls back to baseline, never aborts', async () => {
    const fakeBuildContext = vi.fn(async () => ({ context: { revenue: 1000, cogs: 600, opex: 200, gross_profit: 400, ebitda: 200, net_income: 150, da_total: 50, total_input_cost: 600, imported_input_cost: 0 }, inputs: {}, functions: {} } as never))
    const fakeRecompute = vi.fn(async (_ds, args: { companyId: string }) => {
      if (args.companyId === 'c2') throw new Error('resolver blew up')
      return { ok: true, value: 2, status: 'red' } as never
    })
    const r = await simulateByDrivers(noWriteDs, { organizationId: 'org1', scenario, period: '2026', companies, indicators, baselineIVs }, { buildContext: fakeBuildContext, recomputeIndicator: fakeRecompute })
    expect(r.driftSummary.pairsErrored).toBeGreaterThan(0)
    const c2 = r.deltas.find((d) => d.companyId === 'c2')!
    expect(c2.scenarioValue).toBe(c2.baselineValue)
    expect(c2.changed).toBe(false)
  })

  it('holding swing is revenue-weighted (hand-computed fixture)', async () => {
    // c1 rev 1000 stays green(100); c2 rev 500 stays amber(50) → parent = (100*1000+50*500)/1500 = 83
    const fakeBuildContext = vi.fn(async () => ({ context: { revenue: 1, cogs: 0, opex: 0, gross_profit: 1, ebitda: 1, net_income: 1, da_total: 0, total_input_cost: 0, imported_input_cost: 0 }, inputs: {}, functions: {} } as never))
    const fakeRecompute = vi.fn(async (_ds, args: { companyId: string }) => (args.companyId === 'c1' ? { ok: true, value: 20, status: 'green' } : { ok: true, value: 10, status: 'amber' }) as never)
    const r = await simulateByDrivers(noWriteDs, { organizationId: 'org1', scenario, period: '2026', companies, indicators, baselineIVs }, { buildContext: fakeBuildContext, recomputeIndicator: fakeRecompute })
    expect(r.holdingScenarioScore).toBe(83)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/risk/scenario-rederive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Phase 1 "Crisis Brief" — driver re-derivation engine (B2).
 *
 * Pure orchestration over buildContext + recomputeIndicator (both injectable
 * for unit tests). Per company: read baseline resolved scalars, run the B2
 * P&L recompute (resolveShockOverrides) into a flat scenarioOverrides map,
 * re-derive every indicator under it (NO PERSIST), emit deltas. Holding swing
 * uses computeCompositeByCompany + deriveParentComposites — the SAME helpers
 * the live terminal uses, so the demo number matches the real screen.
 *
 * NO DB WRITES.
 */

import { buildContext as realBuildContext, recomputeIndicator as realRecompute } from './recompute'
import type { RecomputeDataSource, IndicatorDefinitionLike } from './recompute-types'
import type { IndicatorStatus } from './formula-engine'
import { parsePeriod } from './periods'
import { hasShock, readShock, resolveShockOverrides, type ResolvedScalars } from './scenario-shock'
import { computeCompositeByCompany, deriveParentComposites } from './composite-score'
import type { HeatMapCell } from './heatmap-matrix'

export interface SimulateByDriversCompany {
  id: string; code: string; name: string
  parentCompanyId?: string | null; industry?: string | null; revenue?: number | null
}
export interface SimulateByDriversIndicator {
  id: string; code: string; formula: string; thresholds: unknown; requiredInputs: string[]; weight?: number | null
}
export interface SimulateByDriversBaselineIV {
  companyId: string; indicatorId: string; value: number; status: IndicatorStatus
}
export interface SimulateByDriversInput {
  organizationId: string
  scenario: { code: string; overrides: unknown }
  period: string
  companies: SimulateByDriversCompany[]
  indicators: SimulateByDriversIndicator[]
  baselineIVs: SimulateByDriversBaselineIV[]
}
export interface SimulateByDriversDeps {
  buildContext?: typeof realBuildContext
  recomputeIndicator?: typeof realRecompute
}
export interface DriverIndicatorDelta {
  companyId: string; companyCode: string; companyName: string
  indicatorId: string; code: string
  baselineValue: number | null; baselineStatus: IndicatorStatus | null
  scenarioValue: number | null; scenarioStatus: IndicatorStatus | null
  changed: boolean; deltaPct: number | null
}
export interface DriverCompositeSwing {
  companyId: string; companyCode: string; baselineScore: number | null; scenarioScore: number | null
}
export interface DriverSimulationResult {
  scenarioCode: string; period: string
  deltas: DriverIndicatorDelta[]; byCompany: DriverCompositeSwing[]
  holdingBaselineScore: number | null; holdingScenarioScore: number | null
  changed: number; worsened: number; improved: number
  driftSummary: { pairsAttempted: number; pairsErrored: number; lastError: string | null }
}

const STATUS_ORDER: Record<IndicatorStatus, number> = { green: 3, amber: 2, red: 1, unknown: 0 }

function readScalars(ctx: Record<string, unknown>): ResolvedScalars {
  const g = (k: string): number => (typeof ctx[k] === 'number' ? (ctx[k] as number) : NaN)
  return {
    revenue: g('revenue'), cogs: g('cogs'), opex: g('opex'),
    gross_profit: g('gross_profit'), ebitda: g('ebitda'), net_income: g('net_income'),
    da_total: g('da_total'), total_input_cost: g('total_input_cost'),
    imported_input_cost: g('imported_input_cost'), yield_per_ha: g('yield_per_ha'),
  }
}

export async function simulateByDrivers(
  ds: RecomputeDataSource,
  input: SimulateByDriversInput,
  deps: SimulateByDriversDeps = {},
): Promise<DriverSimulationResult> {
  const buildContext = deps.buildContext ?? realBuildContext
  const recomputeIndicator = deps.recomputeIndicator ?? realRecompute
  const { organizationId, scenario, period, companies, indicators, baselineIVs } = input

  if (!hasShock(scenario.overrides)) {
    throw new Error(`Scenario ${scenario.code} has no shock — use the legacy multiplier path.`)
  }
  const shock = readShock(scenario.overrides)!
  const parsedPeriod = parsePeriod(period)

  const baselineByKey = new Map<string, SimulateByDriversBaselineIV>()
  for (const iv of baselineIVs) baselineByKey.set(`${iv.companyId}:${iv.indicatorId}`, iv)

  const requiredUnion = Array.from(new Set(indicators.flatMap((i) => i.requiredInputs ?? [])))

  const deltas: DriverIndicatorDelta[] = []
  let pairsErrored = 0
  let lastError: string | null = null
  const scenarioCells: HeatMapCell[] = []
  const baselineCells: HeatMapCell[] = []

  for (const co of companies) {
    let overrides: Record<string, number> = {}
    try {
      const baseCtx = await buildContext(ds, {
        organizationId, companyId: co.id, period: parsedPeriod,
        requiredInputs: requiredUnion, industry: co.industry ?? null,
      })
      overrides = resolveShockOverrides(shock, readScalars(baseCtx.context as Record<string, unknown>))
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }

    for (const ind of indicators) {
      const key = `${co.id}:${ind.id}`
      const baseline = baselineByKey.get(key) ?? null
      const def: IndicatorDefinitionLike = {
        id: ind.id, code: ind.code, formula: ind.formula, thresholds: ind.thresholds, requiredInputs: ind.requiredInputs,
      }
      let scenarioValue: number | null = baseline?.value ?? null
      let scenarioStatus: IndicatorStatus | null = baseline?.status ?? null
      try {
        const rr = await recomputeIndicator(ds, {
          organizationId, companyId: co.id, definition: def, period, industry: co.industry ?? null, scenarioOverrides: overrides,
        })
        scenarioValue = rr.status === 'unknown' ? null : rr.value
        scenarioStatus = rr.status
      } catch (err) {
        pairsErrored++
        lastError = err instanceof Error ? err.message : String(err)
      }
      const baselineValue = baseline?.value ?? null
      const baselineStatus = baseline?.status ?? null
      let deltaPct: number | null = null
      if (baselineValue !== null && scenarioValue !== null && Math.abs(baselineValue) > 1e-9) {
        deltaPct = ((scenarioValue - baselineValue) / Math.abs(baselineValue)) * 100
      }
      const changed = baselineStatus !== null && scenarioStatus !== null && baselineStatus !== scenarioStatus
      deltas.push({
        companyId: co.id, companyCode: co.code, companyName: co.name,
        indicatorId: ind.id, code: ind.code,
        baselineValue, baselineStatus, scenarioValue, scenarioStatus, changed, deltaPct,
      })
      const w = ind.weight ?? undefined
      if (baselineStatus) baselineCells.push({ companyId: co.id, indicatorId: ind.id, value: baselineValue ?? 0, status: baselineStatus, weight: w })
      if (scenarioStatus) scenarioCells.push({ companyId: co.id, indicatorId: ind.id, value: scenarioValue ?? 0, status: scenarioStatus, weight: w })
    }
  }

  const ids = companies.map((c) => c.id)
  const baseLeaf = computeCompositeByCompany(baselineCells, ids)
  const scenLeaf = computeCompositeByCompany(scenarioCells, ids)
  const compArg = companies.map((c) => ({ id: c.id, parentCompanyId: c.parentCompanyId ?? null, revenue: c.revenue ?? null }))
  const baseAll = deriveParentComposites(compArg, baseLeaf)
  const scenAll = deriveParentComposites(compArg, scenLeaf)

  const byCompany: DriverCompositeSwing[] = companies.map((c) => ({
    companyId: c.id, companyCode: c.code,
    baselineScore: baseAll.get(c.id)?.score ?? null,
    scenarioScore: scenAll.get(c.id)?.score ?? null,
  }))

  const roots = companies.filter((c) => !c.parentCompanyId)
  const holdingId = roots.sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0]?.id ?? null
  const holdingBaselineScore = holdingId ? baseAll.get(holdingId)?.score ?? null : null
  const holdingScenarioScore = holdingId ? scenAll.get(holdingId)?.score ?? null : null

  let worsened = 0, improved = 0, changed = 0
  for (const d of deltas) {
    if (!d.changed || d.baselineStatus == null || d.scenarioStatus == null) continue
    changed++
    if (STATUS_ORDER[d.scenarioStatus] < STATUS_ORDER[d.baselineStatus]) worsened++
    else improved++
  }

  return {
    scenarioCode: scenario.code, period, deltas, byCompany,
    holdingBaselineScore, holdingScenarioScore, changed, worsened, improved,
    driftSummary: { pairsAttempted: companies.length * indicators.length, pairsErrored, lastError },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/risk/scenario-rederive.test.ts`
Expected: PASS (3 cases). If `parsePeriod`/types import path differs, confirm with `grep -n "export function parsePeriod" src/lib/risk/periods.ts` + `grep -n "RecomputeDataSource\|IndicatorDefinitionLike" src/lib/risk/recompute-types.ts` and fix imports (some live in `recompute.ts` — re-exported).

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/risk/scenario-rederive.ts src/lib/risk/scenario-rederive.test.ts
git commit -m "feat(scenario): simulateByDrivers B2 engine, revenue-weighted swing, no DB writes (Task 2)"
```

---

## Task 3: AI crisis-narrative generator

**Files:**
- Create: `src/lib/risk/scenario-narrative.ts`
- Test: `src/lib/risk/scenario-narrative.test.ts`

**Design:** mirror `variance-explainer.ts` — `SYSTEM_PROMPT`, pure `buildCrisisBriefPrompt`, pure `validateAndShape`, `runCrisisBrief(input, opts)` with `opts.client` seam + `max_tokens` guard + `extractJsonFromText`. Grounded: the prompt contains ONLY the computed numbers; the system prompt forbids inventing figures. Advisory-CFO tone, ⚠ lead (spec §8). For FX scenarios, the prompt passes the `assumedImportShare` so the narrative states the modeling assumption honestly. Output language EN/RU/AZ.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildCrisisBriefPrompt, runCrisisBrief, type CrisisBriefInput } from './scenario-narrative'

const input: CrisisBriefInput = {
  scenarioCode: 'INPUT_COST_30', scenarioNameEn: 'Input cost +30%', language: 'ru',
  holdingBaselineScore: 45, holdingScenarioScore: 31,
  worstHit: [{ companyCode: 'CPC', companyName: 'CPC', baselineScore: 49, scenarioScore: 28, topDeltas: [{ code: 'IND_EBITDA_MARGIN', baselineValue: 4.55, scenarioValue: -7.1 }] }],
  changed: 7, worsened: 6, improved: 1, assumptionNote: null,
}

describe('buildCrisisBriefPrompt', () => {
  it('includes the real swing numbers and forbids invention', () => {
    const p = buildCrisisBriefPrompt(input)
    expect(p).toContain('45'); expect(p).toContain('31'); expect(p).toContain('CPC'); expect(p).toContain('IND_EBITDA_MARGIN')
  })
  it('surfaces an assumption note when present (FX scenario)', () => {
    const p = buildCrisisBriefPrompt({ ...input, assumptionNote: 'Assumes 30% imported-input share' })
    expect(p).toContain('30% imported-input share')
  })
})

describe('runCrisisBrief', () => {
  it('returns narrative + mitigations from the injected client', async () => {
    const fakeClient = { messages: { create: vi.fn(async () => ({
      stop_reason: 'end_turn', model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: 'text', text: JSON.stringify({ narrative: '⚠ Рост входной стоимости обрушивает композит с 45 до 31.', mitigations: ['Хеджировать сырьё', 'Пересмотреть контракты', 'Поднять цены на 8%'], confidence: 0.7 }) }],
    })) } } as never
    const out = await runCrisisBrief(input, { client: fakeClient })
    expect(out.narrative).toContain('45'); expect(out.mitigations).toHaveLength(3); expect(out.modelName).toBe('claude-sonnet-4-5-20250929')
  })
  it('throws on max_tokens truncation', async () => {
    const fakeClient = { messages: { create: vi.fn(async () => ({ stop_reason: 'max_tokens', content: [] })) } } as never
    await expect(runCrisisBrief(input, { client: fakeClient })).rejects.toThrow(/max_tokens/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/risk/scenario-narrative.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Phase 1 "Crisis Brief" — grounded AI narrative. Mirrors variance-explainer.ts.
 * The prompt receives ONLY computed deltas + score swing; the system prompt
 * forbids inventing numbers. Advisory-CFO tone, ⚠ lead. EN/RU/AZ. When a
 * modeling assumption was made (FX assumedImportShare), it is stated honestly.
 */
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client'
import { extractJsonFromText } from '@/lib/onboarding/ai-mapper/json-extract'

export type BriefLanguage = 'en' | 'ru' | 'az'

export interface CrisisBriefWorstHit {
  companyCode: string; companyName: string
  baselineScore: number | null; scenarioScore: number | null
  topDeltas: Array<{ code: string; baselineValue: number; scenarioValue: number }>
}
export interface CrisisBriefInput {
  scenarioCode: string; scenarioNameEn: string; language: BriefLanguage
  holdingBaselineScore: number | null; holdingScenarioScore: number | null
  worstHit: CrisisBriefWorstHit[]
  changed: number; worsened: number; improved: number
  /** Honest modeling caveat surfaced verbatim (e.g. FX import-share assumption). */
  assumptionNote: string | null
}
export interface CrisisBriefOutput {
  narrative: string; mitigations: string[]; confidence: number
  modelName: string; promptVersion: string
  usage?: { inputTokens: number; outputTokens: number }
}

export const CRISIS_BRIEF_PROMPT_VERSION = 'v1'
const LANGUAGE_LABEL: Record<BriefLanguage, string> = { en: 'English', ru: 'Russian (Русский)', az: 'Azerbaijani (Azərbaycan dili)' }

const SYSTEM_PROMPT = `You are the CFO advisor for an Azerbaijani diversified holding. You are briefing the board on a SIMULATED crisis scenario. You receive ONLY pre-computed numbers (a holding composite-score swing + worst-hit companies + indicator deltas).

Produce:
  1. narrative — board-level, 3-5 sentences. LEAD with a ⚠ crisis framing and the holding composite swing (cite exact before→after). Then name the 1-3 worst-hit companies with their ACTUAL score drops + the key indicator that moved (cite real before→after). Advisory, serious, not pure alarmism. If an assumption note is provided, state it plainly.
  2. mitigations — 2-3 concrete moves the CFO can make THIS QUARTER. Specific verbs (hedge, renegotiate, pre-buy, raise prices, freeze capex, diversify supply). No "monitor"/"investigate".
  3. confidence — honest 0.0-1.0.

ABSOLUTE CONSTRAINTS:
  - Use ONLY the numbers provided. NEVER invent a figure, percentage, or company not in the input.
  - Output STRICT JSON only (no markdown): { "narrative": string, "mitigations": string[], "confidence": number }.
  - Write in the requested output language.`

const fmtScore = (s: number | null): string => (s == null ? 'n/a' : String(Math.round(s)))

export function buildCrisisBriefPrompt(input: CrisisBriefInput): string {
  const worstLines = input.worstHit.map((w) => {
    const deltas = w.topDeltas.map((d) => `${d.code}: ${d.baselineValue} → ${d.scenarioValue}`).join('; ')
    return `  ${w.companyCode} (${w.companyName}): composite ${fmtScore(w.baselineScore)} → ${fmtScore(w.scenarioScore)} | ${deltas || '(no indicator deltas)'}`
  }).join('\n')
  const assumption = input.assumptionNote ? `\nModeling assumption (state this in the narrative): ${input.assumptionNote}\n` : ''
  return `Scenario: ${input.scenarioCode} (${input.scenarioNameEn})

Holding composite score: ${fmtScore(input.holdingBaselineScore)} → ${fmtScore(input.holdingScenarioScore)}
Indicators changed status: ${input.changed} (worsened ${input.worsened}, improved ${input.improved})
${assumption}
Worst-hit companies (use these EXACT numbers, invent nothing):
${worstLines || '  (none)'}

Output language: ${LANGUAGE_LABEL[input.language]}.

Return STRICT JSON (no markdown):
{ "narrative": "⚠ ... 3-5 sentences citing only the numbers above", "mitigations": ["...","...","..."], "confidence": 0.0 }`
}

type ValidatedBody = Omit<CrisisBriefOutput, 'modelName' | 'promptVersion' | 'usage'>
function validateAndShape(parsed: unknown): ValidatedBody {
  if (parsed == null || typeof parsed !== 'object') throw new Error('Crisis brief: response is not a JSON object')
  const obj = parsed as Record<string, unknown>
  if (typeof obj.narrative !== 'string' || obj.narrative.trim() === '') throw new Error("Crisis brief: missing 'narrative'")
  if (!Array.isArray(obj.mitigations) || obj.mitigations.length === 0 || !obj.mitigations.every((m) => typeof m === 'string' && m.trim() !== '')) {
    throw new Error("Crisis brief: 'mitigations' must be a non-empty string array")
  }
  const mitigations = (obj.mitigations as string[]).slice(0, 3)
  const c = obj.confidence
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) throw new Error(`Crisis brief: 'confidence' must be in [0,1], got ${JSON.stringify(c)}`)
  return { narrative: obj.narrative.trim(), mitigations, confidence: c }
}

export interface RunCrisisBriefOptions { model?: string; maxTokens?: number; client?: ReturnType<typeof getAnthropicClient> }

export async function runCrisisBrief(input: CrisisBriefInput, opts: RunCrisisBriefOptions = {}): Promise<CrisisBriefOutput> {
  const client = opts.client ?? getAnthropicClient()
  const model = opts.model ?? AI_MODEL
  const maxTokens = opts.maxTokens ?? 8192 // RU/AZ board prose headroom (feedback_llm_max_tokens)
  const response = await client.messages.create({ model, max_tokens: maxTokens, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: buildCrisisBriefPrompt(input) }] })
  if (response.stop_reason === 'max_tokens') throw new Error(`Crisis brief truncated at max_tokens=${maxTokens}. Re-run higher.`)
  const textBlocks = response.content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text)
  if (textBlocks.length === 0) throw new Error('Crisis brief: response had no text content')
  const raw = textBlocks.join('\n').trim()
  const jsonText = extractJsonFromText(raw)
  if (!jsonText) throw new Error(`Crisis brief: no JSON in response. Raw: ${raw.slice(0, 200)}…`)
  let parsed: unknown
  try { parsed = JSON.parse(jsonText) } catch (err) { throw new Error(`Crisis brief: JSON parse error: ${err instanceof Error ? err.message : String(err)}`) }
  const body = validateAndShape(parsed)
  const out: CrisisBriefOutput = { ...body, modelName: response.model ?? model, promptVersion: CRISIS_BRIEF_PROMPT_VERSION }
  if (response.usage) out.usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/risk/scenario-narrative.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/risk/scenario-narrative.ts src/lib/risk/scenario-narrative.test.ts
git commit -m "feat(scenario): grounded AI crisis-narrative generator (Task 3)"
```

---

## Task 4: Extend simulate route with `?mode=drivers`

**Files:**
- Modify: `src/app/api/scenarios/[id]/simulate/route.ts`
- Test: `src/app/api/scenarios/[id]/simulate/route.drivers.test.ts`

**Behaviour:** when `?mode=drivers` AND the scenario `hasShock`, fetch companies (id/code/name/parentCompanyId/industry), active indicator defs, and baseline IVs **including `inputs`** for the period. **Derive revenue per company** as `MAX(inputs.resolved.revenue)` (NO `company.revenue` column). Run `simulateByDrivers`; build the FX `assumptionNote` when the scenario's shock has `fxShock` + `assumedImportShare`; attempt `runCrisisBrief` (top-3 worst-hit) — on AI failure return deltas + swing WITHOUT narrative (graceful degrade). `deltaMap` keys are `"companyId:code"`. Without `?mode=drivers` the legacy branch is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/api-auth', () => ({ requireAuth: vi.fn(async () => ({ orgId: 'org1', userId: 'u1' })), isAuthError: () => false }))
const findFirst = vi.fn(), companyFindMany = vi.fn(), indicatorFindMany = vi.fn(), ivFindMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: {
  scenario: { findFirst: (...a: unknown[]) => findFirst(...a) },
  company: { findMany: (...a: unknown[]) => companyFindMany(...a) },
  indicatorDefinition: { findMany: (...a: unknown[]) => indicatorFindMany(...a) },
  indicatorValue: { findMany: (...a: unknown[]) => ivFindMany(...a) },
} }))
vi.mock('@/lib/risk/recompute', () => ({ createPrismaDataSource: () => ({}) }))
const simulateByDrivers = vi.fn()
vi.mock('@/lib/risk/scenario-rederive', () => ({ simulateByDrivers: (...a: unknown[]) => simulateByDrivers(...a) }))
const runCrisisBrief = vi.fn()
vi.mock('@/lib/risk/scenario-narrative', () => ({ runCrisisBrief: (...a: unknown[]) => runCrisisBrief(...a) }))
vi.mock('@/lib/ai/client', () => ({ hasAnthropicKey: () => true }))
import { GET } from './route'
const req = (url: string) => new Request(url) as never

describe('GET simulate ?mode=drivers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('derives revenue from inputs.resolved.revenue + runs sim + narrative', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'INPUT_COST_30', nameEn: 'Input +30%', nameRu: 'Стоимость +30%', overrides: { shock: { inputCostShock: 0.3 } } })
    companyFindMany.mockResolvedValue([{ id: 'c1', code: 'CPC', name: 'CPC', parentCompanyId: 'p1', industry: 'food_processing' }, { id: 'p1', code: 'AZSEKER', name: 'Holding', parentCompanyId: null, industry: null }])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'IND_EBITDA_MARGIN', formula: 'ebitda/revenue*100', thresholds: {}, requiredInputs: ['budgetLine'], weight: 1.5 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 4.5, status: 'red', inputs: { resolved: { revenue: 6475882 } } }])
    simulateByDrivers.mockResolvedValue({ scenarioCode: 'INPUT_COST_30', period: '2026', deltas: [{ companyId: 'c1', companyCode: 'CPC', companyName: 'CPC', indicatorId: 'i1', code: 'IND_EBITDA_MARGIN', baselineValue: 4.5, baselineStatus: 'red', scenarioValue: -7, scenarioStatus: 'red', changed: false, deltaPct: -255 }], byCompany: [{ companyId: 'c1', companyCode: 'CPC', baselineScore: 49, scenarioScore: 28 }], holdingBaselineScore: 45, holdingScenarioScore: 31, changed: 1, worsened: 1, improved: 0, driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null } })
    runCrisisBrief.mockResolvedValue({ narrative: '⚠ 45→31', mitigations: ['hedge'], confidence: 0.7, modelName: 'sonnet', promptVersion: 'v1' })

    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers&period=2026'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.holdingScenarioScore).toBe(31)
    expect(body.narrative).toContain('45→31')
    // revenue derived from inputs.resolved.revenue and passed into the engine
    const passedCompanies = (simulateByDrivers.mock.calls[0][1] as { companies: Array<{ id: string; revenue: number | null }> }).companies
    expect(passedCompanies.find((c) => c.id === 'c1')!.revenue).toBe(6475882)
  })

  it('graceful degrade: AI throws → 200 with narrative=null + narrativeError', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'INPUT_COST_30', nameEn: 'x', overrides: { shock: { inputCostShock: 0.3 } } })
    companyFindMany.mockResolvedValue([{ id: 'c1', code: 'CPC', name: 'CPC', parentCompanyId: null, industry: null }])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'X', formula: 'x', thresholds: {}, requiredInputs: [], weight: 1 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 1, status: 'green', inputs: { resolved: { revenue: 1 } } }])
    simulateByDrivers.mockResolvedValue({ scenarioCode: 'X', period: '2026', deltas: [], byCompany: [], holdingBaselineScore: 45, holdingScenarioScore: 31, changed: 0, worsened: 0, improved: 0, driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null } })
    runCrisisBrief.mockRejectedValue(new Error('LLM down'))
    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200); expect(body.holdingScenarioScore).toBe(31); expect(body.narrative).toBeNull(); expect(body.narrativeError).toBeTruthy()
  })

  it('422 when ?mode=drivers but scenario has no shock', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'X', nameEn: 'x', overrides: { adjustments: [] } })
    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers'), { params: Promise.resolve({ id: 's1' }) } as never)
    expect(res.status).toBe(422)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/api/scenarios/[id]/simulate/route.drivers.test.ts"`
Expected: FAIL — drivers branch absent.

- [ ] **Step 3: Add the drivers branch**

Imports to add at the top of the route:

```ts
import { createPrismaDataSource } from '@/lib/risk/recompute'
import { hasShock, readShock } from '@/lib/risk/scenario-shock'
import { simulateByDrivers } from '@/lib/risk/scenario-rederive'
import { runCrisisBrief, type BriefLanguage } from '@/lib/risk/scenario-narrative'
import { hasAnthropicKey } from '@/lib/ai/client'
```

After the scenario fetch + null guard, before the legacy `adjustments` guard, insert:

```ts
  const mode = searchParams.get('mode')
  const language = (searchParams.get('lang') as BriefLanguage | null) ?? 'ru'

  if (mode === 'drivers') {
    if (!hasShock(scenario.overrides)) {
      return NextResponse.json({ error: 'Scenario has no `shock` block — run the default multiplier simulate (omit ?mode=drivers).' }, { status: 422 })
    }
    const [companies, indicators, baselineRows] = await Promise.all([
      prisma.company.findMany({ where: { organizationId: session.orgId }, select: { id: true, code: true, name: true, parentCompanyId: true, industry: true } }),
      prisma.indicatorDefinition.findMany({ where: { isActive: true }, select: { id: true, code: true, formula: true, thresholds: true, requiredInputs: true, weight: true } }),
      prisma.indicatorValue.findMany({ where: { organizationId: session.orgId, period }, select: { companyId: true, indicatorId: true, value: true, status: true, inputs: true } }),
    ])

    // Derive revenue per company = MAX(inputs.resolved.revenue) — NO company.revenue column (spec §B).
    const revenueByCompanyId = new Map<string, number>()
    for (const r of baselineRows) {
      const rev = (r.inputs as { resolved?: { revenue?: unknown } } | null)?.resolved?.revenue
      if (typeof rev === 'number' && Number.isFinite(rev)) {
        const cur = revenueByCompanyId.get(r.companyId) ?? -Infinity
        if (rev > cur) revenueByCompanyId.set(r.companyId, rev)
      }
    }

    const ds = createPrismaDataSource(prisma)
    const sim = await simulateByDrivers(ds, {
      organizationId: session.orgId,
      scenario: { code: scenario.code, overrides: scenario.overrides },
      period,
      companies: companies.map((c) => ({ id: c.id, code: c.code ?? c.id, name: c.name, parentCompanyId: c.parentCompanyId, industry: c.industry, revenue: revenueByCompanyId.get(c.id) ?? 0 })),
      indicators: indicators.map((i) => ({ id: i.id, code: i.code, formula: i.formula, thresholds: i.thresholds, requiredInputs: i.requiredInputs ?? [], weight: i.weight ?? null })),
      baselineIVs: baselineRows.map((iv) => ({ companyId: iv.companyId, indicatorId: iv.indicatorId, value: iv.value, status: iv.status as never })),
    })

    const deltaMap: Record<string, string> = {}
    for (const d of sim.deltas) if (d.changed && d.scenarioStatus) deltaMap[`${d.companyId}:${d.code}`] = d.scenarioStatus

    // FX assumption note (honest caveat for the narrative).
    const shock = readShock(scenario.overrides)
    const assumptionNote = shock?.fxShock && shock?.assumedImportShare
      ? `Assumes ${Math.round((shock.assumedImportShare ?? 0) * 100)}% imported-input share (current data has no tagged imported costs).`
      : null

    let narrative: string | null = null, mitigations: string[] = [], narrativeError: string | null = null
    if (hasAnthropicKey()) {
      try {
        const deltasByCo = new Map<string, typeof sim.deltas>()
        for (const d of sim.deltas) { if (!d.changed) continue; const l = deltasByCo.get(d.companyId) ?? []; l.push(d); deltasByCo.set(d.companyId, l) }
        const worstHit = sim.byCompany
          .filter((b) => b.baselineScore != null && b.scenarioScore != null && b.scenarioScore < b.baselineScore)
          .sort((a, b) => (a.scenarioScore! - a.baselineScore!) - (b.scenarioScore! - b.baselineScore!))
          .slice(0, 3)
          .map((b) => {
            const co = companies.find((c) => c.id === b.companyId)
            const topDeltas = (deltasByCo.get(b.companyId) ?? []).filter((d) => d.baselineValue != null && d.scenarioValue != null).slice(0, 2).map((d) => ({ code: d.code, baselineValue: d.baselineValue!, scenarioValue: d.scenarioValue! }))
            return { companyCode: co?.code ?? b.companyId, companyName: co?.name ?? b.companyId, baselineScore: b.baselineScore, scenarioScore: b.scenarioScore, topDeltas }
          })
        const brief = await runCrisisBrief({ scenarioCode: scenario.code, scenarioNameEn: scenario.nameEn, language, holdingBaselineScore: sim.holdingBaselineScore, holdingScenarioScore: sim.holdingScenarioScore, worstHit, changed: sim.changed, worsened: sim.worsened, improved: sim.improved, assumptionNote })
        narrative = brief.narrative; mitigations = brief.mitigations
      } catch (err) { narrativeError = err instanceof Error ? err.message : String(err) }
    } else { narrativeError = 'No Anthropic API key configured — narrative skipped.' }

    return NextResponse.json({
      mode: 'drivers', scenarioId: scenario.id, scenarioCode: scenario.code,
      scenarioNameRu: scenario.nameRu ?? scenario.nameEn, scenarioNameEn: scenario.nameEn, period: sim.period,
      deltas: sim.deltas, byCompany: sim.byCompany, deltaMap,
      holdingBaselineScore: sim.holdingBaselineScore, holdingScenarioScore: sim.holdingScenarioScore,
      changed: sim.changed, worsened: sim.worsened, improved: sim.improved, driftSummary: sim.driftSummary,
      assumptionNote, narrative, mitigations, narrativeError,
    })
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/api/scenarios/[id]/simulate/route.drivers.test.ts"`
Expected: PASS (3 cases).

- [ ] **Step 5: Legacy path still green + tsc + commit**

```bash
npx vitest run "src/app/api/scenarios" && npx tsc --noEmit
git add "src/app/api/scenarios/[id]/simulate/route.ts" "src/app/api/scenarios/[id]/simulate/route.drivers.test.ts"
git commit -m "feat(scenario): /simulate?mode=drivers — revenue from inputs.resolved, graceful narrative degrade (Task 4)"
```

---

## Task 5: `terminalStore` scenario-brief slice

**Files:**
- Modify: `src/features/terminal/store/terminalStore.ts`
- Test: `src/features/terminal/store/terminalStore.scenario-brief.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useTerminalStore } from './terminalStore'

describe('terminalStore scenarioBrief', () => {
  beforeEach(() => { useTerminalStore.getState().resetTerminal?.() })
  it('setScenarioBrief stores; clearScenarioBrief clears', () => {
    const s = useTerminalStore.getState()
    s.setScenarioBrief({ scenarioCode: 'INPUT_COST_30', holdingBaselineScore: 45, holdingScenarioScore: 31, byCompany: [{ companyId: 'c1', companyCode: 'CPC', baselineScore: 49, scenarioScore: 28 }], narrative: '⚠ ...', mitigations: ['hedge'], cascadeOrder: ['c1:IND_EBITDA_MARGIN'] })
    expect(useTerminalStore.getState().scenarioBrief?.holdingScenarioScore).toBe(31)
    s.clearScenarioBrief(); expect(useTerminalStore.getState().scenarioBrief).toBeNull()
  })
  it('clearScenarioDelta also clears the brief', () => {
    const s = useTerminalStore.getState()
    s.setScenarioBrief({ scenarioCode: 'X', holdingBaselineScore: 45, holdingScenarioScore: 31, byCompany: [], narrative: null, mitigations: [], cascadeOrder: [] })
    s.clearScenarioDelta(); expect(useTerminalStore.getState().scenarioBrief).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/terminal/store/terminalStore.scenario-brief.test.ts`
Expected: FAIL — `setScenarioBrief is not a function`.

- [ ] **Step 3: Implement the slice**

Add the type near the `scenarioDelta` doc (~line 128):
```ts
export interface ScenarioBriefState {
  scenarioCode: string
  holdingBaselineScore: number | null
  holdingScenarioScore: number | null
  byCompany: Array<{ companyId: string; companyCode: string; baselineScore: number | null; scenarioScore: number | null }>
  narrative: string | null
  mitigations: string[]
  cascadeOrder: string[]
}
```
Add to the state interface (near `scenarioDelta: ... | null;` ~132): `scenarioBrief: ScenarioBriefState | null;`
Add to the actions interface (near `setScenarioDelta` ~197):
```ts
  setScenarioBrief: (brief: ScenarioBriefState | null) => void;
  clearScenarioBrief: () => void;
```
Add to initial state (near `scenarioDelta: null,` ~282): `scenarioBrief: null,`
Replace `clearScenarioDelta` (~438) and add the new actions (near `setScenarioDelta` ~436):
```ts
  setScenarioBrief: (brief) => setGlobalState({ scenarioBrief: brief }),
  clearScenarioBrief: () => setGlobalState({ scenarioBrief: null }),
  clearScenarioDelta: () => setGlobalState({ scenarioDelta: null, activeScenarioLabel: null, scenarioBrief: null }),
```
Add `scenarioBrief: null` to the `resetTerminal` reset block (~470).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/terminal/store/terminalStore.scenario-brief.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/features/terminal/store/terminalStore.ts src/features/terminal/store/terminalStore.scenario-brief.test.ts
git commit -m "feat(scenario): terminalStore scenarioBrief slice (Task 5)"
```

---

## Task 6a: `orderCascade` pure helper

**Files:**
- Create: `src/features/terminal/lib/cascade-order.ts`
- Test: `src/features/terminal/lib/cascade-order.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { orderCascade } from './cascade-order'

describe('orderCascade', () => {
  it('orders changed cells worst-first (red→amber→green), only changed', () => {
    expect(orderCascade([
      { companyId: 'c1', code: 'A', scenarioStatus: 'amber', changed: true },
      { companyId: 'c2', code: 'B', scenarioStatus: 'red', changed: true },
      { companyId: 'c3', code: 'C', scenarioStatus: 'green', changed: false },
      { companyId: 'c4', code: 'D', scenarioStatus: 'green', changed: true },
    ])).toEqual(['c2:B', 'c1:A', 'c4:D'])
  })
  it('returns [] for no changes', () => {
    expect(orderCascade([{ companyId: 'c1', code: 'A', scenarioStatus: 'green', changed: false }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/terminal/lib/cascade-order.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/** Worst-first cascade ordering for the scenario reflow. Only CHANGED cells
 *  participate; red leads, then amber, then green/unknown. Returns
 *  "companyId:code" keys in flip order. Pure. */
type DeltaLite = { companyId: string; code: string; scenarioStatus: string | null; changed: boolean }
const RANK: Record<string, number> = { red: 0, amber: 1, green: 2, unknown: 3 }
export function orderCascade(deltas: DeltaLite[]): string[] {
  return deltas
    .filter((d) => d.changed && d.scenarioStatus)
    .sort((a, b) => (RANK[a.scenarioStatus!] ?? 9) - (RANK[b.scenarioStatus!] ?? 9))
    .map((d) => `${d.companyId}:${d.code}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/terminal/lib/cascade-order.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/lib/cascade-order.ts src/features/terminal/lib/cascade-order.test.ts
git commit -m "feat(scenario): worst-first cascade-order helper (Task 6a)"
```

---

## Task 6b: ScenarioPanel — drivers mode, cascade, score tween, narrative stream, revert

**Files:**
- Modify: `src/features/terminal/components/ScenarioPanel.tsx`

**Reference `public/crisis-mockup.html` for visual + pacing.** Cascade per-cell delay = `clamp(round(1800 / max(cascadeOrder.length,1)), 35, 120)` ms (target full reflow ≈ 1.5–2.5s).

- [ ] **Step 1: Imports + drivers fetch.** Add `import { orderCascade } from '../lib/cascade-order'`; pull `setScenarioBrief`/`scenarioBrief` from the store; add `const [aiLang, setAiLang] = useState<'en'|'ru'|'az'>('ru')` and a small EN/RU/AZ selector (per `project_ai_output_language`). Add a `▶ Запустить кризис` button shown when the selected scenario has a `shock` (`!!(selectedScenario.overrides as { shock?: unknown }).shock`). New handler:

```ts
const runDrivers = useCallback(async () => {
  if (!selectedScenario) return
  setSimState({ kind: 'loading' })
  try {
    const res = await fetch(`/api/scenarios/${selectedScenario.id}/simulate?mode=drivers&period=${period}&lang=${aiLang}`)
    if (res.status === 422) { setSimState({ kind: 'unsupported' }); return }
    if (!res.ok) throw new Error(`simulate ${res.status}`)
    const data = await res.json()
    setScenarioBrief({
      scenarioCode: data.scenarioCode, holdingBaselineScore: data.holdingBaselineScore, holdingScenarioScore: data.holdingScenarioScore,
      byCompany: data.byCompany ?? [], narrative: data.narrative ?? null, mitigations: data.mitigations ?? [],
      cascadeOrder: orderCascade(data.deltas ?? []),
    })
    setSimState({ kind: 'done', result: data })
  } catch (e) { setSimState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }) }
}, [selectedScenario, period, aiLang, setScenarioBrief])
```

- [ ] **Step 2: Score-swing tween.** Add the hook + sub-component (rendered when `scenarioBrief` is set):

```tsx
function useCountTween(target: number | null, durationMs = 900): number | null {
  const [v, setV] = useState<number | null>(target)
  const fromRef = useRef<number | null>(target)
  useEffect(() => {
    if (target == null) { setV(null); return }
    const from = fromRef.current ?? target; const start = performance.now(); let raf = 0
    const step = (t: number) => { const p = Math.min(1, (t - start) / durationMs); const e = 1 - Math.pow(1 - p, 3); setV(Math.round(from + (target - from) * e)); if (p < 1) raf = requestAnimationFrame(step); else fromRef.current = target }
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf)
  }, [target, durationMs]); return v
}
function bandColor(s: number | null): string { if (s == null) return 'text-muted-foreground'; if (s >= 67) return 'text-emerald-500'; if (s >= 34) return 'text-[#FFB800]'; return 'text-red-500' }
function HoldingScoreSwing({ base, scen }: { base: number | null; scen: number | null }) {
  const shown = useCountTween(scen); const drop = base != null && scen != null ? scen - base : null
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-muted-foreground">Композит холдинга</span>
      <span className="text-sm text-muted-foreground line-through">{base ?? '—'}</span>
      <span className={`text-3xl font-bold tabular-nums transition-colors ${bandColor(shown)}`}>{shown ?? '—'}</span>
      {drop != null && drop !== 0 && (<span className={`text-sm font-semibold ${drop < 0 ? 'text-red-500' : 'text-emerald-500'}`}>{drop < 0 ? '▼' : '▲'} {Math.abs(drop)}</span>)}
    </div>
  )
}
```

- [ ] **Step 3: Cascade — stagger the HeatMap overlay worst-first.** Effect keyed on `scenarioBrief?.scenarioCode`:

```ts
const scenarioBrief = useTerminalStore((s) => s.scenarioBrief)
useEffect(() => {
  if (!scenarioBrief || simState.kind !== 'done') return
  const full = (simState.result as { deltaMap?: Record<string, string> }).deltaMap ?? {}
  const order = scenarioBrief.cascadeOrder; if (order.length === 0) return
  const perCell = Math.min(120, Math.max(35, Math.round(1800 / order.length)))
  let i = 0; setScenarioDelta(new Map(), scenarioBrief.scenarioCode)
  let timer = 0
  const tick = () => {
    i++; const partial = new Map<string, string>()
    for (let k = 0; k < i && k < order.length; k++) { const key = order[k]; if (full[key]) partial.set(key, full[key]) }
    setScenarioDelta(partial, scenarioBrief.scenarioCode)
    if (i < order.length) timer = window.setTimeout(tick, perCell)
  }
  timer = window.setTimeout(tick, perCell)
  return () => window.clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [scenarioBrief?.scenarioCode])
```

- [ ] **Step 4: Narrative line-by-line reveal (tag-safe — the mockup fix).**

```tsx
function NarrativeStream({ text }: { text: string }) {
  const lines = useMemo(() => text.split(/(?<=[.!?])\s+/).filter(Boolean), [text])
  const [shown, setShown] = useState(0)
  useEffect(() => { setShown(0); if (lines.length === 0) return; let i = 0; const id = window.setInterval(() => { i++; setShown(i); if (i >= lines.length) window.clearInterval(id) }, 420); return () => window.clearInterval(id) }, [lines])
  return <p className="text-sm leading-relaxed">{lines.slice(0, shown).join(' ')}</p>
}
```
Render `scenarioBrief.narrative` via `<NarrativeStream>` when present; when null show «AI-нарратив недоступен — см. дельты ниже». Render `mitigations` as a list. If `data.assumptionNote` is present, render it as a muted caveat line under the narrative.

- [ ] **Step 5: Revert.** Confirm the "× Baseline" control calls `clearScenarioDelta()` (Task 5 made it also null `scenarioBrief`). Add a revert button in the brief panel calling `clearScenarioDelta()` if not already present.

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit
git add src/features/terminal/components/ScenarioPanel.tsx
git commit -m "feat(scenario): ScenarioPanel drivers mode — cascade, score tween, narrative stream, revert (Task 6b)"
```

---

## Task 7: Author + seed the scenario catalog as shocks (3 flagships validated FIRST)

**Files:**
- Create: `scripts/seed-crisis-scenarios.ts`
- Test: `scripts/seed-crisis-scenarios.test.ts`

**Author the 3 user-selected flagships first (spec §B.3), then the rest of the §A catalog re-expressed as shocks.** Confirm `Scenario` column names against the schema before seeding (Step 6).

- [ ] **Step 1: Write the catalog + a well-formedness test**

```ts
import { describe, it, expect } from 'vitest'
import { CRISIS_CATALOG } from './seed-crisis-scenarios'
import { hasShock } from '@/lib/risk/scenario-shock'

describe('CRISIS_CATALOG', () => {
  it('every entry has a unique code + a well-formed shock', () => {
    const codes = new Set(CRISIS_CATALOG.map((s) => s.code))
    expect(codes.size).toBe(CRISIS_CATALOG.length)
    for (const s of CRISIS_CATALOG) {
      expect(hasShock({ shock: s.shock })).toBe(true)
      expect(s.category).toBeTruthy(); expect(s.nameEn && s.nameRu && s.nameAz).toBeTruthy()
    }
  })
  it('the 3 flagships are present + marked', () => {
    const flags = CRISIS_CATALOG.filter((s) => s.flagship).map((s) => s.code)
    expect(flags).toEqual(expect.arrayContaining(['INPUT_COST_30', 'REVENUE_DROP_30', 'AZN_DEVAL_20']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/seed-crisis-scenarios.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the catalog + seeding script**

```ts
/**
 * Phase 1 "Crisis Brief" — scenario catalog as B2 economic shocks (spec §B).
 * Upserts Scenario.overrides.shock (JSON), preserving any legacy adjustments.
 * Run: (sandbox off) npx tsx scripts/seed-crisis-scenarios.ts
 */
import { prisma } from '@/lib/prisma'
import type { ScenarioShock } from '@/lib/risk/scenario-shock'

export type CrisisCategory = 'fx_macro' | 'commodity' | 'climate_agro' | 'geopolitics' | 'customers'
export interface CrisisCatalogEntry {
  code: string; category: CrisisCategory; flagship?: boolean
  nameEn: string; nameRu: string; nameAz: string; description: string; shock: ScenarioShock
}

export const CRISIS_CATALOG: CrisisCatalogEntry[] = [
  // ── 3 flagships (spec §B.3) ──
  { code: 'INPUT_COST_30', category: 'commodity', flagship: true, nameEn: 'Input cost +30%', nameRu: 'Рост входной стоимости +30%', nameAz: 'Giriş xərcləri +30%', description: 'Input cost +30% (FX-import / sugar / grain) → margins compress across food-processing.', shock: { inputCostShock: 0.30 } },
  { code: 'REVENUE_DROP_30', category: 'climate_agro', flagship: true, nameEn: 'Revenue −30% (drought / lost customer)', nameRu: 'Падение выручки −30% (засуха / потеря клиента)', nameAz: 'Gəlir −30% (quraqlıq / müştəri itkisi)', description: 'Sales volume −30% → revenue + revenue-per-ha + yield fall.', shock: { revenueShock: -0.30, yieldShock: -0.30 } },
  { code: 'AZN_DEVAL_20', category: 'fx_macro', flagship: true, nameEn: 'AZN devaluation −20%', nameRu: 'Девальвация маната −20%', nameAz: 'Manatın −20% devalvasiyası', description: 'AZN −20% → cost rises on the assumed 30% imported-input share.', shock: { fxShock: 0.20, assumedImportShare: 0.30 } },
  // ── secondary catalog (severity tails + categories) ──
  { code: 'INPUT_COST_50', category: 'commodity', nameEn: 'Input cost +50% (severe)', nameRu: 'Входная стоимость +50% (тяжёлый)', nameAz: 'Giriş xərcləri +50%', description: 'Severe input-cost tail.', shock: { inputCostShock: 0.50 } },
  { code: 'PRICE_DROP_20', category: 'commodity', nameEn: 'Selling price −20%', nameRu: 'Цена реализации −20%', nameAz: 'Satış qiyməti −20%', description: 'Output price −20% (sugar/commodity) → margin compresses.', shock: { priceShock: -0.20 } },
  { code: 'PRICE_DROP_40', category: 'commodity', nameEn: 'Price crash −40%', nameRu: 'Обвал цены −40%', nameAz: 'Qiymət çöküşü −40%', description: 'Severe price-crash tail.', shock: { priceShock: -0.40 } },
  { code: 'REVENUE_DROP_50', category: 'climate_agro', nameEn: 'Severe drought — revenue −50%', nameRu: 'Сильная засуха — выручка −50%', nameAz: 'Güclü quraqlıq — gəlir −50%', description: 'Extreme volume tail.', shock: { revenueShock: -0.50, yieldShock: -0.50 } },
  { code: 'REVENUE_DROP_20', category: 'customers', nameEn: 'Lose major customer −20%', nameRu: 'Потеря крупного клиента −20%', nameAz: 'Böyük müştəri itkisi −20%', description: 'Top-customer loss → volume −20%.', shock: { revenueShock: -0.20 } },
  { code: 'AZN_DEVAL_15', category: 'fx_macro', nameEn: 'AZN devaluation −15%', nameRu: 'Девальвация маната −15%', nameAz: 'Manatın −15% devalvasiyası', description: 'Milder FX shock on the assumed import share.', shock: { fxShock: 0.15, assumedImportShare: 0.30 } },
  { code: 'STAGFLATION', category: 'fx_macro', nameEn: 'Stagflation (cost +25%, revenue −15%)', nameRu: 'Стагфляция (стоимость +25%, выручка −15%)', nameAz: 'Staqflyasiya', description: 'Combined cost-push + demand-drop.', shock: { inputCostShock: 0.25, revenueShock: -0.15 } },
  { code: 'IRAN_SANCTIONS', category: 'geopolitics', nameEn: 'Iran sanctions tighten', nameRu: 'Ужесточение санкций по Ирану', nameAz: 'İran sanksiyalarının sərtləşməsi', description: 'FX + cost pressure (assumed import share).', shock: { fxShock: 0.12, assumedImportShare: 0.30, inputCostShock: 0.10 } },
  { code: 'BORDER_CLOSURE', category: 'geopolitics', nameEn: 'Export/border closure', nameRu: 'Закрытие границы/экспорта', nameAz: 'Sərhəd/ixrac bağlanması', description: 'Exporter volume −25%.', shock: { revenueShock: -0.25 } },
]

async function main() {
  const org = await prisma.organization.findFirstOrThrow()
  for (const s of CRISIS_CATALOG) {
    const existing = await prisma.scenario.findFirst({ where: { organizationId: org.id, code: s.code } })
    const legacy = (existing?.overrides as { adjustments?: unknown } | null)?.adjustments
    const overrides = { shock: s.shock, ...(legacy ? { adjustments: legacy } : {}) }
    if (existing) await prisma.scenario.update({ where: { id: existing.id }, data: { overrides, nameEn: s.nameEn, nameRu: s.nameRu, nameAz: s.nameAz, description: s.description, isActive: true } })
    else await prisma.scenario.create({ data: { organizationId: org.id, code: s.code, nameEn: s.nameEn, nameRu: s.nameRu, nameAz: s.nameAz, description: s.description, overrides, isActive: true } })
    console.log(`upserted ${s.code}`)
  }
  await prisma.$disconnect()
}
if (process.argv[1]?.includes('seed-crisis-scenarios')) main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/seed-crisis-scenarios.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Confirm Scenario column names, then seed**

Run: `grep -nA22 "model Scenario" prisma/schema.prisma` — confirm `code/nameEn/nameRu/nameAz/description/overrides/isActive/organizationId`. Fix the script to match if any differ. Then (sandbox off):
```bash
set -a; source .env; set +a
npx tsx scripts/seed-crisis-scenarios.ts
```
Expected: one "upserted …" line per entry.

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit
git add scripts/seed-crisis-scenarios.ts scripts/seed-crisis-scenarios.test.ts
git commit -m "feat(scenario): crisis catalog as B2 economic shocks, 3 flagships (Task 7)"
```

---

## Task 8 (MANDATORY GATE): Financial-correctness verification + testing

> The user is NOT a finance expert and cannot validate the numbers himself. This makes "the numbers must be right, not just dramatic" an executable gate. Do NOT declare done until every check passes.

**Files:**
- Create: `src/lib/risk/scenario-rederive.integration.test.ts` (real DB, gated by `DATABASE_URL`)
- Create: `docs/superpowers/specs/2026-05-30-crisis-brief-fin-correctness.md` (checklist + recorded results)

### 8.1 — P&L recompute consistency (unit, exact math)
- [ ] Already covered by Task 1 tests (`new_gross_profit = new_revenue − new_cogs`, etc.). Add one combined-shock case asserting consistency under `{ inputCostShock: 0.25, revenueShock: -0.15 }` (stagflation): verify `gross_profit = revenue·0.85 − (cogs·0.85 + cogs·0.25)` and `ebitda = gross_profit − opex`. Run `npx vitest run src/lib/risk/scenario-shock.test.ts`.

### 8.2 — Economically-sane direction + magnitude (live DB integration)
- [ ] **Step 1:** Write the integration test:

```ts
import { describe, it, expect } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createPrismaDataSource } from '@/lib/risk/recompute'
import { simulateByDrivers } from '@/lib/risk/scenario-rederive'

const RUN = !!process.env.DATABASE_URL
const d = RUN ? describe : describe.skip

d('simulateByDrivers — financial correctness (live DB)', () => {
  const prisma = new PrismaClient(); const period = '2026'
  async function load(code: string) {
    const org = await prisma.organization.findFirstOrThrow()
    const scenario = await prisma.scenario.findFirstOrThrow({ where: { organizationId: org.id, code } })
    const companies = await prisma.company.findMany({ where: { organizationId: org.id }, select: { id: true, code: true, name: true, parentCompanyId: true, industry: true } })
    const indicators = (await prisma.indicatorDefinition.findMany({ where: { isActive: true }, select: { id: true, code: true, formula: true, thresholds: true, requiredInputs: true, weight: true } })).map((i) => ({ ...i, requiredInputs: i.requiredInputs ?? [], weight: i.weight ?? null }))
    const rows = await prisma.indicatorValue.findMany({ where: { organizationId: org.id, period }, select: { companyId: true, indicatorId: true, value: true, status: true, inputs: true } })
    const revByCo = new Map<string, number>()
    for (const r of rows) { const rev = (r.inputs as { resolved?: { revenue?: unknown } } | null)?.resolved?.revenue; if (typeof rev === 'number' && rev > (revByCo.get(r.companyId) ?? -Infinity)) revByCo.set(r.companyId, rev) }
    return { org, scenario, companies: companies.map((c) => ({ ...c, revenue: revByCo.get(c.id) ?? 0 })), indicators, baselineIVs: rows.map((iv) => ({ companyId: iv.companyId, indicatorId: iv.indicatorId, value: iv.value, status: iv.status as never })) }
  }

  it('INPUT_COST_30: margins WORSEN, holding does NOT improve, swing material but ≤40pts', async () => {
    const { org, scenario, companies, indicators, baselineIVs } = await load('INPUT_COST_30')
    const r = await simulateByDrivers(createPrismaDataSource(prisma), { organizationId: org.id, scenario: { code: scenario.code, overrides: scenario.overrides }, period, companies, indicators, baselineIVs })
    expect(r.worsened).toBeGreaterThan(0)
    if (r.holdingBaselineScore != null && r.holdingScenarioScore != null) {
      expect(r.holdingScenarioScore).toBeLessThanOrEqual(r.holdingBaselineScore + 1)
      expect(r.holdingBaselineScore - r.holdingScenarioScore).toBeLessThanOrEqual(40)
    }
  }, 120_000)

  it('REVENUE_DROP_30: agro revenue-per-ha/yield worsen; holding does not improve', async () => {
    const { org, scenario, companies, indicators, baselineIVs } = await load('REVENUE_DROP_30')
    const r = await simulateByDrivers(createPrismaDataSource(prisma), { organizationId: org.id, scenario: { code: scenario.code, overrides: scenario.overrides }, period, companies, indicators, baselineIVs })
    expect(r.worsened).toBeGreaterThanOrEqual(0)
    if (r.holdingBaselineScore != null && r.holdingScenarioScore != null) expect(r.holdingScenarioScore).toBeLessThanOrEqual(r.holdingBaselineScore + 1)
  }, 120_000)
})
```

- [ ] **Step 2:** Run (sandbox off): `set -a; source .env; set +a; npx vitest run src/lib/risk/scenario-rederive.integration.test.ts`. Expected: PASS. Record the holding swing + worsened count per scenario in the fin-correctness doc. **Gate:** INPUT_COST_30 must produce `worsened > 0` and a visible holding drop; if not, the scalar override names are wrong — recheck §B.

### 8.3 — DB cross-check (baseline == on-screen)
- [ ] **Step 1:** In the integration test, assert that `r.deltas[*].baselineValue` equals the persisted `indicator_values.value` for the same (company, indicator) within 1e-6 (it's passed straight through). This proves the delta the CFO sees starts from the real on-screen number. Record the match rate.

### 8.4 — No DB writes (proof)
- [ ] **Step 1:** Unit test (Task 2) proves no writes via the throwing proxy DS. In the integration test, capture `prisma.indicatorValue.count()` + `MAX(updatedAt)` for the period before/after `simulateByDrivers` and assert unchanged. Record counts.

### 8.5 — Holding-swing Σ-math
- [ ] Covered by Task 2 Step 1 case 3 (revenue-weighted parent = 83 on a hand fixture). Confirm it passes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/risk/scenario-rederive.integration.test.ts docs/superpowers/specs/2026-05-30-crisis-brief-fin-correctness.md src/lib/risk/scenario-shock.test.ts
git commit -m "test(scenario): financial-correctness gate — P&L consistency, direction, DB cross-check, no-writes, Σ-math (Task 8)"
```

---

## Task 9 (MANDATORY GATE): UX/UI review

> Visual reference: `public/crisis-mockup.html`. Per `feedback_no_screenshot_lies.md`: never claim something is visible without naming the exact element/coordinate; cross-check the accessibility tree.

**Files:**
- Create: `docs/superpowers/specs/2026-05-30-crisis-brief-ux-review.md`

- [ ] **Step 1:** Restart the dev server (sandbox off): `launchctl kickstart -k gui/501/com.budgetpro.dev`, wait ~5s.
- [ ] **Step 2:** Navigate to `http://localhost:3000/budgeting/terminal`, open the Scenario panel, select `INPUT_COST_30`, click "▶ Запустить кризис" (Chrome MCP or Playwright).
- [ ] **Step 3:** Score the rubric — record a concrete observation (element + what was seen) per item:
  1. **Selector grouped by category** — are scenarios grouped (FX/Commodity/Climate/Geopolitics/Customers), not a flat list? (The earlier 2-item dropdown was the complaint.)
  2. **Cascade pacing** — HeatMap reflows worst-first in ≈1.5–2.5s? Time it.
  3. **Score swing** — holding composite tweens baseline→scenario with colour shift + ▼ badge, readable (≥24px)?
  4. **Narrative** — streams line-by-line (no mid-tag garbage), ⚠ lead + holding swing, real numbers, then 2-3 mitigations, and the FX assumption note shown for AZN_DEVAL_20?
  5. **Revert** — one click restores baseline (overlay + brief cleared) instantly?
  6. **Graceful degrade** — with no AI key, cascade + swing still land + "narrative unavailable" note (no 500)?
  7. **Intuitiveness** — obvious to a CFO what happened? Note confusion points for the user.
- [ ] **Step 4:** Fix failing items inline in `ScenarioPanel.tsx` (re-run tsc + affected vitest + restart server + re-verify). Loop until 1-6 pass; record item 7 for the user. Keep `public/crisis-mockup.html` UNTRACKED.
- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-30-crisis-brief-ux-review.md src/features/terminal/components/ScenarioPanel.tsx
git commit -m "docs(scenario): UX/UI review + fixes vs mockup rubric (Task 9)"
```

---

## Task 10: ROADMAP + CARRYOVER + final sweep

- [ ] **Step 1:** Add a Phase-1 "What-if Crisis Brief (B2)" entry to `docs/ROADMAP.md` with per-unit status + a 2026-05-30 changelog line; note Phase 2 (live-feed anchoring) + Phase 3 (signal/news triggers) as follow-on specs.
- [ ] **Step 2:** Process `docs/CARRYOVER.md` — close resolved 🔄 rows; file new 🔄 rows for deferred items (Phase 2/3 specs; the FX import-share assumption to revisit when the client tags real imported costs; rubric item 7 judgements).
- [ ] **Step 3:** Full suite: `npx vitest run` + `npx tsc --noEmit` (0).
- [ ] **Step 4:** Confirm the mockup is not staged: `git status --porcelain | grep crisis-mockup || echo clean`.
- [ ] **Step 5: Commit + push**

```bash
git add docs/ROADMAP.md docs/CARRYOVER.md
git commit -m "docs(scenario): Phase-1 Crisis Brief (B2) shipped — ROADMAP + CARRYOVER (Task 10)"
git push origin main
```

---

## Self-Review

**Spec coverage:** §1 goal → Tasks 2,3,6 · §2 reuse → 1,2,4 · §3a/§B.1 shock schema → 1 · §3b/§B.2 engine → 2 · §3c narrative → 3 · §3d UI → 6 · §4 data flow → 4 · §5 scope (Phase 1; catalog) → 7 · §6 error handling (422 no-shock; per-company fallback; non-finite skip; AI degrade) → 4,2,1 · §7 testing → 1,2,3,6a,8 · §8 decisions (advisory ⚠; worst-first ~50ms; ?mode=drivers) → 3,6,4 · §A catalog → 7 · §B (B2 + 3 flagships + revenue-sourcing) → 1,2,4,7 · user mandate 1 (fin-correctness) → 8 · mandate 2 (UX) → 9.

**Type consistency:** `ScenarioShock`/`ResolvedScalars`/`hasShock`/`readShock`/`resolveShockOverrides` (Task 1) used verbatim in Tasks 2,4,7,8. `DriverSimulationResult` fields consistent across 2,4,5,8. `ScenarioBriefState` (5) matches panel usage (6b). `CrisisBriefInput.assumptionNote` (3) matches the route's call (4). Revenue sourced from `inputs.resolved.revenue` in Tasks 4 + 8 (NOT a `company.revenue` column) — the one bug caught during grounding, fixed everywhere.

**Placeholder scan:** none — the shock vars are the verified resolved scalars; the FX `assumedImportShare` is an explicit, narrated modeling assumption (not a hand-wave), revisited in CARRYOVER when the client tags real imported costs.

**Known follow-ups (not Phase 1):** Phase 2 live-feed anchoring; Phase 3 signal/news triggers; tagging real imported-input costs to make `fx_usd` transmit without the assumed share.
