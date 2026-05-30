# Design — Crisis Brief Phase 3: live price/weather signal triggers

**Date:** 2026-05-30 · **Status:** ✅ SHIPPED 2026-05-30 (strip-in-terminal, price/weather; news OUT — Phase 3b, data-blocked) · **Builds on:** Phase 1+2.

## 1. Goal

The terminal "watches the world": when the live feed shows a notable condition, a **signals strip** at the top suggests the matching crisis scenario. One click opens the Scenario panel pre-selected on that scenario. Read-only detection; **news triggers are OUT** (raw news = 0 rows — Phase 3b, data-blocked).

## 2. Signals (data-grounded, all fire on current feed)

| id | Condition (live feed) | → suggested scenario | severity |
|---|---|---|---|
| `fx-depreciation` | 12M USD/AZN forward / spot − 1 > **1.5%** (now 1.7527/1.70 = +3.1%) | `AZN_DEVAL_15` | high |
| `oil-elevated` | Brent > **$95** (now $110.53) | `BRENT_TO_140` | medium |
| `drought` | min regional 14d rainfall < **15 mm** (now 11.5 mm, Beylaqan) | `DROUGHT_2026` | high |
| `sugar-pressure` | FAO sugar index < **90** (now 88.5) | `SUGAR_PRICE_TO_70` | medium |

Thresholds are **heuristics** (labeled as such). Stale feeds still fire but are date-flagged.

## 3. Architecture (3 units)

### 3a. Detector (`scenario-signals.ts`, new — pure)
- `detectSignals(snapshot: FeedSnapshot): Signal[]` where `Signal = { id; severity: 'high'|'medium'; label; detail; suggestedScenarioCode; asOf; stale }`.
- Reads snapshot keys `AZN_USD`, `FX_FORWARD_USD_AZN_12M`, `BRENT_USD_BBL`, `FAO_SUGAR_INDEX`, `RAINFALL_14D_MIN` (a route-computed min across the regional `*_RAINFALL_MM_14D_FCST` metrics). A rule fires only when its inputs are present + finite. Pure (no DB/Date).

### 3b. Route (`GET /api/scenarios/signals`, new)
- Reads the same feed as Phase 2 + the FX forward + the regional rainfall metrics → builds the extended snapshot (incl. `RAINFALL_14D_MIN`) → `detectSignals` → returns `{ signals }`. Auth-gated (requireAuth). Read-only.

### 3c. UI — terminal signals strip (`SignalsStrip.tsx`, new)
- Renders at the top of the terminal page (`(dashboard)/budgeting/terminal/page.tsx`), above the panel grid. Fetches `/api/scenarios/signals` on mount.
- Each signal = a chip: severity dot · label · "→ <scenario>" · freshness. Click → `setActiveScenarioCode(suggestedScenarioCode)` + dispatch `terminal:open-scenario` (existing event the ScenarioPanel listens on) → panel opens pre-selected. Empty/erroring → strip renders nothing (no layout cost when no signals).
- **Visual gate:** the strip shifts the viewport → `terminal-heatmap.png` drifts → regenerate baseline + `BASELINE UPDATE: Phase 3 signals strip (layout)` commit (run via the e2e auth fixture; if the dev-admin pw is rotated, hand the regen to the user).

## 4. Scope / non-goals
- **In:** 4 price/weather signals; strip; click→pre-select. **+ Phase 3b (SHIPPED same day): news-derived triggers** — the "0 rows → blocked" premise was stale; `intel_items` has 20 real items, so `detectNewsSignals` (negative sentiment + keyword + tag → scenario) was built + merged into the strip (📰). News IS now in.
- **Out:** auto-RUN on click (we pre-select, user clicks Запустить); configurable thresholds UI; new scrapers / feeding the crawler with more sources.

## 5. Error handling
- Missing feed metric → that rule doesn't fire (no signal). Empty signals → strip renders nothing.
- Route failure → strip silently hides (never breaks the terminal). Stale feed → fires + date-flagged.

## 6. Testing
- `detectSignals`: each rule fires at/over its threshold, not under; missing input → no fire; freshness carried. Multiple fire together.
- Route: feed → snapshot (incl. RAINFALL_14D_MIN min-compute) → signals; missing feed → []; auth.
- Strip: renders chips; click dispatches the open-scenario event with the code; empty → nothing.
- Visual gate: regenerate `terminal-heatmap.png` with `BASELINE UPDATE:` (layout, not data).

## 7. Decisions
- Strip in terminal (user choice — more wow; accepts the visual-baseline regen).
- Pre-select (not auto-run) on click — the user still pulls the trigger (consistent with the explicit-action principle).
- Heuristic thresholds, labeled; stale shown not hidden.
