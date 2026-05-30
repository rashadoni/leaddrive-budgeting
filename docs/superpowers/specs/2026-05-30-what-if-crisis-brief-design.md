# Design — What-if "Crisis Brief" (driver-grounded scenario simulation + AI narrative + cascade)

**Date:** 2026-05-30
**Status:** Approved (design), pending spec review → implementation plan
**Author:** Developer (Claude) + Rashad

## 1. Goal

Turn the Risk Terminal what-if scenario into a **maximum-wow demo moment** for AzerSheker + FO Holding execs/CFOs. One click on a crisis scenario should:

1. **Cascade** the HeatMap into its scenario colors (cells flip worst-first, staggered) — the map visibly "reacts".
2. **Swing the holding composite** number (e.g. 45 → 31) with a green→red colour shift + a delta badge.
3. **Stream an AI "Crisis Brief"** — a board-ready narrative grounded in the *actual* simulated deltas (which companies flip, EBITDA/margin Δ, score swing) + 2-3 mitigations.
4. **Revert** instantly to baseline.

The numbers must be **defensible to a CFO** — they are re-derived from real drivers (FX rate, commodity price, yield, customer concentration), not hand-wavy multipliers.

A throwaway mockup (`public/crisis-mockup.html`, untracked, not shipped) demonstrated and validated the experience with the user.

## 2. Existing state (build on, don't replace)

- `Scenario` model: `code`, names, `overrides` JSON, `isActive`.
- `src/lib/risk/scenario-simulator.ts` — `simulateScenario(overrides, ivs)`: applies **post-hoc multipliers** (`overrides.adjustments[]` × indicator values) → returns status deltas. (This is approach A; we are NOT using it for the new path, but keep it for back-compat / other callers.)
- `/api/scenarios/[id]/simulate` — current multiplier simulate endpoint.
- `ScenarioPanel.tsx` — picks a scenario → delta table → "Применить к HeatMap" → overlay + badge + revert. `ScenarioFormModal.tsx` for CRUD. `SCN <code> GO` command.
- **Key enabler:** `buildContext()` (`recompute.ts:296`) already accepts a flat `overrides` map — context variables (`fx_usd`, `sugar_price`, `revenue`, …) overridden AFTER resolvers run, BEFORE formula eval. Tested (`recompute.test.ts:532`). This is the hook the driver re-derivation rides on — **no engine re-architecture needed.**
- 6 seeded scenarios: `AZN_DEVAL_15`, `AZN_DEVAL_20`, `DROUGHT_2026`, `IRAN_HIGH`, `OIL_DROP_30`, `SUGAR_PRICE_DROP_20`. Some `adjustments` target stale indicator codes (e.g. `IND_GROSS_MARGIN`, dropped in Phase 7.M) — those no-op today.
- Composite helpers: `computeCompositeByCompany` + `deriveParentComposites` (revenue-weighted parent roll-up, 2026-05-30) — reused to compute the holding score before/after.

## 3. Architecture

Four units, each independently testable:

### 3a. Driver-override schema (`Scenario.overrides.drivers`)
A new block alongside the legacy `adjustments`:
```jsonc
"drivers": [
  { "var": "fx_usd",       "mode": "set",  "value": 2.04 },   // absolute FX rate
  { "var": "sugar_price",  "mode": "mult", "value": 0.80 },   // baseline × 0.8
  { "var": "harvest_tons", "mode": "mult", "value": 0.70 },   // yield −30%
  { "var": "top_customer_share", "mode": "set", "value": 0.0 } // structural: lose top customer
]
```
- `var` MUST match a recompute context variable (the name a resolver produces, e.g. `fx_usd`, `harvest_tons`, `sugar_price_latest`).
- `mode: "set"` → absolute override; `mode: "mult"` → `baselineResolved[var] × value`.
- A scenario with no `drivers` falls back to the legacy multiplier path (back-compat).
- **Driver-transmission caveat (verify FIRST during implementation — chief risk):** a driver only moves indicators whose formula/resolver actually consumes its `var`. Overriding `fx_usd` moves FX-rate-driven formulas, but an FX-*imported-cost* indicator computed from already-in-AZN budget lines may instead need a cost-side driver (e.g. a multiplier on `imported_input_cost` / `cogs`). The exact driver→var→indicator mapping for each flagship scenario is confirmed against the live resolvers as the **first implementation step** — and is the reason only 2 scenarios are scoped (prove transmission produces a real, dramatic swing before scaling to all 6).

### 3b. Driver-re-derivation engine (`scenario-rederive.ts`, new)
Pure orchestration over the existing `buildContext` + `recomputeIndicator`:
```
simulateByDrivers(orgId, scenario, period, { companies, indicators, baselineIVs }):
  for each company:
    1. baseCtx = buildContext(company, period)            // read resolved driver baselines
    2. overrides = {}
       for each driver: overrides[var] = mode==='set' ? value : baseResolved[var] * value
    3. scenCtx = buildContext(company, period, { overrides })   // re-eval under drivers
    4. for each indicator: recomputeIndicator(scenCtx) → scenario IV (value+status), NO PERSIST
    5. delta[(company,indicator)] = { baseline, scenario, changed }
  → holding score: deriveParentComposites over baseline cells vs scenario cells
  → return { deltas, byCompany:{baseComposite, scenComposite}, holdingBase, holdingScen, driftSummary }
```
- **No DB writes** (in-memory only) — it is a preview.
- Reuses `deriveParentComposites` so the holding swing (45→31) matches the live terminal's methodology exactly.

### 3c. AI narrative generator (`scenario-narrative.ts`, new)
- Input: the `simulateByDrivers` result (real deltas + score swing + per-company breakdown).
- Reuses `getAnthropicClient()` (same as the morning brief). New prompt: narrate the crisis at board level — lead with the holding swing, then the worst-hit companies with their *actual* numbers, then 2-3 mitigations.
- **Grounded:** the prompt receives ONLY the computed numbers; output is fact-checked against them (mirror the morning-brief "все N чисел совпали со снимком" check). Generous `max_tokens` (RU/AZ prose) per `feedback_llm_max_tokens`.
- Output language follows the existing EN/RU/AZ picker (`project_ai_output_language`).

### 3d. UI (`ScenarioPanel` enhancement)
- New "▶ Запустить кризис" action (preset scenario or `SCN <code> GO`).
- **Cascade:** changed cells flip to scenario colours staggered, worst (red) first (~40-70ms apart).
- **Score swing:** holding composite tweens baseline→scenario with colour shift + `▼ −N` badge.
- **Narrative:** streams in line-by-line below (tag-safe), then mitigations.
- **Revert:** "× Baseline" clears overlay + narrative.
- Overlay state lives in `terminalStore` (existing `setScenarioDelta` pattern).

## 4. Data flow

```
SCN <code> GO / click
   → GET /api/scenarios/[id]/simulate?period=&mode=drivers
        → simulateByDrivers()  (buildContext+overrides, no persist)
        → scenario-narrative (Anthropic, grounded)
   → response { deltas, holdingBase, holdingScen, byCompany, narrative, mitigations }
   → terminalStore.setScenarioDelta(...)
   → ScenarioPanel: cascade → score tween → narrative stream
```

## 5. Scope (YAGNI)

- **In:** the driver engine, the narrative generator, the panel animation, and **2 flagship scenarios re-authored with drivers** — `AZN_DEVAL_20` (FX) + `DROUGHT_2026` (yield). These cover the two most demo-relevant crises (currency + agro).
- **Out (follow-up):** the other 4 scenarios (re-author later with the same schema); ad-hoc/custom driver entry (type-your-own what-if); side-by-side baseline|scenario dual-grid. The legacy multiplier path stays for any scenario without `drivers`.

## 6. Error handling

- Scenario with no `drivers` AND no usable `adjustments` → 422 (as today for non-simulatable).
- `buildContext`/`recomputeIndicator` throw for a company → that company's cells fall back to baseline (skip, don't fail the whole sim); surfaced in `driftSummary`.
- Non-finite override (e.g. `baseResolved[var]` missing) → skip that driver (mirror `buildContext`'s "skips non-finite override values silently").
- AI narrative failure / timeout → return the deltas + score swing WITHOUT narrative (the cascade still lands; panel shows a "narrative unavailable, see deltas" note). The wow degrades gracefully, never 500s the whole panel.
- Division-by-zero in re-derived ratios → existing recompute guards (`no_budget_lines`, `non_finite`) apply unchanged.

## 7. Testing

- **Engine (unit):** given a scenario `{ fx_usd: set 2.04 }` + a fixture company with FX-exposed indicators, `simulateByDrivers` returns the expected scenario IVs + deltas; assert **no DB writes** (spy on prisma mutations). Multiplier mode: `sugar_price mult 0.8` → scenario resolved = baseline×0.8.
- **Holding swing:** scenario deltas → `deriveParentComposites` → expected revenue-weighted holding score (reuse the helper's tested behaviour).
- **Narrative grounding:** the generator is fed a fixed simulation result → asserts the output cites only those numbers (no invented figures); failure path returns deltas-only.
- **Panel:** cascade orders red-first; revert restores baseline; SCN command triggers the drivers path.
- **Scenario data:** the 2 re-authored scenarios' `drivers` reference live context variables (no stale codes) and produce a non-trivial holding swing.

## 8. Decisions (resolved)

- **Narrative tone:** advisory-CFO framing with a ⚠ crisis lead (as validated in the mockup) — names the holding swing first, then the worst-hit companies with their real numbers, then mitigations. Not pure alarmism.
- **Cascade:** worst-first (red cells lead), default ~50ms/cell, tuned to the real cell count during implementation so the full reflow lands in ≈1.5–2.5s (dramatic but not dragging).
- **Endpoint:** extend the existing `/api/scenarios/[id]/simulate` with `?mode=drivers` rather than a new route — the legacy multiplier path stays the default for scenarios without `drivers`.
