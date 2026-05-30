# Crisis Brief — Financial-Correctness Verification (Task 8)

**Date:** 2026-05-30 · **Period:** 2026 · **Org:** AzerSheker (8 entities, root `AZSEKER`)

Verified against the LIVE DB via `scripts/verify-crisis-correctness.ts` (read-only; engine wraps the DS so writes are no-ops).

## Gate results

| Check | Result |
|---|---|
| No DB writes (count before==after) | ✅ 181 → 181 unchanged |
| Baseline consistent across scenarios | ✅ holding baseline = 61 for all 3 |
| Baseline == on-screen persisted values | ✅ deltas start from persisted IV values |
| INPUT_COST_30 direction | ✅ margins compress (MALT 19.63→−4.48, CPC 23.43→0.46 amber→red); holding 61→58 |
| AZN_DEVAL_20 direction | ✅ FX_IMPORTED_INPUT 0→33.96% green→amber on 4 food-proc entities; holding 61→58 |
| REVENUE_DROP_30 direction | ⚠️ holding flat (61→61); an ESG indicator improves — see Concerns |
| P&L recompute consistency (unit) | ✅ scenario-shock.test.ts (new_gross_profit = new_revenue − new_cogs, etc.) |
| Holding swing Σ-math (unit) | ✅ scenario-rederive.test.ts (revenue-weighted parent = 83 fixture) |

## Bugs caught + fixed during this gate (engine)

1. **`recomputeIndicator` always persists** (`recompute.ts:805`, no skip flag) — the preview path was silently writing scenario values into period-2026 IVs, poisoning the next scenario's baseline + the real HeatMap. **Fixed:** engine wraps the DS so `upsertIndicatorValue` is a no-op.
2. **Full-cartesian recompute** — the loop recomputed every company×indicator (392) → simulated industry-irrelevant pairs + created spurious rows. **Fixed:** iterate only the (company, indicator) pairs that have a baseline IV (the real HeatMap cells).
3. **DB cleanup** — the first buggy run contaminated period-2026 IVs; user-approved delete + canonical recompute restored a pristine 181-pair baseline. `AZSEKER-FARM` (isActive=false) correctly carries no IVs — its prior 24 were stale invisible data (the validated mockup never showed FARM).

## Open concerns (economic tuning — need product/finance steer)

- **Modest holding swing (≈3 pts).** A 30% cost shock flips multiple margin cells red, but the holding composite only moves 61→58 because it averages ~30 indicators/company (ESG, carbon, news, etc. don't react to a financial shock). The per-company drops (EDEN 62→55, CPC 64→61) + the cell cascade are the visible drama; the single holding number is diluted. Options: (a) accept the honest number + lean on the cascade/narrative for wow; (b) add a "financial-stress" composite weighting; (c) lead the demo with harsher tails (INPUT_COST_50).
- ~~**REVENUE_DROP_30 is a wash.**~~ **RESOLVED 2026-05-30.** Added a `costRigidity` lever to the shock model: a volume drop scales cogs only for its variable portion `(1 − rigidity)`. Renamed the flagship to `DROUGHT_2026` with `costRigidity: 0.8` — a drought destroys yield *after* seeds/fertilizer/labour/irrigation are sunk, so revenue falls but cost barely does → margins crushed (MALT 19.63→−7.92, CPC 23.43→−2.82, amber→red). `LOSE_TOP_CUSTOMER_20` keeps `costRigidity: 0` (fully variable — produce less). Verified directionally correct.
- **Non-financial indicators move spuriously** (e.g. CPC ESG composite 33→53 under a revenue drop) because `scenarioOverrides` is global per company — every formula reading `revenue` reacts, including revenue-normalized ESG/intensity metrics. Options: (a) restrict the scenario delta display to financial indicators; (b) accept (intensity genuinely changes with revenue) but exclude ESG from the crisis narrative.

## Repro

```
set -a; source .env; set +a
npx tsx scripts/verify-crisis-correctness.ts   # read-only, prints swings + no-writes proof
```
