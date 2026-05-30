# Design — Crisis Brief Phase 2: live-feed anchoring + shock-from-target

**Date:** 2026-05-30 · **Status:** Approved (scope chosen by user: grounding + shock-from-absolute-target) · **Builds on:** Phase 1 (`…/2026-05-30-what-if-crisis-brief-design.md`).

## 1. Goal

Turn abstract scenarios ("AZN −20%") into **reality-anchored** ones: a scenario may target an **absolute level** (AZN/USD → 2.04, Brent → $80, FAO sugar → 70), and the engine derives the fractional shock from the **current live feed** value. The panel + AI narrative show "current → scenario" from the real market level with a freshness badge. Read-only on the feed; the B2 P&L math is unchanged downstream.

## 2. Live feed (verified 2026-05-30)

`currency_rate_history` (fresh 28 May): AZN_USD **1.70**, AZN_EUR 1.977. `intel_data_points`: `cbar-official-fx` AZN_USD 1.70 (28 May) · `eia-energy` BRENT_USD_BBL **110.53** (14 May) · `fao-food-prices` FAO_SUGAR_INDEX **88.5** (31 Mar) · `openmeteo-forecast` rainfall 14d (28 May) · `az-stat-cpi` CPI (Nov-2024, **stale**). Freshness varies → must be labeled.

## 3. Architecture (4 units)

### 3a. Shock `target` schema (extend `ScenarioShock`)
```jsonc
"shock": {
  "target": { "metric": "AZN_USD", "value": 2.04, "drives": "fxShock" }
  // engine: frac = value / currentLevel(metric) − 1  →  shock.fxShock = frac
}
```
- `metric` ∈ a fixed allow-list mapped to a feed source (`AZN_USD`/`AZN_EUR` → currency_rate_history; `BRENT_USD_BBL`/`FAO_SUGAR_INDEX`/`FAO_CEREAL_INDEX` → intel_data_points).
- `drives` ∈ `fxShock | priceShock | inputCostShock` — which B2 param the fractional change feeds.
- `target` is OPTIONAL; a scenario with a plain fractional shock (Phase 1) is unchanged. When both present, `target` wins for its `drives` param.
- Mapping rationale: FX is 1:1 (`fxShock`); a sugar/output-price target drives `priceShock` (AzerSheker is a sugar PRODUCER → price hits revenue); an oil/grain input target drives `inputCostShock`. The fractional change applies 1:1 to its param (a scenario assumption, stated in the narrative — no hidden transmission coefficient).

### 3b. Feed resolution (`scenario-feed-context.ts`, new — pure)
- `FeedSnapshot = Record<string, { value: number; asOf: string; stale: boolean }>` (keyed by metric).
- `resolveFeedShock(shock, snapshot): ScenarioShock` — resolves `target` → its `drives` fraction; drops the target if the metric is missing/zero (falls back to any plain fraction). Pure.
- `resolveFeedContext(shock, snapshot): FeedAnchor[]` — display rows `{ label, metric, currentValue, scenarioValue, unit, asOf, stale }`. `scenarioValue = target.value` (absolute) when present, else `current × (1 + frac)`.
- `STALE_DAYS = 45` (FX/weather fresh; FAO/CPI flagged). Staleness computed from `asOf` vs a `now` passed in (no `Date.now()` in pure code — caller stamps).

### 3c. Engine + route wiring
- Route reads the latest feed once (`currency_rate_history` DISTINCT ON + `intel_data_points` latest-per-metric), builds the `FeedSnapshot`, calls `resolveFeedShock` BEFORE `simulateByDrivers` (so the engine sees a concrete fraction — engine signature unchanged), and computes `resolveFeedContext` for the response (`feedAnchors`).
- `simulateByDrivers` is unchanged (still consumes a resolved `ScenarioShock`). Keeps the engine pure + already-tested.

### 3d. UI + narrative
- Panel: a "📊 От реального уровня" row per anchor — `AZN/USD 1.70 → 2.04 (CBAR · 28 мая)`, freshness badge (✅/🟡/⚠ stale).
- Narrative: `feedAnchors` passed into `CrisisBriefInput` → prompt cites the real starting level ("при текущем курсе 1.70 AZN/USD…") and, when stale, the LLM notes the data date.
- Store `scenarioBrief` carries `feedAnchors`.

## 4. Catalog changes
- `AZN_DEVAL_20` → `target {AZN_USD, 2.04, fxShock}` (≡ today's 0.20 at 1.70, now grounded). `AZN_DEVAL_15` → target 1.955.
- New `SUGAR_PRICE_TO_70` → `target {FAO_SUGAR_INDEX, 70, priceShock}` (−20.9% from 88.5).
- New `BRENT_TO_140` → `target {BRENT_USD_BBL, 140, inputCostShock}` (+26.6% energy/fertilizer cost). *(Brent UP = cost up.)*
- Plain-fraction scenarios (INPUT_COST_30, DROUGHT_2026, …) unchanged.

## 5. Scope / non-goals
- **In:** absolute-target → fraction resolution from live feed; from→to display + freshness; narrative grounding.
- **Out:** no transmission coefficients (1:1 fraction per `drives`); no new feed sources / scrapers (Phase 3); no auto-suggesting scenarios from feed moves (Phase 3 triggers); CPI/non-mapped metrics not wired.

## 6. Error handling
- Metric missing from snapshot OR currentLevel ≤ 0 → skip the target, fall back to the plain fraction (if any); never throw. Surfaced as no anchor row.
- Stale feed → still used (latest known), flagged `stale:true` + dated in UI/narrative.
- No feed at all (empty DB) → scenarios behave exactly as Phase 1 (plain fractions); no anchors shown.

## 7. Testing
- `resolveFeedShock`: target → correct fraction (2.04/1.70−1=0.20); missing metric → fallback; zero current → skip.
- `resolveFeedContext`: from→to rows; absolute scenarioValue; staleness flag by date.
- Engine: unchanged tests still green (it sees a resolved fraction).
- Route: feed read → snapshot → resolved shock passed to engine; `feedAnchors` in response; missing-feed graceful.
- Catalog: AZN_DEVAL_20 target resolves to ≈0.20 against the live 1.70.
- Live verify: `verify-crisis-correctness.ts` prints anchors; AZN_DEVAL_20 swing == the pre-Phase-2 swing (proves the target ≡ the old fraction).

## 8. Decisions (resolved)
- Shock-from-target IN (user choice). 1:1 fraction per `drives` (no coefficient) — simplest defensible; the cause label + narrative carry the economic story.
- Staleness: show + label, never hide (transparency).
- Engine stays pure/unchanged — target resolution happens in the route layer before the engine call.
