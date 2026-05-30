# What-if "Crisis Brief" — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click on a crisis scenario re-derives every indicator from real drivers (FX, commodity, yield, customer concentration) with NO DB writes, cascades the HeatMap into its scenario colours worst-first, swings the revenue-weighted holding composite, and streams a CFO-grounded AI "Crisis Brief" — instantly revertible.

**Architecture:** Reuse the proven in-memory recompute path (`buildContext` + `recomputeIndicator` with the existing `scenarioOverrides` hook — already exercised by `/api/indicators/matrix/preview`). New code is thin: a driver→override resolver, an orchestration module (`simulateByDrivers`) that wraps the recompute loop + `deriveParentComposites` for the holding swing, an AI narrative generator mirroring `variance-explainer.ts`, an extended `?mode=drivers` branch on the existing simulate route, and a `ScenarioPanel` enhancement (cascade + score tween + narrative stream + revert). Driver transmission is verified empirically FIRST (Task 0) because resolver var names are dynamically keyed off each formula's `requiredInputs`.

**Tech Stack:** Next.js 16 (App Router) · Prisma · PostgreSQL · TypeScript (tsc must stay 0) · vitest · Anthropic SDK (`getAnthropicClient`, Sonnet) · zustand-like hand-rolled `terminalStore`.

**Spec:** `docs/superpowers/specs/2026-05-30-what-if-crisis-brief-design.md` (read it before starting).

**Two mandatory gates (user is NOT a finance expert and cannot self-validate correctness; he also needs the UX to land):**
- **Task 8 — Financial-correctness verification.** "The numbers must be right, not just dramatic." Transmission, CFO-defensible direction+magnitude, DB cross-check, no-writes proof, holding-swing Σ-math.
- **Task 9 — UX/UI review.** Clarity, interactivity, intuitiveness vs the validated mockup `public/crisis-mockup.html`.

---

## Grounding facts (confirmed against the live code 2026-05-30 — do not re-guess)

- `buildContext(ds, args)` — `args.scenarioOverrides?: Record<string, number>` is applied to `state.context` AFTER all resolvers run, BEFORE formula eval; non-finite override values are silently skipped. Returns `{ context: FormulaContext; inputs: RecomputeInputs; functions }`. `recompute.ts:296`.
- `recomputeIndicator(ds, args)` — `args` = `{ organizationId, companyId, definition: IndicatorDefinitionLike, period: string, scenarioOverrides?, baseCurrency?, industry?, withSparkline? }`. Returns `Promise<{ ok: boolean; status: IndicatorStatus; value: number }>`. **Does NOT persist** — the caller's job; calling it without `upsert` gives a pure preview. `recompute.ts:485`.
- `createPrismaDataSource(prisma)` builds a `RecomputeDataSource`. The preview loop pattern lives at `src/app/api/indicators/matrix/preview/route.ts:242-309`.
- `computeCompositeByCompany(cells: readonly HeatMapCell[], companyIds?, riskTagsByCompany?: ReadonlyMap<string, readonly string[]>): Map<string, CompositeScore>`. `composite-score.ts:178`.
- `deriveParentComposites(companies: ReadonlyArray<{ id; parentCompanyId?; revenue? }>, leafById: ReadonlyMap<string, CompositeScore>): Map<string, CompositeScore>`. Revenue-weighted, fixpoint. `composite-score.ts:225`.
- `CompositeScore = { score: number | null; band: CompositeBand; contributingCount: number; totalCount: number; ... }`.
- `HeatMapCell = { companyId: string; indicatorId: string; value: number; status: IndicatorStatus; weight?: number; ... }` from `src/lib/risk/heatmap-matrix.ts:13`. `isAggregateRollup(cell)` cells are excluded from composites.
- AI narrative pattern (canonical): `src/lib/risk/variance-explainer.ts` — `SYSTEM_PROMPT` const · `buildExplainerPrompt(input)` pure · `validateAndShape(parsed)` pure · `runExplainer(input, opts)` with `opts.client` test seam, `max_tokens` guard (`stop_reason === 'max_tokens'` throws), `extractJsonFromText` from `@/lib/onboarding/ai-mapper/json-extract`, captures `response.model` + `usage`.
- `getAnthropicClient()` + `AI_MODEL` (`"claude-sonnet-4-5-20250929"`) from `src/lib/ai/client.ts`.
- `terminalStore` scenario API: `setScenarioDelta(delta: ReadonlyMap<string,string>|null, label: string|null)`, `clearScenarioDelta()`, state `scenarioDelta`, `activeScenarioCode`, `activeScenarioLabel`. `src/features/terminal/store/terminalStore.ts:197,436`.
- Existing simulate route is `GET` at `src/app/api/scenarios/[id]/simulate/route.ts`, `{ params: Promise<{ id }> }`, uses legacy `simulateScenario` + `buildDeltaMap`, returns `{ ...result, deltaMap }`.
- `Scenario.overrides` is a JSON column → **no Prisma migration needed**; `drivers` is a new key alongside legacy `adjustments`.
- Dev server is LaunchAgent-managed (port 3000). Recompiles on file change but stale-route caching is real — `launchctl kickstart -k gui/501/com.budgetpro.dev` (run with `dangerouslyDisableSandbox: true`) before live verification. Never `npm run dev`.

---

## File Structure

**Create:**
- `src/lib/risk/scenario-drivers.ts` — driver types (`DriverOverride`, `DriverMode`, `ScenarioDriversOverrides`) + `hasDrivers()` type-guard + `resolveDriverOverrides(drivers, baselineResolved)` pure helper. One responsibility: translate a driver list into a flat `scenarioOverrides` map for one company.
- `src/lib/risk/scenario-drivers.test.ts`
- `src/lib/risk/scenario-rederive.ts` — `simulateByDrivers(ds, input, deps?)` orchestration + result types (`DriverIndicatorDelta`, `DriverCompositeSwing`, `DriverSimulationResult`). One responsibility: per-company baseline read → driver resolve → scenario recompute (no persist) → deltas + holding swing.
- `src/lib/risk/scenario-rederive.test.ts`
- `src/lib/risk/scenario-narrative.ts` — `CrisisBriefInput`, `CrisisBriefOutput`, `SYSTEM_PROMPT`, `buildCrisisBriefPrompt()` pure, `validateAndShape()` pure, `runCrisisBrief(input, opts)`. One responsibility: turn a `DriverSimulationResult` into a grounded board narrative + mitigations.
- `src/lib/risk/scenario-narrative.test.ts`
- `src/features/terminal/lib/cascade-order.ts` — `orderCascade(deltas)` pure helper (worst-first cell ordering). One responsibility: deterministic cascade sequence.
- `src/features/terminal/lib/cascade-order.test.ts`
- `scripts/verify-driver-transmission.ts` — Task 0 spike (throwaway-ish diagnostic; kept in repo as a re-runnable transmission check).
- `scripts/seed-crisis-scenarios.ts` — author + upsert the 14-scenario catalog.
- `scripts/seed-crisis-scenarios.test.ts` — asserts each catalog entry's drivers are well-formed + the 2 flagships produce a non-trivial swing (uses the same fake-DS seam as the engine test).

**Modify:**
- `src/app/api/scenarios/[id]/simulate/route.ts` — add `?mode=drivers` branch (fetch companies + indicator defs + baseline IVs → `simulateByDrivers` → optional `runCrisisBrief` with graceful degrade → JSON). Legacy multiplier path stays the default.
- `src/features/terminal/store/terminalStore.ts` — add a `scenarioBrief` slice (`{ holdingBaselineScore, holdingScenarioScore, byCompany, narrative, mitigations, cascadeOrder } | null`) + `setScenarioBrief` / `clearScenarioBrief`; `clearScenarioDelta` also clears the brief.
- `src/features/terminal/components/ScenarioPanel.tsx` — drivers-mode fetch + cascade scheduler + holding-score tween + line-by-line narrative reveal + revert.
- `docs/ROADMAP.md` + `docs/CARRYOVER.md` — status + changelog.

**Reuse unchanged:** `scenario-simulator.ts` (legacy), `recompute.ts`, `composite-score.ts`, `ai/client.ts`, `heatmap-matrix.ts`.

---

## Task 0: Driver-transmission spike (CHIEF RISK — do this FIRST, gates everything)

**Why:** resolver context vars are dynamically keyed off each formula's `requiredInputs`, so a driver's `var` only moves an indicator whose formula actually consumes that exact key. Overriding `fx_usd` moves FX-rate-driven formulas, but an FX-*imported-cost* indicator built from already-in-AZN budget lines may need a cost-side driver instead. We confirm the real var names + that they produce a dramatic swing BEFORE authoring drivers or building the engine.

**Files:**
- Create: `scripts/verify-driver-transmission.ts`

- [ ] **Step 1: Write the spike script**

```ts
/**
 * Task 0 — Driver-transmission spike.
 *
 * For a flagship company, prints the BASELINE resolved context (so we see
 * the REAL var names resolvers produce), then re-runs every indicator with a
 * candidate driver override and prints which indicators actually MOVE.
 *
 * Run: set -a; source .env; set +a; npx tsx scripts/verify-driver-transmission.ts
 * NO DB writes.
 */
import { prisma } from '@/lib/prisma'
import { createPrismaDataSource, buildContext, recomputeIndicator } from '@/lib/risk/recompute'
import type { IndicatorDefinitionLike } from '@/lib/risk/recompute-types'

async function main() {
  const org = await prisma.organization.findFirstOrThrow()
  const period = '2026'
  // Flagship companies for the 2 validation scenarios.
  const flagshipCodes = ['AZSEKER-MALT', 'AZSF', 'EDEN', 'CPC'] // adjust to live codes
  const companies = await prisma.company.findMany({
    where: { organizationId: org.id, code: { in: flagshipCodes } },
    select: { id: true, code: true, name: true, industry: true },
  })
  const indicators = await prisma.indicatorDefinition.findMany({
    where: { isActive: true },
    select: { id: true, code: true, formula: true, thresholds: true, requiredInputs: true },
  })
  const ds = createPrismaDataSource(prisma)

  // Candidate drivers to probe (var names from spec §A — CONFIRM here).
  const candidates: Array<{ label: string; var: string; mode: 'set' | 'mult'; value: number }> = [
    { label: 'AZN -20% (fx_usd set 2.04)', var: 'fx_usd', mode: 'set', value: 2.04 },
    { label: 'Sugar -20% (sugar_price mult)', var: 'sugar_price', mode: 'mult', value: 0.8 },
    { label: 'Drought -30% (harvest_tons mult)', var: 'harvest_tons', mode: 'mult', value: 0.7 },
  ]

  for (const co of companies) {
    // Baseline context with the UNION of all indicator requiredInputs so every
    // driver var that any formula consumes is resolved + visible.
    const requiredInputs = Array.from(new Set(indicators.flatMap((i) => i.requiredInputs ?? [])))
    const base = await buildContext(ds, {
      organizationId: org.id, companyId: co.id, period: { kind: 'year', year: 2026 } as never,
      requiredInputs, industry: co.industry,
    }).catch((e) => { console.error(`buildContext failed for ${co.code}:`, e.message); return null })
    if (!base) continue
    console.log(`\n=== ${co.code} (${co.industry}) baseline context keys ===`)
    console.log(Object.keys(base.context).sort().join(', '))
    for (const cand of candidates) {
      const baseVal = (base.context as Record<string, number>)[cand.var]
      const override = cand.mode === 'set' ? cand.value
        : (Number.isFinite(baseVal) ? baseVal * cand.value : NaN)
      if (!Number.isFinite(override)) {
        console.log(`  [${cand.label}] var "${cand.var}" NOT in baseline context — driver is INERT for ${co.code}`)
        continue
      }
      let moved = 0
      for (const ind of indicators) {
        const def: IndicatorDefinitionLike = {
          id: ind.id, code: ind.code, formula: ind.formula,
          thresholds: ind.thresholds, requiredInputs: ind.requiredInputs,
        }
        const b = await recomputeIndicator(ds, { organizationId: org.id, companyId: co.id, definition: def, period, industry: co.industry }).catch(() => null)
        const s = await recomputeIndicator(ds, { organizationId: org.id, companyId: co.id, definition: def, period, industry: co.industry, scenarioOverrides: { [cand.var]: override } }).catch(() => null)
        if (b && s && b.status !== 'unknown' && Math.abs((s.value ?? 0) - (b.value ?? 0)) > 1e-6) {
          moved++
          console.log(`  [${cand.label}] ${ind.code}: ${b.value.toFixed(3)} (${b.status}) → ${s.value.toFixed(3)} (${s.status})`)
        }
      }
      console.log(`  [${cand.label}] → ${moved} indicators moved on ${co.code}`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run the spike**

Run: `set -a; source .env; set +a; npx tsx scripts/verify-driver-transmission.ts`
Expected: prints each flagship's real context keys + a per-candidate "N indicators moved" line.

- [ ] **Step 3: Record findings + decide real driver vars**

Write the confirmed var names + transmission results into `docs/superpowers/specs/2026-05-30-what-if-crisis-brief-design.md` under a new "§B Transmission findings" section. Specifically resolve:
- The exact var that moves FX-imported-cost / food-processing margins for AZN −20% (if `fx_usd` is inert because budget lines are already AZN, identify the cost-side var, e.g. `imported_input_cost` or a `cogs` multiplier).
- The exact var for drought (`harvest_tons` vs a `yield_*` / `revenue_per_ha` driver).
- **Gate:** if a flagship driver moves 0 indicators, the scenario is not demo-viable with that var — pick the var that produces a real swing before proceeding. Do NOT author a driver that no formula consumes.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-driver-transmission.ts docs/superpowers/specs/2026-05-30-what-if-crisis-brief-design.md
git commit -m "feat(scenario): driver-transmission spike + confirmed var names (Task 0)"
```

---

## Task 1: Driver types + `resolveDriverOverrides`

**Files:**
- Create: `src/lib/risk/scenario-drivers.ts`
- Test: `src/lib/risk/scenario-drivers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { hasDrivers, resolveDriverOverrides, type DriverOverride } from './scenario-drivers'

describe('hasDrivers', () => {
  it('true when overrides.drivers is a non-empty array', () => {
    expect(hasDrivers({ drivers: [{ var: 'fx_usd', mode: 'set', value: 2 }] })).toBe(true)
  })
  it('false for legacy adjustments-only / empty / null', () => {
    expect(hasDrivers({ adjustments: [{ codes: ['X'], multiply: 0.8 }] })).toBe(false)
    expect(hasDrivers({ drivers: [] })).toBe(false)
    expect(hasDrivers(null)).toBe(false)
    expect(hasDrivers(undefined)).toBe(false)
  })
})

describe('resolveDriverOverrides', () => {
  const baseline = { fx_usd: 1.7, sugar_price: 500, harvest_tons: 1000 }
  it('set mode → absolute value', () => {
    const drivers: DriverOverride[] = [{ var: 'fx_usd', mode: 'set', value: 2.04 }]
    expect(resolveDriverOverrides(drivers, baseline)).toEqual({ fx_usd: 2.04 })
  })
  it('mult mode → baseline × value', () => {
    const drivers: DriverOverride[] = [{ var: 'sugar_price', mode: 'mult', value: 0.8 }]
    expect(resolveDriverOverrides(drivers, baseline)).toEqual({ sugar_price: 400 })
  })
  it('skips mult driver whose baseline var is missing/non-finite', () => {
    const drivers: DriverOverride[] = [{ var: 'not_present', mode: 'mult', value: 0.5 }]
    expect(resolveDriverOverrides(drivers, baseline)).toEqual({})
  })
  it('combines multiple drivers; set always applied even if baseline missing', () => {
    const drivers: DriverOverride[] = [
      { var: 'fx_usd', mode: 'set', value: 2.04 },
      { var: 'harvest_tons', mode: 'mult', value: 0.7 },
      { var: 'top_customer_share', mode: 'set', value: 0 },
    ]
    expect(resolveDriverOverrides(drivers, baseline)).toEqual({ fx_usd: 2.04, harvest_tons: 700, top_customer_share: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/risk/scenario-drivers.test.ts`
Expected: FAIL — "Failed to resolve import './scenario-drivers'".

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Phase 1 "Crisis Brief" — driver-override schema + resolver.
 *
 * A scenario's `overrides` JSON may carry a `drivers` array alongside the
 * legacy `adjustments`. Drivers are economic primitives (FX rate, commodity
 * price, yield, customer share). `resolveDriverOverrides` turns them into the
 * flat `scenarioOverrides: Record<string, number>` that `buildContext` /
 * `recomputeIndicator` already consume (applied after resolvers, before eval).
 *
 * Pure module — no DB, no Prisma.
 */

export type DriverMode = 'set' | 'mult'

export interface DriverOverride {
  /** MUST match a recompute context variable (the key a resolver produces).
   *  Confirmed empirically per scenario in Task 0 — see spec §B. */
  var: string
  /** 'set' → absolute override; 'mult' → baselineResolved[var] × value. */
  mode: DriverMode
  value: number
}

/** Shape of `Scenario.overrides` once it carries drivers. `adjustments`
 *  (legacy multiplier path) may coexist; `drivers` takes precedence in the
 *  `?mode=drivers` route branch. */
export interface ScenarioDriversOverrides {
  drivers: DriverOverride[]
  adjustments?: unknown
}

/** Type-guard: does this overrides blob carry a usable driver list? */
export function hasDrivers(overrides: unknown): overrides is ScenarioDriversOverrides {
  return (
    !!overrides &&
    typeof overrides === 'object' &&
    Array.isArray((overrides as { drivers?: unknown }).drivers) &&
    (overrides as { drivers: unknown[] }).drivers.length > 0
  )
}

/**
 * Resolve a driver list against ONE company's baseline resolved context.
 * - 'set'  → absolute value (applied even if the var has no baseline).
 * - 'mult' → baselineResolved[var] × value; SKIPPED when the baseline var is
 *            missing / non-finite (mirrors buildContext's silent non-finite
 *            skip — a mult on a var this company doesn't have is inert, not an
 *            error).
 * Non-finite results are dropped so buildContext never sees NaN.
 */
export function resolveDriverOverrides(
  drivers: DriverOverride[],
  baselineResolved: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of drivers) {
    let v: number
    if (d.mode === 'set') {
      v = d.value
    } else {
      const base = baselineResolved[d.var]
      if (typeof base !== 'number' || !Number.isFinite(base)) continue
      v = base * d.value
    }
    if (Number.isFinite(v)) out[d.var] = v
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/risk/scenario-drivers.test.ts`
Expected: PASS (4 + 2 cases).

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/risk/scenario-drivers.ts src/lib/risk/scenario-drivers.test.ts
git commit -m "feat(scenario): driver-override schema + resolveDriverOverrides (Task 1)"
```

---

## Task 2: `simulateByDrivers` engine

**Files:**
- Create: `src/lib/risk/scenario-rederive.ts`
- Test: `src/lib/risk/scenario-rederive.test.ts`

**Design:** orchestration only. Per company: one baseline `buildContext` (union of all indicator `requiredInputs`) to read driver baselines → `resolveDriverOverrides` → per-indicator `recomputeIndicator` with `scenarioOverrides` (no persist). Baseline VALUES come from the passed-in persisted IVs (so the on-screen number is the baseline — see Task 8 cross-check). Composite swing = `computeCompositeByCompany` over baseline cells vs scenario cells, then `deriveParentComposites` for the holding. `buildContext` + `recomputeIndicator` are injectable (`deps`) so the unit test runs with NO DB.

- [ ] **Step 1: Write the failing test (orchestration with injected fakes, asserts no DB writes)**

```ts
import { describe, it, expect, vi } from 'vitest'
import { simulateByDrivers } from './scenario-rederive'

// Fake DS whose every mutation throws — proves the engine never persists.
const noWriteDs = new Proxy({}, {
  get(_t, prop: string) {
    if (/^upsert|^create|^update|^delete|^persist/i.test(prop)) {
      return () => { throw new Error(`DB write attempted: ${prop}`) }
    }
    return () => undefined
  },
}) as never

describe('simulateByDrivers', () => {
  const companies = [
    { id: 'c1', code: 'MALT', name: 'Malt', parentCompanyId: 'p1', industry: 'food_processing', revenue: 1000 },
    { id: 'c2', code: 'EDEN', name: 'Eden', parentCompanyId: 'p1', industry: 'agro_crops', revenue: 500 },
    { id: 'p1', code: 'HOLD', name: 'Holding', parentCompanyId: null, industry: null, revenue: null },
  ]
  const indicators = [
    { id: 'i1', code: 'FP_GROSS_MARGIN', formula: 'x', thresholds: {}, requiredInputs: ['currencyRate:usd'], weight: 1.5 },
  ]
  const baselineIVs = [
    { companyId: 'c1', indicatorId: 'i1', value: 30, status: 'green' as const },
    { companyId: 'c2', indicatorId: 'i1', value: 20, status: 'amber' as const },
  ]
  const scenario = { code: 'AZN_DEVAL_20', overrides: { drivers: [{ var: 'fx_usd', mode: 'set' as const, value: 2.04 }] } }

  it('re-derives scenario IVs via injected recompute, computes deltas + holding swing, NO writes', async () => {
    const fakeBuildContext = vi.fn(async () => ({ context: { fx_usd: 1.7 }, inputs: {}, functions: {} } as never))
    // Scenario recompute: margin compresses under FX shock.
    const fakeRecompute = vi.fn(async (_ds, args: { companyId: string; scenarioOverrides?: Record<string, number> }) => {
      const scen = !!args.scenarioOverrides
      if (args.companyId === 'c1') return { ok: true, value: scen ? 18 : 30, status: scen ? 'red' : 'green' } as never
      return { ok: true, value: scen ? 12 : 20, status: scen ? 'red' : 'amber' } as never
    })

    const r = await simulateByDrivers(noWriteDs, {
      organizationId: 'org1', scenario, period: '2026', companies, indicators, baselineIVs,
    }, { buildContext: fakeBuildContext, recomputeIndicator: fakeRecompute })

    // deltas
    const c1 = r.deltas.find((d) => d.companyId === 'c1' && d.code === 'FP_GROSS_MARGIN')!
    expect(c1.baselineValue).toBe(30)
    expect(c1.scenarioValue).toBe(18)
    expect(c1.baselineStatus).toBe('green')
    expect(c1.scenarioStatus).toBe('red')
    expect(c1.changed).toBe(true)
    // holding swing: both leaves go red → holding worse than baseline
    expect(r.holdingScenarioScore).not.toBeNull()
    expect(r.holdingBaselineScore).not.toBeNull()
    expect(r.holdingScenarioScore! < r.holdingBaselineScore!).toBe(true)
    expect(r.worsened).toBeGreaterThan(0)
    // baseline buildContext called once per leaf company (set-mode still reads to keep code uniform)
    expect(fakeBuildContext).toHaveBeenCalled()
  })

  it('a per-company recompute throw falls back to baseline for that company, never aborts', async () => {
    const fakeBuildContext = vi.fn(async () => ({ context: { fx_usd: 1.7 }, inputs: {}, functions: {} } as never))
    const fakeRecompute = vi.fn(async (_ds, args: { companyId: string }) => {
      if (args.companyId === 'c2') throw new Error('resolver blew up')
      return { ok: true, value: 18, status: 'red' } as never
    })
    const r = await simulateByDrivers(noWriteDs, {
      organizationId: 'org1', scenario, period: '2026', companies, indicators, baselineIVs,
    }, { buildContext: fakeBuildContext, recomputeIndicator: fakeRecompute })
    expect(r.driftSummary.pairsErrored).toBeGreaterThan(0)
    const c2 = r.deltas.find((d) => d.companyId === 'c2')!
    // c2 falls back: scenario == baseline (no change)
    expect(c2.scenarioValue).toBe(c2.baselineValue)
    expect(c2.changed).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/risk/scenario-rederive.test.ts`
Expected: FAIL — "Failed to resolve import './scenario-rederive'".

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Phase 1 "Crisis Brief" — driver re-derivation engine.
 *
 * Pure orchestration over buildContext + recomputeIndicator (both injectable
 * for unit tests). For each company: read baseline driver values, resolve the
 * scenario's drivers into a flat override map, re-derive every indicator under
 * those overrides (NO PERSIST), and emit deltas. The holding swing is computed
 * with the SAME helpers the live terminal uses (computeCompositeByCompany +
 * deriveParentComposites) so the demo number matches the real screen.
 *
 * NO DB WRITES. recomputeIndicator never persists (caller's job); we never call
 * the upsert path.
 */

import { buildContext as realBuildContext, recomputeIndicator as realRecompute } from './recompute'
import type { RecomputeDataSource } from './recompute-types'
import type { IndicatorDefinitionLike } from './recompute-types'
import type { IndicatorStatus } from './formula-engine'
import { parsePeriod } from './periods'
import { hasDrivers, resolveDriverOverrides } from './scenario-drivers'
import { computeCompositeByCompany, deriveParentComposites, type CompositeScore } from './composite-score'
import type { HeatMapCell } from './heatmap-matrix'

export interface SimulateByDriversCompany {
  id: string
  code: string
  name: string
  parentCompanyId?: string | null
  industry?: string | null
  revenue?: number | null
}

export interface SimulateByDriversIndicator {
  id: string
  code: string
  formula: unknown
  thresholds: unknown
  requiredInputs: string[]
  weight?: number | null
}

export interface SimulateByDriversBaselineIV {
  companyId: string
  indicatorId: string
  value: number
  status: IndicatorStatus
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
  companyId: string
  companyCode: string
  companyName: string
  indicatorId: string
  code: string
  baselineValue: number | null
  baselineStatus: IndicatorStatus | null
  scenarioValue: number | null
  scenarioStatus: IndicatorStatus | null
  /** status changed baseline → scenario */
  changed: boolean
  deltaPct: number | null
}

export interface DriverCompositeSwing {
  companyId: string
  companyCode: string
  baselineScore: number | null
  scenarioScore: number | null
}

export interface DriverSimulationResult {
  scenarioCode: string
  period: string
  deltas: DriverIndicatorDelta[]
  byCompany: DriverCompositeSwing[]
  holdingBaselineScore: number | null
  holdingScenarioScore: number | null
  changed: number
  worsened: number
  improved: number
  driftSummary: { pairsAttempted: number; pairsErrored: number; lastError: string | null }
}

const STATUS_ORDER: Record<IndicatorStatus, number> = { green: 3, amber: 2, red: 1, unknown: 0 }

export async function simulateByDrivers(
  ds: RecomputeDataSource,
  input: SimulateByDriversInput,
  deps: SimulateByDriversDeps = {},
): Promise<DriverSimulationResult> {
  const buildContext = deps.buildContext ?? realBuildContext
  const recomputeIndicator = deps.recomputeIndicator ?? realRecompute
  const { organizationId, scenario, period, companies, indicators, baselineIVs } = input

  if (!hasDrivers(scenario.overrides)) {
    throw new Error(`Scenario ${scenario.code} has no drivers — use the legacy multiplier path.`)
  }
  const drivers = scenario.overrides.drivers
  const parsedPeriod = parsePeriod(period)

  const baselineByKey = new Map<string, SimulateByDriversBaselineIV>()
  for (const iv of baselineIVs) baselineByKey.set(`${iv.companyId}:${iv.indicatorId}`, iv)

  const requiredUnion = Array.from(new Set(indicators.flatMap((i) => i.requiredInputs ?? [])))
  const leaves = companies.filter((c) => !companies.some((x) => x.parentCompanyId === c.id) || c.revenue != null)
  // We treat every company with at least one indicator as a leaf for the cell
  // matrix; parent roll-up is handled by deriveParentComposites afterwards.

  const deltas: DriverIndicatorDelta[] = []
  let pairsErrored = 0
  let lastError: string | null = null
  const scenarioCells: HeatMapCell[] = []
  const baselineCells: HeatMapCell[] = []

  for (const co of companies) {
    // Baseline read — one buildContext per company to resolve driver baselines.
    let baseResolved: Record<string, number> = {}
    try {
      const base = await buildContext(ds, {
        organizationId, companyId: co.id, period: parsedPeriod,
        requiredInputs: requiredUnion, industry: co.industry ?? null,
      })
      baseResolved = base.context as Record<string, number>
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      // Without a baseline context, only 'set' drivers can apply.
    }
    const overrides = resolveDriverOverrides(drivers, baseResolved)

    for (const ind of indicators) {
      const key = `${co.id}:${ind.id}`
      const baseline = baselineByKey.get(key) ?? null
      const def: IndicatorDefinitionLike = {
        id: ind.id, code: ind.code, formula: ind.formula,
        thresholds: ind.thresholds, requiredInputs: ind.requiredInputs,
      }
      let scenarioValue: number | null = baseline?.value ?? null
      let scenarioStatus: IndicatorStatus | null = baseline?.status ?? null
      try {
        const r = await recomputeIndicator(ds, {
          organizationId, companyId: co.id, definition: def, period,
          industry: co.industry ?? null, scenarioOverrides: overrides,
        })
        scenarioValue = r.status === 'unknown' ? null : r.value
        scenarioStatus = r.status
      } catch (err) {
        // Fall back to baseline for this pair; never abort the whole sim.
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
      if (baselineStatus) baselineCells.push({ companyId: co.id, indicatorId: ind.id, value: baselineValue ?? 0, status: baselineStatus, weight: w ?? undefined })
      if (scenarioStatus) scenarioCells.push({ companyId: co.id, indicatorId: ind.id, value: scenarioValue ?? 0, status: scenarioStatus, weight: w ?? undefined })
    }
  }

  // ── Composite swing (same methodology as the live terminal) ───────────────
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

  // Holding = the root (no parent). If several roots, pick the highest-revenue.
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
Expected: PASS (2 cases). If `parsePeriod` import path differs, confirm with `grep -n "export function parsePeriod" src/lib/risk/periods.ts` and fix the import.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/risk/scenario-rederive.ts src/lib/risk/scenario-rederive.test.ts
git commit -m "feat(scenario): simulateByDrivers re-derivation engine, no DB writes (Task 2)"
```

---

## Task 3: AI crisis-narrative generator

**Files:**
- Create: `src/lib/risk/scenario-narrative.ts`
- Test: `src/lib/risk/scenario-narrative.test.ts`

**Design:** mirror `variance-explainer.ts` exactly — `SYSTEM_PROMPT`, pure `buildCrisisBriefPrompt`, pure `validateAndShape`, `runCrisisBrief(input, opts)` with `opts.client` test seam + `max_tokens` guard + `extractJsonFromText`. Grounded: the prompt contains ONLY the computed numbers; the system prompt forbids inventing figures. Advisory-CFO tone with a ⚠ lead (spec §8). Output language EN/RU/AZ.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildCrisisBriefPrompt, runCrisisBrief, type CrisisBriefInput } from './scenario-narrative'

const input: CrisisBriefInput = {
  scenarioCode: 'AZN_DEVAL_20',
  scenarioNameEn: 'AZN devaluation −20%',
  language: 'ru',
  holdingBaselineScore: 45,
  holdingScenarioScore: 31,
  worstHit: [
    { companyCode: 'MALT', companyName: 'Malt', baselineScore: 57, scenarioScore: 33, topDeltas: [{ code: 'FP_GROSS_MARGIN', baselineValue: 30, scenarioValue: 18 }] },
  ],
  changed: 7, worsened: 6, improved: 1,
}

describe('buildCrisisBriefPrompt', () => {
  it('includes the real swing numbers and forbids invention', () => {
    const p = buildCrisisBriefPrompt(input)
    expect(p).toContain('45')
    expect(p).toContain('31')
    expect(p).toContain('MALT')
    expect(p).toContain('FP_GROSS_MARGIN')
  })
})

describe('runCrisisBrief', () => {
  it('returns narrative + mitigations from the injected client', async () => {
    const fakeClient = {
      messages: { create: vi.fn(async () => ({
        stop_reason: 'end_turn', model: 'claude-sonnet-4-5-20250929',
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: 'text', text: JSON.stringify({
          narrative: '⚠ Девальвация маната на 20% обрушивает композит холдинга с 45 до 31.',
          mitigations: ['Хеджировать USD-экспозицию по импортному сырью', 'Пересмотреть контракты MALT', 'Поднять отпускные цены на 8%'],
          confidence: 0.7,
        }) }],
      })) },
    } as never
    const out = await runCrisisBrief(input, { client: fakeClient })
    expect(out.narrative).toContain('45')
    expect(out.mitigations).toHaveLength(3)
    expect(out.modelName).toBe('claude-sonnet-4-5-20250929')
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
 * Phase 1 "Crisis Brief" — grounded AI narrative.
 *
 * Mirrors variance-explainer.ts: SYSTEM_PROMPT + pure buildCrisisBriefPrompt +
 * pure validateAndShape + runCrisisBrief (injectable client). The prompt
 * receives ONLY the computed deltas + score swing; the system prompt forbids
 * inventing numbers. Advisory-CFO tone, ⚠ crisis lead. Output language EN/RU/AZ.
 */

import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client'
import { extractJsonFromText } from '@/lib/onboarding/ai-mapper/json-extract'

export type BriefLanguage = 'en' | 'ru' | 'az'

export interface CrisisBriefWorstHit {
  companyCode: string
  companyName: string
  baselineScore: number | null
  scenarioScore: number | null
  topDeltas: Array<{ code: string; baselineValue: number; scenarioValue: number }>
}

export interface CrisisBriefInput {
  scenarioCode: string
  scenarioNameEn: string
  language: BriefLanguage
  holdingBaselineScore: number | null
  holdingScenarioScore: number | null
  worstHit: CrisisBriefWorstHit[]
  changed: number
  worsened: number
  improved: number
}

export interface CrisisBriefOutput {
  /** Board-level narrative, ⚠ lead, names the holding swing then worst-hit. */
  narrative: string
  /** 2-3 concrete mitigations a CFO can act on this quarter. */
  mitigations: string[]
  /** LLM self-rated confidence 0..1. */
  confidence: number
  modelName: string
  promptVersion: string
  usage?: { inputTokens: number; outputTokens: number }
}

export const CRISIS_BRIEF_PROMPT_VERSION = 'v1'

const LANGUAGE_LABEL: Record<BriefLanguage, string> = {
  en: 'English', ru: 'Russian (Русский)', az: 'Azerbaijani (Azərbaycan dili)',
}

const SYSTEM_PROMPT = `You are the CFO advisor for an Azerbaijani diversified holding (~60 companies, 14 sectors). You are briefing the board on a SIMULATED crisis scenario. You receive ONLY pre-computed numbers (a holding composite-score swing + the worst-hit companies + their indicator deltas).

Produce:
  1. narrative — board-level, 3-5 sentences. LEAD with a ⚠ crisis framing and the holding composite swing (cite the exact before→after numbers). Then name the 1-3 worst-hit companies with their ACTUAL score drops and the key indicator that moved (cite real before→after values). Advisory tone — serious, not pure alarmism.
  2. mitigations — 2-3 concrete moves the CFO can make THIS QUARTER. Specific verbs (hedge, renegotiate, pre-buy, raise prices, freeze capex, diversify supply). No "monitor" / "investigate".
  3. confidence — honest 0.0-1.0.

ABSOLUTE CONSTRAINTS:
  - Use ONLY the numbers provided. NEVER invent a figure, percentage, or company not in the input. If you cite a number it MUST appear verbatim in the input.
  - Output STRICT JSON only (no markdown). Schema: { "narrative": string, "mitigations": string[], "confidence": number }.
  - Write in the requested output language.`

function fmtScore(s: number | null): string {
  return s == null ? 'n/a' : String(Math.round(s))
}

export function buildCrisisBriefPrompt(input: CrisisBriefInput): string {
  const worstLines = input.worstHit
    .map((w) => {
      const deltas = w.topDeltas
        .map((d) => `${d.code}: ${d.baselineValue} → ${d.scenarioValue}`)
        .join('; ')
      return `  ${w.companyCode} (${w.companyName}): composite ${fmtScore(w.baselineScore)} → ${fmtScore(w.scenarioScore)} | ${deltas || '(no indicator deltas)'}`
    })
    .join('\n')

  return `Scenario: ${input.scenarioCode} (${input.scenarioNameEn})

Holding composite score: ${fmtScore(input.holdingBaselineScore)} → ${fmtScore(input.holdingScenarioScore)}
Indicators changed status: ${input.changed} (worsened ${input.worsened}, improved ${input.improved})

Worst-hit companies (use these EXACT numbers, invent nothing):
${worstLines || '  (none)'}

Output language: ${LANGUAGE_LABEL[input.language]}.

Return STRICT JSON (no markdown):
{
  "narrative": "⚠ ... 3-5 sentences citing only the numbers above",
  "mitigations": ["...", "...", "..."],
  "confidence": 0.0
}`
}

type ValidatedBody = Omit<CrisisBriefOutput, 'modelName' | 'promptVersion' | 'usage'>

function validateAndShape(parsed: unknown): ValidatedBody {
  if (parsed == null || typeof parsed !== 'object') throw new Error('Crisis brief: response is not a JSON object')
  const obj = parsed as Record<string, unknown>
  if (typeof obj.narrative !== 'string' || obj.narrative.trim() === '') throw new Error("Crisis brief: missing 'narrative'")
  if (!Array.isArray(obj.mitigations) || obj.mitigations.length === 0 ||
      !obj.mitigations.every((m) => typeof m === 'string' && m.trim() !== '')) {
    throw new Error("Crisis brief: 'mitigations' must be a non-empty string array")
  }
  const mitigations = (obj.mitigations as string[]).slice(0, 3)
  const c = obj.confidence
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) {
    throw new Error(`Crisis brief: 'confidence' must be a finite number in [0,1], got ${JSON.stringify(c)}`)
  }
  return { narrative: obj.narrative.trim(), mitigations, confidence: c }
}

export interface RunCrisisBriefOptions {
  model?: string
  maxTokens?: number
  client?: ReturnType<typeof getAnthropicClient>
}

export async function runCrisisBrief(
  input: CrisisBriefInput,
  opts: RunCrisisBriefOptions = {},
): Promise<CrisisBriefOutput> {
  const client = opts.client ?? getAnthropicClient()
  const model = opts.model ?? AI_MODEL
  // RU/AZ board prose needs headroom (feedback_llm_max_tokens) — 8K is generous.
  const maxTokens = opts.maxTokens ?? 8192

  const response = await client.messages.create({
    model, max_tokens: maxTokens, system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildCrisisBriefPrompt(input) }],
  })

  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Crisis brief truncated at max_tokens=${maxTokens}. Re-run with higher maxTokens.`)
  }
  const textBlocks = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
  if (textBlocks.length === 0) throw new Error('Crisis brief: response had no text content')
  const raw = textBlocks.join('\n').trim()
  const jsonText = extractJsonFromText(raw)
  if (!jsonText) throw new Error(`Crisis brief: no JSON in response. Raw: ${raw.slice(0, 200)}…`)
  let parsed: unknown
  try { parsed = JSON.parse(jsonText) }
  catch (err) { throw new Error(`Crisis brief: JSON parse error: ${err instanceof Error ? err.message : String(err)}`) }

  const body = validateAndShape(parsed)
  const out: CrisisBriefOutput = { ...body, modelName: response.model ?? model, promptVersion: CRISIS_BRIEF_PROMPT_VERSION }
  if (response.usage) out.usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/risk/scenario-narrative.test.ts`
Expected: PASS (3 cases).

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

**Behaviour:** when `?mode=drivers` AND the scenario `hasDrivers`, fetch active companies (id, code, name, parentCompanyId, industry, revenue), active indicator defs, and baseline IVs for the period; run `simulateByDrivers`; then attempt `runCrisisBrief` (top-3 worst-hit) — on AI failure, return deltas + swing WITHOUT narrative (graceful degrade, never 500 the panel). Build a `deltaMap` (`"companyId:code" → scenarioStatus`) for the HeatMap overlay, same key shape as the legacy path. Without `?mode=drivers` (or no drivers), the existing legacy branch runs unchanged.

- [ ] **Step 1: Write the failing test (route handler, mode=drivers)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ orgId: 'org1', userId: 'u1' })),
  isAuthError: () => false,
}))
const findFirst = vi.fn()
const companyFindMany = vi.fn()
const indicatorFindMany = vi.fn()
const ivFindMany = vi.fn()
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

import { GET } from './route'

function req(url: string) { return new Request(url) as never }

describe('GET simulate ?mode=drivers', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('runs simulateByDrivers + narrative, returns swing + deltaMap + narrative', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'AZN_DEVAL_20', nameEn: 'AZN -20%', nameRu: 'Манат -20%', overrides: { drivers: [{ var: 'fx_usd', mode: 'set', value: 2.04 }] } })
    companyFindMany.mockResolvedValue([{ id: 'c1', code: 'MALT', name: 'Malt', parentCompanyId: 'p1', industry: 'food_processing', revenue: 1000 }])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'FP_GROSS_MARGIN', formula: 'x', thresholds: {}, requiredInputs: [], weight: 1.5 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 30, status: 'green' }])
    simulateByDrivers.mockResolvedValue({
      scenarioCode: 'AZN_DEVAL_20', period: '2026',
      deltas: [{ companyId: 'c1', companyCode: 'MALT', companyName: 'Malt', indicatorId: 'i1', code: 'FP_GROSS_MARGIN', baselineValue: 30, baselineStatus: 'green', scenarioValue: 18, scenarioStatus: 'red', changed: true, deltaPct: -40 }],
      byCompany: [{ companyId: 'c1', companyCode: 'MALT', baselineScore: 57, scenarioScore: 33 }],
      holdingBaselineScore: 45, holdingScenarioScore: 31, changed: 1, worsened: 1, improved: 0,
      driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null },
    })
    runCrisisBrief.mockResolvedValue({ narrative: '⚠ ...45→31...', mitigations: ['hedge'], confidence: 0.7, modelName: 'sonnet', promptVersion: 'v1' })

    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers&period=2026'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.holdingBaselineScore).toBe(45)
    expect(body.holdingScenarioScore).toBe(31)
    expect(body.deltaMap['c1:FP_GROSS_MARGIN']).toBe('red')
    expect(body.narrative).toContain('45→31')
    expect(body.mitigations).toEqual(['hedge'])
  })

  it('returns deltas WITHOUT narrative when the AI generator throws (graceful degrade, still 200)', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'AZN_DEVAL_20', nameEn: 'x', overrides: { drivers: [{ var: 'fx_usd', mode: 'set', value: 2 }] } })
    companyFindMany.mockResolvedValue([{ id: 'c1', code: 'MALT', name: 'Malt', parentCompanyId: null, industry: null, revenue: 1 }])
    indicatorFindMany.mockResolvedValue([{ id: 'i1', code: 'X', formula: 'x', thresholds: {}, requiredInputs: [], weight: 1 }])
    ivFindMany.mockResolvedValue([{ companyId: 'c1', indicatorId: 'i1', value: 1, status: 'green' }])
    simulateByDrivers.mockResolvedValue({ scenarioCode: 'AZN_DEVAL_20', period: '2026', deltas: [], byCompany: [], holdingBaselineScore: 45, holdingScenarioScore: 31, changed: 0, worsened: 0, improved: 0, driftSummary: { pairsAttempted: 1, pairsErrored: 0, lastError: null } })
    runCrisisBrief.mockRejectedValue(new Error('LLM down'))

    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers'), { params: Promise.resolve({ id: 's1' }) } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.holdingScenarioScore).toBe(31)
    expect(body.narrative).toBeNull()
    expect(body.narrativeError).toBeTruthy()
  })

  it('422 when ?mode=drivers but scenario has no drivers', async () => {
    findFirst.mockResolvedValue({ id: 's1', code: 'X', nameEn: 'x', overrides: { adjustments: [] } })
    const res = await GET(req('http://x/api/scenarios/s1/simulate?mode=drivers'), { params: Promise.resolve({ id: 's1' }) } as never)
    expect(res.status).toBe(422)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/api/scenarios/[id]/simulate/route.drivers.test.ts"`
Expected: FAIL — the drivers branch doesn't exist yet (404/legacy path).

- [ ] **Step 3: Add the drivers branch to the route**

In `src/app/api/scenarios/[id]/simulate/route.ts`, extend the imports:

```ts
import { createPrismaDataSource } from '@/lib/risk/recompute'
import { hasDrivers } from '@/lib/risk/scenario-drivers'
import { simulateByDrivers } from '@/lib/risk/scenario-rederive'
import { runCrisisBrief, type BriefLanguage } from '@/lib/risk/scenario-narrative'
import { hasAnthropicKey } from '@/lib/ai/client'
```

After the scenario fetch + null guard (right before the existing `// Guard: scenario must have simulatable adjustments` block), insert the drivers branch:

```ts
  const mode = searchParams.get('mode')
  const language = (searchParams.get('lang') as BriefLanguage | null) ?? 'ru'

  // ── Driver re-derivation path (Phase 1 "Crisis Brief") ────────────────────
  if (mode === 'drivers') {
    if (!hasDrivers(scenario.overrides)) {
      return NextResponse.json(
        { error: 'Scenario has no `drivers` — cannot run driver re-derivation. Use the default multiplier simulate (omit ?mode=drivers).' },
        { status: 422 },
      )
    }
    const [companies, indicators, baselineIVs] = await Promise.all([
      prisma.company.findMany({
        where: { organizationId: session.orgId },
        select: { id: true, code: true, name: true, parentCompanyId: true, industry: true, revenue: true },
      }),
      prisma.indicatorDefinition.findMany({
        where: { isActive: true },
        select: { id: true, code: true, formula: true, thresholds: true, requiredInputs: true, weight: true },
      }),
      prisma.indicatorValue.findMany({
        where: { organizationId: session.orgId, period },
        select: { companyId: true, indicatorId: true, value: true, status: true },
      }),
    ])
    const ds = createPrismaDataSource(prisma)
    const sim = await simulateByDrivers(ds, {
      organizationId: session.orgId,
      scenario: { code: scenario.code, overrides: scenario.overrides },
      period,
      companies: companies.map((c) => ({ ...c, revenue: c.revenue ?? null })),
      indicators: indicators.map((i) => ({ ...i, formula: i.formula, thresholds: i.thresholds, requiredInputs: i.requiredInputs ?? [], weight: i.weight ?? null })),
      baselineIVs: baselineIVs.map((iv) => ({ companyId: iv.companyId, indicatorId: iv.indicatorId, value: iv.value, status: iv.status as never })),
    })

    // deltaMap for the HeatMap overlay: "companyId:code" → scenarioStatus (only changed cells)
    const deltaMap: Record<string, string> = {}
    for (const d of sim.deltas) {
      if (d.changed && d.scenarioStatus) deltaMap[`${d.companyId}:${d.code}`] = d.scenarioStatus
    }

    // Narrative — top-3 worst-hit by score drop; graceful degrade on AI failure.
    let narrative: string | null = null
    let mitigations: string[] = []
    let narrativeError: string | null = null
    if (hasAnthropicKey()) {
      try {
        const scoreById = new Map(sim.byCompany.map((b) => [b.companyId, b]))
        const deltasByCo = new Map<string, typeof sim.deltas>()
        for (const d of sim.deltas) {
          if (!d.changed) continue
          const list = deltasByCo.get(d.companyId) ?? []
          list.push(d); deltasByCo.set(d.companyId, list)
        }
        const worstHit = sim.byCompany
          .filter((b) => b.baselineScore != null && b.scenarioScore != null && b.scenarioScore < b.baselineScore)
          .sort((a, b) => (a.scenarioScore! - a.baselineScore!) - (b.scenarioScore! - b.baselineScore!))
          .slice(0, 3)
          .map((b) => {
            const co = companies.find((c) => c.id === b.companyId)
            const topDeltas = (deltasByCo.get(b.companyId) ?? [])
              .filter((d) => d.baselineValue != null && d.scenarioValue != null)
              .slice(0, 2)
              .map((d) => ({ code: d.code, baselineValue: d.baselineValue!, scenarioValue: d.scenarioValue! }))
            return { companyCode: co?.code ?? b.companyId, companyName: co?.name ?? b.companyId, baselineScore: b.baselineScore, scenarioScore: b.scenarioScore, topDeltas }
          })
        const brief = await runCrisisBrief({
          scenarioCode: scenario.code, scenarioNameEn: scenario.nameEn, language,
          holdingBaselineScore: sim.holdingBaselineScore, holdingScenarioScore: sim.holdingScenarioScore,
          worstHit, changed: sim.changed, worsened: sim.worsened, improved: sim.improved,
        })
        narrative = brief.narrative; mitigations = brief.mitigations
      } catch (err) {
        narrativeError = err instanceof Error ? err.message : String(err)
      }
    } else {
      narrativeError = 'No Anthropic API key configured — narrative skipped.'
    }

    return NextResponse.json({
      mode: 'drivers',
      scenarioId: scenario.id, scenarioCode: scenario.code,
      scenarioNameRu: scenario.nameRu ?? scenario.nameEn, scenarioNameEn: scenario.nameEn,
      period: sim.period,
      deltas: sim.deltas, byCompany: sim.byCompany, deltaMap,
      holdingBaselineScore: sim.holdingBaselineScore, holdingScenarioScore: sim.holdingScenarioScore,
      changed: sim.changed, worsened: sim.worsened, improved: sim.improved,
      driftSummary: sim.driftSummary,
      narrative, mitigations, narrativeError,
    })
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/api/scenarios/[id]/simulate/route.drivers.test.ts"`
Expected: PASS (3 cases).

- [ ] **Step 5: Confirm the legacy path still passes + tsc + commit**

```bash
npx vitest run "src/app/api/scenarios" && npx tsc --noEmit
git add "src/app/api/scenarios/[id]/simulate/route.ts" "src/app/api/scenarios/[id]/simulate/route.drivers.test.ts"
git commit -m "feat(scenario): /simulate?mode=drivers branch with graceful narrative degrade (Task 4)"
```

---

## Task 5: `terminalStore` scenario-brief slice

**Files:**
- Modify: `src/features/terminal/store/terminalStore.ts`
- Test: `src/features/terminal/store/terminalStore.scenario-brief.test.ts`

**State added:** `scenarioBrief: ScenarioBriefState | null` where `ScenarioBriefState = { scenarioCode, holdingBaselineScore, holdingScenarioScore, byCompany, narrative, mitigations, cascadeOrder }`. Actions `setScenarioBrief(brief)` + `clearScenarioBrief()`. `clearScenarioDelta()` also clears the brief (revert is one gesture).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useTerminalStore } from './terminalStore'

describe('terminalStore scenarioBrief', () => {
  beforeEach(() => { useTerminalStore.getState().resetTerminal?.() })

  it('setScenarioBrief stores; clearScenarioBrief clears', () => {
    const s = useTerminalStore.getState()
    s.setScenarioBrief({
      scenarioCode: 'AZN_DEVAL_20', holdingBaselineScore: 45, holdingScenarioScore: 31,
      byCompany: [{ companyId: 'c1', companyCode: 'MALT', baselineScore: 57, scenarioScore: 33 }],
      narrative: '⚠ ...', mitigations: ['hedge'], cascadeOrder: ['c1:FP_GROSS_MARGIN'],
    })
    expect(useTerminalStore.getState().scenarioBrief?.holdingScenarioScore).toBe(31)
    s.clearScenarioBrief()
    expect(useTerminalStore.getState().scenarioBrief).toBeNull()
  })

  it('clearScenarioDelta also clears the brief', () => {
    const s = useTerminalStore.getState()
    s.setScenarioBrief({ scenarioCode: 'X', holdingBaselineScore: 45, holdingScenarioScore: 31, byCompany: [], narrative: null, mitigations: [], cascadeOrder: [] })
    s.clearScenarioDelta()
    expect(useTerminalStore.getState().scenarioBrief).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/terminal/store/terminalStore.scenario-brief.test.ts`
Expected: FAIL — `setScenarioBrief is not a function`.

- [ ] **Step 3: Implement the slice**

In `terminalStore.ts`, add the type near the other scenario types (around the `scenarioDelta` doc, ~line 128):

```ts
export interface ScenarioBriefState {
  scenarioCode: string
  holdingBaselineScore: number | null
  holdingScenarioScore: number | null
  byCompany: Array<{ companyId: string; companyCode: string; baselineScore: number | null; scenarioScore: number | null }>
  narrative: string | null
  mitigations: string[]
  /** Ordered "companyId:code" keys, worst-first, for the staggered cascade. */
  cascadeOrder: string[]
}
```

Add to the state interface (near `scenarioDelta: ... | null;`, ~line 132):

```ts
  scenarioBrief: ScenarioBriefState | null;
```

Add to the actions interface (near `setScenarioDelta`, ~line 197):

```ts
  setScenarioBrief: (brief: ScenarioBriefState | null) => void;
  clearScenarioBrief: () => void;
```

Add to the initial state (near `scenarioDelta: null,`, ~line 282):

```ts
  scenarioBrief: null,
```

Add the action implementations (near `setScenarioDelta`, ~line 436) and fold brief-clearing into `clearScenarioDelta`:

```ts
  setScenarioBrief: (brief) => setGlobalState({ scenarioBrief: brief }),
  clearScenarioBrief: () => setGlobalState({ scenarioBrief: null }),
  clearScenarioDelta: () =>
    setGlobalState({ scenarioDelta: null, activeScenarioLabel: null, scenarioBrief: null }),
```

(Remove the old `clearScenarioDelta` two-field version; replace with the three-field one above.) Add `scenarioBrief: null` to the `resetTerminal` reset block (~line 470).

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

## Task 6: cascade-order helper + ScenarioPanel drivers UX

### Task 6a: `orderCascade` pure helper

**Files:**
- Create: `src/features/terminal/lib/cascade-order.ts`
- Test: `src/features/terminal/lib/cascade-order.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { orderCascade } from './cascade-order'

describe('orderCascade', () => {
  it('orders changed cells worst-first (red before amber before green), only changed', () => {
    const order = orderCascade([
      { companyId: 'c1', code: 'A', scenarioStatus: 'amber', changed: true },
      { companyId: 'c2', code: 'B', scenarioStatus: 'red', changed: true },
      { companyId: 'c3', code: 'C', scenarioStatus: 'green', changed: false },
      { companyId: 'c4', code: 'D', scenarioStatus: 'green', changed: true },
    ])
    expect(order).toEqual(['c2:B', 'c1:A', 'c4:D'])
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
/** Worst-first cascade ordering for the scenario reflow. Only cells whose
 *  status CHANGED participate; red leads, then amber, then green/unknown.
 *  Returns "companyId:code" keys in flip order. Pure. */
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

### Task 6b: ScenarioPanel — drivers mode, cascade, score tween, narrative stream, revert

**Files:**
- Modify: `src/features/terminal/components/ScenarioPanel.tsx`

**Reference the validated mockup `public/crisis-mockup.html` for visual + pacing.** The cascade target ≈ 1.5–2.5s total → set per-cell delay = `clamp(1800 / max(cascadeOrder.length, 1), 35, 120)` ms.

- [ ] **Step 1: Add a "▶ Запустить кризис" action + drivers fetch**

In `handleSimulate` (or a new `handleRunCrisis`), when the selected scenario carries `drivers`, fetch the drivers endpoint instead of the legacy one:

```ts
const runDrivers = useCallback(async () => {
  if (!selectedScenario) return
  setSimState({ kind: 'loading' })
  try {
    const res = await fetch(`/api/scenarios/${selectedScenario.id}/simulate?mode=drivers&period=${period}&lang=${aiLang}`)
    if (res.status === 422) { setSimState({ kind: 'unsupported' }); return }
    if (!res.ok) throw new Error(`simulate ${res.status}`)
    const data = await res.json()
    // 1) build overlay deltaMap for HeatMap
    const deltaMap = new Map<string, string>(Object.entries(data.deltaMap ?? {}))
    setScenarioDelta(deltaMap, resolveScenarioLabel(selectedScenario, locale))
    // 2) store brief (score swing + narrative + cascade order)
    const cascadeOrder = orderCascade(data.deltas ?? [])
    setScenarioBrief({
      scenarioCode: data.scenarioCode,
      holdingBaselineScore: data.holdingBaselineScore,
      holdingScenarioScore: data.holdingScenarioScore,
      byCompany: data.byCompany ?? [],
      narrative: data.narrative ?? null,
      mitigations: data.mitigations ?? [],
      cascadeOrder,
    })
    setSimState({ kind: 'done', result: data })
  } catch (e) {
    setSimState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}, [selectedScenario, period, aiLang, locale, setScenarioDelta, setScenarioBrief])
```

Wire imports at the top: `import { orderCascade } from '../lib/cascade-order'` and pull `setScenarioBrief` from the store (`const setScenarioBrief = useTerminalStore((s) => s.setScenarioBrief)`). Add an `aiLang` state (`const [aiLang, setAiLang] = useState<'en'|'ru'|'az'>('ru')`) with a small EN/RU/AZ selector (matches `project_ai_output_language`). Add a `▶ Запустить кризис` button rendered when `selectedScenario` has `drivers` (detect via `Array.isArray((selectedScenario.overrides as { drivers?: unknown }).drivers)`).

- [ ] **Step 2: Score-swing tween (baseline → scenario, colour shift + ▼ badge)**

Add a small tween hook + a `HoldingScoreSwing` sub-component rendered in the panel when `scenarioBrief` is set:

```tsx
function useCountTween(target: number | null, durationMs = 900): number | null {
  const [v, setV] = useState<number | null>(target)
  const fromRef = useRef<number | null>(target)
  useEffect(() => {
    if (target == null) { setV(null); return }
    const from = fromRef.current ?? target
    const start = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs)
      const eased = 1 - Math.pow(1 - p, 3)
      setV(Math.round(from + (target - from) * eased))
      if (p < 1) raf = requestAnimationFrame(step)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])
  return v
}

function bandColor(score: number | null): string {
  if (score == null) return 'text-muted-foreground'
  if (score >= 67) return 'text-emerald-500'
  if (score >= 34) return 'text-[#FFB800]'
  return 'text-red-500'
}

function HoldingScoreSwing({ base, scen }: { base: number | null; scen: number | null }) {
  const shown = useCountTween(scen)
  const drop = base != null && scen != null ? scen - base : null
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-muted-foreground">Композит холдинга</span>
      <span className="text-sm text-muted-foreground line-through">{base ?? '—'}</span>
      <span className={`text-3xl font-bold tabular-nums transition-colors ${bandColor(shown)}`}>{shown ?? '—'}</span>
      {drop != null && drop !== 0 && (
        <span className={`text-sm font-semibold ${drop < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
          {drop < 0 ? '▼' : '▲'} {Math.abs(drop)}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Cascade — stagger the HeatMap overlay worst-first**

The HeatMap reads `scenarioDelta` from the store. To stagger, the panel reveals the deltaMap incrementally: after `runDrivers` stores the FULL deltaMap, replace it with a growing subset on a timer driven by `cascadeOrder`. Add an effect in the panel:

```ts
const scenarioBrief = useTerminalStore((s) => s.scenarioBrief)
useEffect(() => {
  if (!scenarioBrief || simState.kind !== 'done') return
  const full = (simState.result as { deltaMap?: Record<string, string> }).deltaMap ?? {}
  const order = scenarioBrief.cascadeOrder
  if (order.length === 0) return
  const perCell = Math.min(120, Math.max(35, Math.round(1800 / order.length)))
  let i = 0
  setScenarioDelta(new Map(), scenarioBrief.scenarioCode) // start cleared
  const tick = () => {
    i++
    const partial = new Map<string, string>()
    for (let k = 0; k < i && k < order.length; k++) {
      const key = order[k]
      if (full[key]) partial.set(key, full[key])
    }
    setScenarioDelta(partial, scenarioBrief.scenarioCode)
    if (i < order.length) timer = window.setTimeout(tick, perCell)
  }
  let timer = window.setTimeout(tick, perCell)
  return () => window.clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [scenarioBrief?.scenarioCode])
```

(Keying the effect on `scenarioBrief?.scenarioCode` ensures one cascade per run, not per render.)

- [ ] **Step 4: Narrative line-by-line reveal (tag-safe — the mockup's fix)**

Render the narrative by revealing whole lines on an interval (never split mid-tag — this was the validated mockup fix):

```tsx
function NarrativeStream({ text }: { text: string }) {
  const lines = useMemo(() => text.split(/(?<=[.!?])\s+/).filter(Boolean), [text])
  const [shown, setShown] = useState(0)
  useEffect(() => {
    setShown(0)
    if (lines.length === 0) return
    let i = 0
    const id = window.setInterval(() => { i++; setShown(i); if (i >= lines.length) window.clearInterval(id) }, 420)
    return () => window.clearInterval(id)
  }, [lines])
  return <p className="text-sm leading-relaxed">{lines.slice(0, shown).join(' ')}</p>
}
```

Render `scenarioBrief.narrative` via `<NarrativeStream>` when present; when `narrative` is null show a muted note: «AI-нарратив недоступен — см. дельты ниже» (graceful degrade). Render `mitigations` as a list below.

- [ ] **Step 5: Revert — one gesture clears overlay + brief**

The existing baseline-clear control calls `clearScenarioDelta()` — Task 5 already made that clear the brief too. Confirm the "× Baseline" badge/button calls `clearScenarioDelta()`; if a separate revert is added in this panel, call `clearScenarioDelta()` (which now also nulls `scenarioBrief`).

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit
git add src/features/terminal/components/ScenarioPanel.tsx
git commit -m "feat(scenario): ScenarioPanel drivers mode — cascade, score tween, narrative stream, revert (Task 6b)"
```

---

## Task 7: Author + seed the 14-scenario catalog (2 flagships validated FIRST)

**Files:**
- Create: `scripts/seed-crisis-scenarios.ts`
- Test: `scripts/seed-crisis-scenarios.test.ts`

**Use the driver var names CONFIRMED in Task 0 (spec §B), not the spec §A guesses.** Where Task 0 found a candidate inert, substitute the var that actually transmits.

- [ ] **Step 1: Write the catalog data + a well-formedness test**

```ts
import { describe, it, expect } from 'vitest'
import { CRISIS_CATALOG } from './seed-crisis-scenarios'
import { hasDrivers } from '@/lib/risk/scenario-drivers'

describe('CRISIS_CATALOG', () => {
  it('has 14 entries, each with a unique code + well-formed drivers', () => {
    expect(CRISIS_CATALOG).toHaveLength(14)
    const codes = new Set(CRISIS_CATALOG.map((s) => s.code))
    expect(codes.size).toBe(14)
    for (const s of CRISIS_CATALOG) {
      expect(hasDrivers({ drivers: s.drivers })).toBe(true)
      for (const d of s.drivers) {
        expect(typeof d.var).toBe('string')
        expect(['set', 'mult']).toContain(d.mode)
        expect(Number.isFinite(d.value)).toBe(true)
      }
      expect(s.category).toBeTruthy()
      expect(s.nameEn && s.nameRu && s.nameAz).toBeTruthy()
    }
  })
  it('the 2 flagships are present and marked', () => {
    const flagships = CRISIS_CATALOG.filter((s) => s.flagship).map((s) => s.code)
    expect(flagships).toContain('AZN_DEVAL_20')
    expect(flagships).toContain('DROUGHT_2026')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/seed-crisis-scenarios.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the catalog + seeding script**

```ts
/**
 * Phase 1 "Crisis Brief" — 14-scenario catalog (spec §A) authored as driver
 * overrides. Driver `var` names are the ones CONFIRMED to transmit in Task 0
 * (spec §B). Upserts into Scenario.overrides.drivers (JSON), preserving any
 * legacy adjustments already on the row.
 *
 * Run: set -a; source .env; set +a; npx tsx scripts/seed-crisis-scenarios.ts
 */
import { prisma } from '@/lib/prisma'
import type { DriverOverride } from '@/lib/risk/scenario-drivers'

export type CrisisCategory = 'fx_macro' | 'commodity' | 'climate_agro' | 'geopolitics' | 'customers'

export interface CrisisCatalogEntry {
  code: string
  category: CrisisCategory
  flagship?: boolean
  nameEn: string
  nameRu: string
  nameAz: string
  description: string
  drivers: DriverOverride[]
}

// NOTE: replace each `var` with the Task 0-confirmed transmitting variable.
export const CRISIS_CATALOG: CrisisCatalogEntry[] = [
  // 💱 FX / macro
  { code: 'AZN_DEVAL_20', category: 'fx_macro', flagship: true, nameEn: 'AZN devaluation −20%', nameRu: 'Девальвация маната −20%', nameAz: 'Manatın −20% devalvasiyası', description: 'AZN/USD jumps ~1.70 → 2.04; imported-input cost + food-processing margins compress.', drivers: [{ var: 'fx_usd', mode: 'set', value: 2.04 }] },
  { code: 'AZN_DEVAL_15_DEBT', category: 'fx_macro', nameEn: 'AZN −15% + debt stress', nameRu: 'Манат −15% + долговой стресс', nameAz: 'Manat −15% + borc stresi', description: 'Milder FX shock compounded by higher debt-servicing cost.', drivers: [{ var: 'fx_usd', mode: 'set', value: 1.96 }, { var: 'debt_cost_rate', mode: 'mult', value: 1.3 }] },
  { code: 'POLICY_RATE_SPIKE', category: 'fx_macro', nameEn: 'Policy-rate spike', nameRu: 'Скачок ключевой ставки', nameAz: 'Uçot dərəcəsinin sıçrayışı', description: 'CBAR hikes; debt-servicing burden rises → EBITDA/margin pressure.', drivers: [{ var: 'debt_cost_rate', mode: 'mult', value: 1.5 }] },
  // 🌾 Commodity
  { code: 'SUGAR_PRICE_DROP_20', category: 'commodity', nameEn: 'Sugar −20%', nameRu: 'Сахар −20%', nameAz: 'Şəkər −20%', description: 'Sugar price −20% → revenue/ha + AZSF/CPC margins.', drivers: [{ var: 'sugar_price', mode: 'mult', value: 0.8 }] },
  { code: 'SUGAR_CRASH_40', category: 'commodity', nameEn: 'Sugar crash −40%', nameRu: 'Обвал сахара −40%', nameAz: 'Şəkər çöküşü −40%', description: 'Severe tail of the sugar shock.', drivers: [{ var: 'sugar_price', mode: 'mult', value: 0.6 }] },
  { code: 'BRENT_DROP_30', category: 'commodity', nameEn: 'Brent −30%', nameRu: 'Brent −30%', nameAz: 'Brent −30%', description: 'Oil −30% → energy/fertilizer + commodity volatility.', drivers: [{ var: 'oil_price', mode: 'mult', value: 0.7 }] },
  { code: 'GRAIN_PRICE_UP_25', category: 'commodity', nameEn: 'Wheat/grain +25%', nameRu: 'Зерно +25%', nameAz: 'Taxıl +25%', description: 'Input-cost spike → food-processing gross margin.', drivers: [{ var: 'cogs', mode: 'mult', value: 1.25 }] },
  // ☀️ Climate / agro
  { code: 'DROUGHT_2026', category: 'climate_agro', flagship: true, nameEn: 'Drought — harvest −30%', nameRu: 'Засуха — урожай −30%', nameAz: 'Quraqlıq — məhsul −30%', description: 'Harvest −30% → yield + revenue-per-ha across agro entities.', drivers: [{ var: 'harvest_tons', mode: 'mult', value: 0.7 }] },
  { code: 'DROUGHT_SEVERE_50', category: 'climate_agro', nameEn: 'Severe drought −50%', nameRu: 'Сильная засуха −50%', nameAz: 'Güclü quraqlıq −50%', description: 'Extreme tail of the drought scenario.', drivers: [{ var: 'harvest_tons', mode: 'mult', value: 0.5 }] },
  { code: 'FLOOD_WEATHER', category: 'climate_agro', nameEn: 'Flood / bad weather', nameRu: 'Наводнение / непогода', nameAz: 'Daşqın / pis hava', description: 'Harvest −20% + quality/cost penalty.', drivers: [{ var: 'harvest_tons', mode: 'mult', value: 0.8 }, { var: 'cogs', mode: 'mult', value: 1.1 }] },
  // 🌍 Geopolitics
  { code: 'IRAN_SANCTIONS', category: 'geopolitics', nameEn: 'Iran sanctions tighten', nameRu: 'Ужесточение санкций по Ирану', nameAz: 'İran sanksiyalarının sərtləşməsi', description: 'FX + cost pressure + negative sentiment.', drivers: [{ var: 'fx_usd', mode: 'set', value: 1.92 }, { var: 'cogs', mode: 'mult', value: 1.12 }, { var: 'news_sentiment_30d', mode: 'set', value: -0.6 }] },
  { code: 'BORDER_CLOSURE', category: 'geopolitics', nameEn: 'Export/border closure', nameRu: 'Закрытие границы/экспорта', nameAz: 'Sərhəd/ixrac bağlanması', description: 'Exporter revenue drop + concentration risk.', drivers: [{ var: 'export_revenue', mode: 'mult', value: 0.7 }] },
  // 👥 Customers
  { code: 'LOSE_TOP_CUSTOMER', category: 'customers', nameEn: 'Lose top customer', nameRu: 'Потеря крупнейшего клиента', nameAz: 'Ən böyük müştərinin itkisi', description: 'Top-customer share → 0; concentration goes red.', drivers: [{ var: 'top_customer_share', mode: 'set', value: 0 }, { var: 'revenue', mode: 'mult', value: 0.85 }] },
  { code: 'CUSTOMER_DEFAULT', category: 'customers', nameEn: 'Major customer default', nameRu: 'Дефолт крупного клиента', nameAz: 'Böyük müştərinin defoltu', description: 'Revenue + liquidity hit from a receivables default.', drivers: [{ var: 'revenue', mode: 'mult', value: 0.9 }, { var: 'receivables_writeoff', mode: 'set', value: 1 }] },
]

async function main() {
  const org = await prisma.organization.findFirstOrThrow()
  for (const s of CRISIS_CATALOG) {
    const existing = await prisma.scenario.findFirst({ where: { organizationId: org.id, code: s.code } })
    const legacyAdjustments = (existing?.overrides as { adjustments?: unknown } | null)?.adjustments
    const overrides = { drivers: s.drivers, ...(legacyAdjustments ? { adjustments: legacyAdjustments } : {}) }
    if (existing) {
      await prisma.scenario.update({ where: { id: existing.id }, data: { overrides, nameEn: s.nameEn, nameRu: s.nameRu, nameAz: s.nameAz, description: s.description, isActive: true } })
    } else {
      await prisma.scenario.create({ data: { organizationId: org.id, code: s.code, nameEn: s.nameEn, nameRu: s.nameRu, nameAz: s.nameAz, description: s.description, overrides, isActive: true } })
    }
    console.log(`upserted ${s.code} (${s.drivers.length} drivers)`)
  }
  await prisma.$disconnect()
}
if (process.argv[1]?.includes('seed-crisis-scenarios')) main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/seed-crisis-scenarios.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Seed the 2 flagships first + verify swing, then the rest**

Run (seeds all 14; the flagships are validated end-to-end in Task 8):
```bash
set -a; source .env; set +a
npx tsx scripts/seed-crisis-scenarios.ts
```
Expected: 14 "upserted …" lines.

- [ ] **Step 6: Confirm scenario field names against the schema before seeding**

Run: `grep -nA25 "model Scenario" prisma/schema.prisma` — confirm `nameAz`/`nameRu`/`nameEn`/`description`/`overrides`/`isActive`/`organizationId`/`code` exist. Fix the script to match the real column names if any differ. Then re-run Step 5.

- [ ] **Step 7: tsc + commit**

```bash
npx tsc --noEmit
git add scripts/seed-crisis-scenarios.ts scripts/seed-crisis-scenarios.test.ts
git commit -m "feat(scenario): 14-scenario crisis catalog as driver overrides (Task 7)"
```

---

## Task 8 (MANDATORY GATE): Financial-correctness verification + testing

> The user is NOT a finance expert and cannot validate the numbers himself. This task makes "the numbers must be right, not just dramatic" an explicit, executable gate. Do NOT declare the feature done until every check here passes.

**Files:**
- Create: `src/lib/risk/scenario-rederive.integration.test.ts` (real DB, gated)
- Create: `docs/superpowers/specs/2026-05-30-crisis-brief-fin-correctness.md` (the review checklist + recorded results)

### 8.1 — Transmission confirmed (re-uses Task 0)
- [ ] **Step 1:** Re-run `scripts/verify-driver-transmission.ts`. Confirm `AZN_DEVAL_20` moves ≥1 margin/cost indicator on a food-processing flagship, and `DROUGHT_2026` moves ≥1 yield/revenue indicator on an agro flagship. Record the moved-indicator lists in `docs/superpowers/specs/2026-05-30-crisis-brief-fin-correctness.md`. **Gate:** 0 moved = not demo-viable; fix the driver var.

### 8.2 — Economically-sane direction + magnitude (CFO-defensible)
- [ ] **Step 1:** Write the integration test (runs the real engine against the live DB; skipped when `DATABASE_URL` is unset):

```ts
import { describe, it, expect } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createPrismaDataSource } from '@/lib/risk/recompute'
import { simulateByDrivers } from '@/lib/risk/scenario-rederive'

const RUN = !!process.env.DATABASE_URL
const d = RUN ? describe : describe.skip

d('simulateByDrivers — financial correctness (live DB)', () => {
  const prisma = new PrismaClient()
  const period = '2026'

  async function load(scenarioCode: string) {
    const org = await prisma.organization.findFirstOrThrow()
    const scenario = await prisma.scenario.findFirstOrThrow({ where: { organizationId: org.id, code: scenarioCode } })
    const companies = (await prisma.company.findMany({ where: { organizationId: org.id }, select: { id: true, code: true, name: true, parentCompanyId: true, industry: true, revenue: true } })).map((c) => ({ ...c, revenue: c.revenue ?? null }))
    const indicators = (await prisma.indicatorDefinition.findMany({ where: { isActive: true }, select: { id: true, code: true, formula: true, thresholds: true, requiredInputs: true, weight: true } })).map((i) => ({ ...i, requiredInputs: i.requiredInputs ?? [], weight: i.weight ?? null }))
    const baselineIVs = (await prisma.indicatorValue.findMany({ where: { organizationId: org.id, period }, select: { companyId: true, indicatorId: true, value: true, status: true } })).map((iv) => ({ ...iv, status: iv.status as never }))
    return { org, scenario, companies, indicators, baselineIVs }
  }

  it('AZN −20%: margins COMPRESS (worsen), holding score does NOT improve', async () => {
    const { org, scenario, companies, indicators, baselineIVs } = await load('AZN_DEVAL_20')
    const ds = createPrismaDataSource(prisma)
    const r = await simulateByDrivers(ds, { organizationId: org.id, scenario: { code: scenario.code, overrides: scenario.overrides }, period, companies, indicators, baselineIVs })
    // Direction: an FX devaluation must not IMPROVE the holding.
    if (r.holdingBaselineScore != null && r.holdingScenarioScore != null) {
      expect(r.holdingScenarioScore).toBeLessThanOrEqual(r.holdingBaselineScore + 1) // +1 rounding tolerance
    }
    // At least one margin indicator worsened.
    expect(r.worsened).toBeGreaterThan(0)
    // Magnitude sanity: swing is material but not absurd (≤ 40 points).
    if (r.holdingBaselineScore != null && r.holdingScenarioScore != null) {
      expect(r.holdingBaselineScore - r.holdingScenarioScore).toBeLessThanOrEqual(40)
    }
  }, 120_000)

  it('DROUGHT_2026: agro yield/revenue indicators worsen', async () => {
    const { org, scenario, companies, indicators, baselineIVs } = await load('DROUGHT_2026')
    const ds = createPrismaDataSource(prisma)
    const r = await simulateByDrivers(ds, { organizationId: org.id, scenario: { code: scenario.code, overrides: scenario.overrides }, period, companies, indicators, baselineIVs })
    expect(r.worsened).toBeGreaterThan(0)
    if (r.holdingBaselineScore != null && r.holdingScenarioScore != null) {
      expect(r.holdingScenarioScore).toBeLessThanOrEqual(r.holdingBaselineScore + 1)
    }
  }, 120_000)
})
```

- [ ] **Step 2:** Run: `set -a; source .env; set +a; npx vitest run src/lib/risk/scenario-rederive.integration.test.ts`
Expected: PASS (2 cases). If `worsened === 0`, the driver isn't transmitting — return to 8.1.

### 8.3 — DB cross-check (baseline == persisted)
- [ ] **Step 1:** Add an integration assertion (same file) that for a no-driver control (override `{ fx_usd: <current> }` set to the baseline value, or an empty-effect scenario), the re-derived scenario value equals the persisted baseline IV within 0.5% for ≥95% of pairs. This proves the engine's baseline matches the on-screen number (so the delta shown to the CFO is a pure driver effect, not an engine artefact). Record the match rate. **Gate:** <95% match → investigate disclosure-path divergence before demo.

### 8.4 — No DB writes (proof)
- [ ] **Step 1:** The unit test (Task 2) already proves no writes via the throwing proxy DS. Additionally, in the integration test, wrap the `simulateByDrivers` call and assert the period's `IndicatorValue.count` + `updatedAt` MAX are unchanged before/after. Record the counts.

### 8.5 — Holding-swing Σ-math
- [ ] **Step 1:** Add a unit assertion (in `scenario-rederive.test.ts`) on a hand-computed fixture: 2 leaves (revenue 1000 @ score 60, revenue 500 @ score 30) under a parent → revenue-weighted parent = round((60·1000 + 30·500)/1500) = 50. Assert `holdingBaselineScore === 50`. This locks the consolidation math to a number a CFO can verify by hand.

- [ ] **Step 2: Commit**

```bash
git add src/lib/risk/scenario-rederive.integration.test.ts src/lib/risk/scenario-rederive.test.ts docs/superpowers/specs/2026-05-30-crisis-brief-fin-correctness.md
git commit -m "test(scenario): financial-correctness gate — transmission, direction, DB cross-check, no-writes, Σ-math (Task 8)"
```

---

## Task 9 (MANDATORY GATE): UX/UI review

> The validated mockup `public/crisis-mockup.html` is the visual reference. Review the LIVE terminal against a clarity/interactivity/intuitiveness rubric. Per `feedback_no_screenshot_lies.md`: never claim something is visible without naming the exact element/coordinate; cross-check the accessibility tree.

**Files:**
- Create: `docs/superpowers/specs/2026-05-30-crisis-brief-ux-review.md` (rubric + findings + fix list)

- [ ] **Step 1: Restart the dev server so all new routes/components compile**

Run (sandbox off): `launchctl kickstart -k gui/501/com.budgetpro.dev` then wait ~5s.

- [ ] **Step 2: Load the terminal + run a flagship scenario (Chrome MCP or Playwright)**

Navigate to `http://localhost:3000/budgeting/terminal`, open the Scenario panel (SCN command or the Beaker button), select `AZN_DEVAL_20`, click "▶ Запустить кризис".

- [ ] **Step 3: Score the rubric (record pass/fix in the review doc)**

For each, record a concrete observation (element + what you saw), not a vibe:
1. **Scenario selector grouped by category** — are the 14 scenarios grouped (FX/Commodity/Climate/Geopolitics/Customers) with clear labels, not a flat 14-item list? (The earlier 2-item dropdown was a complaint — confirm the catalog now shows grouped.)
2. **Cascade pacing** — does the HeatMap reflow worst-first and complete in ≈1.5–2.5s (not instant, not dragging)? Time it.
3. **Score swing** — does the holding composite visibly tween baseline→scenario with a colour shift + ▼ delta badge, readable from across a room (≥24px)?
4. **Narrative** — does it stream line-by-line (no mid-tag fl• garbage), lead with ⚠ + the holding swing, cite real company numbers, then list 2-3 mitigations?
5. **Revert** — does one click restore baseline (overlay cleared + brief gone) instantly?
6. **Graceful degrade** — disable the AI key (or simulate failure) and confirm the cascade + swing still land with a "narrative unavailable" note (no 500, no blank panel).
7. **Intuitiveness** — is it obvious to a CFO what just happened without a tooltip? Note any confusion point.

- [ ] **Step 4: Fix the top issues inline**

For any rubric item that fails, make the fix in `ScenarioPanel.tsx` (or the relevant file), re-run `npx tsc --noEmit` + the affected vitest, restart the dev server, re-verify. Loop until items 1-6 pass (item 7 is judgement — record it for the user). Keep `public/crisis-mockup.html` UNTRACKED — never commit it.

- [ ] **Step 5: Commit the review + any fixes**

```bash
git add docs/superpowers/specs/2026-05-30-crisis-brief-ux-review.md src/features/terminal/components/ScenarioPanel.tsx
git commit -m "docs(scenario): UX/UI review + fixes against mockup rubric (Task 9)"
```

---

## Task 10: ROADMAP + CARRYOVER + final sweep

**Files:**
- Modify: `docs/ROADMAP.md`, `docs/CARRYOVER.md`

- [ ] **Step 1:** Add a Phase-1 "What-if Crisis Brief" entry to `docs/ROADMAP.md` with per-unit status (engine ✅ / narrative ✅ / route ✅ / UI ✅ / catalog ✅ / fin-correctness ✅ / UX ✅) + a changelog line dated 2026-05-30. Note Phase 2 (live-feed anchoring) + Phase 3 (signal/news triggers) as the follow-on specs.
- [ ] **Step 2:** Process `docs/CARRYOVER.md` — close any 🔄 rows this feature resolved; file new 🔄 rows for deferred items (Phase 2/3 specs; any rubric item 7 judgement deferred to the user).
- [ ] **Step 3:** Full-suite green: `npx vitest run` (expect prior 5042 + the new cases) + `npx tsc --noEmit` (0).
- [ ] **Step 4:** Confirm `public/crisis-mockup.html` is NOT staged anywhere: `git status --porcelain | grep crisis-mockup || echo "clean"`.
- [ ] **Step 5: Commit + push**

```bash
git add docs/ROADMAP.md docs/CARRYOVER.md
git commit -m "docs(scenario): Phase-1 Crisis Brief shipped — ROADMAP + CARRYOVER (Task 10)"
git push origin main
```

---

## Self-Review (run after the plan is written)

**Spec coverage:**
- §1 Goal (cascade / score swing / narrative / revert) → Tasks 6b, 2, 3 ✓
- §2 Existing state (reuse legacy, buildContext, deriveParentComposites) → Tasks 1,2,4 ✓
- §3a driver schema → Task 1 ✓ · §3b engine → Task 2 ✓ · §3c narrative → Task 3 ✓ · §3d UI → Task 6 ✓
- §4 data flow → Task 4 route ✓
- §5 scope (Phase 1 only; 14-scenario catalog; 2 flagships first) → Task 7 + Task 0 ✓
- §6 error handling (422 no-drivers; per-company fallback; non-finite skip; AI degrade) → Tasks 4 (422 + degrade), 2 (fallback), 1 (non-finite) ✓
- §7 testing (engine no-writes; holding swing; narrative grounding; panel cascade; scenario data) → Tasks 2, 8, 3, 6a, 7 ✓
- §8 decisions (advisory ⚠ tone; worst-first ~50ms; ?mode=drivers) → Tasks 3 (prompt), 6a/6b (cascade), 4 (endpoint) ✓
- §A 14-scenario catalog → Task 7 ✓
- User mandate 1 (financial correctness) → Task 8 ✓ · mandate 2 (UX review) → Task 9 ✓

**Type consistency:** `DriverOverride`/`DriverMode`/`ScenarioDriversOverrides`/`hasDrivers`/`resolveDriverOverrides` (Task 1) used verbatim in Tasks 2, 4, 7. `DriverSimulationResult` fields (`holdingBaselineScore`, `holdingScenarioScore`, `byCompany`, `deltas`, `changed`, `worsened`, `improved`, `driftSummary`) consistent across Tasks 2, 4, 5, 8. `ScenarioBriefState` (Task 5) matches the panel usage (Task 6b). `CrisisBriefInput`/`CrisisBriefOutput` (Task 3) match the route's `runCrisisBrief` call (Task 4).

**Placeholder scan:** driver `var` names are the one deliberate deferral — resolved empirically in Task 0 and threaded forward (the plan flags this everywhere it matters, which is correct given dynamic resolver keying, not a hand-wave). All code steps contain complete code.

**Known follow-ups (not Phase 1):** Phase 2 live-feed anchoring + Phase 3 signal/news triggers get their own specs.
