# Owner Decision Pack — T-1 to T-5

**Prepared:** 2026-07-19
**Status:** T-1 recorded 2026-07-19 as Option A's tolerance _shape_ for shadow methodology only (see §7.1); T-2–T-5 remain proposed and **not approved**. Nothing here is enforced, certified or decision-grade.
**Scope:** FO Holding controlled beta; active operational pilot companies only
**Runtime effect:** none — this document changes no formula, KPI, threshold, score, database row, provider call or feature flag

## 1. Decision summary

This pack converts the five open Trust Core questions into explicit choices. The recommended package is:

| Decision | Recommended owner choice | Unlocks |
|---|---|---|
| T-1 | Dual reconciliation tolerance: absolute currency floor **or** 0.001% of the control total, whichever is larger; every breach blocks reconciliation until explained | B1 canonical statement mart and golden controls |
| T-2 | Approve the 80% material-coverage gate with 100% mandatory-financial coverage, a 60% minimum per material domain and hard stale/lineage/reconciliation gates | B6 abstention and B7 decision-grade eligibility |
| T-3 | Publish Confidence as a separate 0–100 evidence score using the seven-factor model in §4; hard gates always override the numeric score | B6 Confidence publication |
| T-4 | Use six explicit domain weights, revenue-weighted portfolio aggregation for financial/operational risk, and separate critical-event overlays; remove invisible risk-tag penalties from the V2 score | B6/B7 composite methodology |
| T-5 | Approve the 30-code pilot envelope in §6 for CPC, EDEN, PROMALT and Azərşəkər Sugar; each KPI remains provisional until its own specification reaches `Effective` | B4 registry scope |

Approval of this pack authorizes methodology implementation and shadow testing only. It does not certify current observations, enable V2, call a paid provider or authorize production cutover.

## 2. Evidence used

The proposal is grounded in the current repository contracts and one read-only production audit on 2026-07-19.

Active operational pilot population:

| Company | Industry | State |
|---|---|---|
| AZSEKER-CPC — CPC MMC | `food_processing` | active |
| AZSEKER-EDEN — EDEN AGRO MMC | `agro_crops` | active |
| AZSEKER-PROMALT — PROMALT MMC | `food_processing` | active |
| AZSEKER-AZSF — Azərşəkər Sugar | `food_processing` | active |

The 30 proposed KPI codes create **88 applicable company × KPI pairs** for period `2026`. Production currently has an `IndicatorValue` row for all 88 pairs, but only **43 are known/coloured (48.9% unweighted availability)**; 45 are `unknown`. Among those 88 rows, **0 carry `revisionId` and 0 carry `lastReconciledAt`**. Therefore the proposed 80% gate would correctly abstain today.

This is a coverage baseline, not a reconciliation or approval claim. Existing colours remain Legacy/Provisional until lineage, reconciliation, freshness and methodology gates pass.

## 3. T-1 — reconciliation tolerance

### 3.1 Recommended rule

For every signed control difference:

```text
delta = canonicalAmount - approvedSourceAmount
basis = max(abs(canonicalAmount), abs(approvedSourceAmount))
tolerance = max(currencyAbsoluteFloor, basis × 0.00001)
pass = abs(delta) <= tolerance
```

`0.00001` is **0.001% (0.1 basis point)**. The signed delta is always stored and displayed even when it passes.

Recommended absolute floors:

| Currency/control | Absolute floor |
|---|---:|
| AZN statement/control total | 1.00 AZN |
| USD, EUR, GBP source-currency control | 0.01 source-currency unit |
| Other currencies | one ISO minor unit; if unavailable, explicit Finance configuration is required |
| Unit/count controls | exact equality; no monetary tolerance |

The same dual rule applies to:

- P&L approved control totals;
- `Assets = Liabilities + Equity`;
- ending cash versus the Balance Sheet cash control;
- original-currency and base-currency totals;
- source-row totals versus normalized facts.

Sign, unit, currency, company, period and source-row mapping are exact structural gates. A tolerance must never turn a sign, unit or period error into a pass.

### 3.2 Severity is separate from pass/fail

Every breach fails reconciliation. For triage only:

```text
materialDifference = abs(delta) > max(10,000 AZN, basis × 0.001)
```

This is 0.1% or 10,000 AZN, whichever is larger. A smaller failed difference still needs an explanation or correction; it is simply lower in the work queue. This prevents the common mistake of using management materiality as a rounding tolerance.

### 3.3 Owner alternatives

| Choice | Effect |
|---|---|
| **A — recommended:** 1 AZN / one minor unit + 0.001% | Strict enough for canonical controls while absorbing accumulated rounding noise |
| B — exact minor-unit equality only | Strongest assurance, but likely creates avoidable false failures after FX conversion and aggregated spreadsheet rounding |
| C — 0.01% relative tolerance | Easier operationally, but permits a 10,000 AZN unexplained gap on a 100M control and is not recommended for certification |

## 4. T-2 and T-3 — Coverage, abstention and Confidence

### 4.1 T-2 recommended abstention gate

```text
decisionGrade = materialCoverage >= 80%
                AND mandatoryFinancialCoverage == 100%
                AND everyMaterialDomainCoverage >= 60%
                AND mandatoryFinancialGatesPass
                AND noCriticalStaleOrLineageFailure
                AND everyContributingKpiSpecificationIsEffective
```

Rules:

- `unknown` and missing stay in the denominator;
- `notApplicable` leaves the denominator only with an explicit applicability reason from the effective KPI specification;
- Tier D modeled/proxy evidence cannot independently satisfy material coverage or create a confirmed alert;
- below the gate the product shows `Provisional` / `Insufficient coverage`, the missing material evidence and data-quality events;
- below the gate there is no green composite and no confirmed financial-breach alert;
- 80% is inclusive: exactly 80% passes only if every hard gate also passes.

The 60% per-domain floor prevents a globally high score from hiding a completely missing material domain. The 100% mandatory-financial gate prevents external or operational signals from compensating for unreconciled financial statements.

### 4.2 T-3 recommended Confidence formula

Each factor is scored from 0 to 100 over applicable material weight:

```text
Confidence = 0.30 × Coverage
           + 0.15 × Freshness
           + 0.20 × Reconciliation
           + 0.15 × Lineage
           + 0.10 × EvidenceTier
           + 0.05 × Methodology
           + 0.05 × SanityChecks
```

| Factor | 100 | Partial | 0 / hard failure |
|---|---|---|---|
| Coverage | all applicable material weight eligible and known | weighted known share | no eligible material evidence |
| Freshness | within the KPI/source SLA | inside an approved grace window | stale, invalid/future timestamp or missing As-of |
| Reconciliation | passed signed controls | `not_applicable` for a non-financial source | failed/pending for mandatory financial evidence |
| Lineage | complete source → revision → calculation → observation chain | complete chain for only part of material weight | critical input or observation untraced |
| Evidence tier | Tier A | B = 85, C = 65, D = 25 | disallowed tier for the target decision |
| Methodology | effective approved specification/version | approved but not yet effective = 50 | draft, review, superseded or missing |
| Sanity checks | all structural and range checks pass | non-critical warning = 50 | critical sign/unit/period/range failure |

Recommended display bands are `High ≥ 80`, `Medium 60–79.99`, `Low < 60`. They use neutral evidence styling, never risk green/amber/red.

Hard gates override the number. A computed Confidence of 87 with a failed mandatory reconciliation remains `decisionGrade=false`; the UI may show the number only alongside the blocking reason.

## 5. T-4 — domain and portfolio weights

### 5.1 V2 risk direction

V2 uses **Risk Index: 0 low risk, 100 critical risk**. The current Expert composite is a health score in the opposite direction (`100 = green`) and remains a labelled legacy output during shadow comparison; it must not be silently reused as V2 Risk.

For approved categorical thresholds, the initial deterministic severity mapping is:

| Status | Risk severity |
|---|---:|
| green | 0 |
| amber | 50 |
| red | 100 |
| unknown/missing | excluded from the numerator, retained in Coverage denominator |

### 5.2 Recommended company-domain weights

| Domain | Weight |
|---|---:|
| Financial performance | 30% |
| Liquidity and FX | 20% |
| Operations and production | 20% |
| Counterparty and concentration | 10% |
| Compliance, audit and legal | 10% |
| External market, weather and commodity | 10% |
| **Total** | **100%** |

Within each domain, KPI material weights come from the effective registry specification. The initial registry scale is `3 = mandatory`, `2 = core`, `1 = context`; weights are normalized inside the domain after applicability and eligibility gates.

### 5.3 Recommended portfolio rollup

- Financial, liquidity/FX and operational domain risk is weighted by the canonical positive revenue share of decision-grade pilot companies.
- If every applicable company lacks a decision-grade revenue control, the portfolio score abstains; it does **not** fall back to an unweighted mean.
- Compliance/legal critical events and any separately approved solvency hard breach are explicit portfolio overlays. They cannot be averaged away by a large healthy company.
- Unknown companies remain visible in portfolio Coverage and the missing-evidence list. They do not become zero risk.
- Qualitative `riskTags` are explicit drivers/events. V2 does not apply the current invisible `data_absence`, `non_transparent_structure` or `subsidy_dependency` point penalties.
- No additional nonlinear multiplier is approved in this first package. Any later tail-risk rule needs a versioned methodology and shadow comparison.

## 6. T-5 — proposed 30-KPI pilot envelope

Materiality: `M = 3 mandatory`, `C = 2 core`, `X = 1 context`. The weight affects Coverage and within-domain aggregation only after the KPI is eligible.

### 6.1 Cross-company core — 11

| # | Code | Domain | Tier | Weight | Required certification work |
|---:|---|---|---|---:|---|
| 1 | `IND_EBITDA_MARGIN` | Financial | A | M | canonical EBITDA bridge, same-period revenue and T-1 reconciliation |
| 2 | `CUSTOMER_HHI` | Concentration | B | C | controlled counterparty population and share-total control |
| 3 | `TOP_CUSTOMER_SHARE` | Concentration | B | C | same controlled customer register |
| 4 | `TOP3_CUSTOMER_SHARE` | Concentration | B | C | same controlled customer register; prove no duplicate customer identities |
| 5 | `SUPPLIER_HHI` | Concentration | B | C | controlled supplier population and share-total control |
| 6 | `FX_IMPORTED_INPUT` | Liquidity/FX | A/B | C | complete currency tagging and FX source lineage |
| 7 | `REVENUE_FX_EXPOSURE` | Liquidity/FX | B | C | replace unsupported setting-only assumptions with controlled disclosure/source |
| 8 | `LEGAL_CASES_ACTIVE` | Compliance/legal | B | C | source ledger completeness, point-in-time semantics |
| 9 | `LEGAL_CASES_TOTAL` | Compliance/legal | B | X | YTD flow semantics and source ledger completeness |
| 10 | `AUDIT_CLOSED_PCT` | Compliance/legal | B | C | finding population, closure evidence and denominator control |
| 11 | `AUDIT_MAJOR_OPEN` | Compliance/legal | B | M | major-severity definition and current open-population control |

### 6.2 Food-processing pack — 8

Applies to CPC, PROMALT and Azərşəkər Sugar.

| # | Code | Domain | Tier | Weight | Required certification work |
|---:|---|---|---|---:|---|
| 12 | `FP_GROSS_MARGIN` | Financial | A | M | canonical revenue/COGS mapping and T-1 reconciliation |
| 13 | `FP_OPEX_RATIO` | Financial | A | C | canonical OpEx classification and same-period denominator |
| 14 | `FP_INVENTORY_TURNS` | Operations | A | C | replace closing inventory with approved average-inventory method; period annualization |
| 15 | `FP_YIELD_LOSS` | Operations | B | C | controlled raw-input and finished-output facts |
| 16 | `FP_EXTRACTION_RATE` | Operations | B | C | controlled disclosed recovery rate and snapshot date |
| 17 | `FP_FAO_FOOD_INDEX_SIGNAL` | External | C | X | source As-of, historical-period rule and freshness SLA |
| 18 | `FP_WHEAT_PRICE_SIGNAL` | External | C | X | source As-of, unit and freshness SLA |
| 19 | `FP_GRAIN_COST_PRESSURE_BLEND` | External | C | X | both source lineages and same-As-of policy for the blend |

### 6.3 Agro pack — 11

Applies to EDEN; `AGRO_COMMODITY_VOL`, `AGRO_SUGAR_PRICE_TREND` and `AGRO_SUGAR_CONTENT` are also applicable to the food-processing pilot companies under the current catalog.

| # | Code | Domain | Tier | Weight | Required certification work |
|---:|---|---|---|---:|---|
| 20 | `AGRO_COMMODITY_VOL` | External | C | X | trailing-12M completeness, source lineage and As-of |
| 21 | `AGRO_SUGAR_PRICE_TREND` | External | C | X | latest/12M-mean alignment and historical-period rule |
| 22 | `AGRO_YIELD_PER_HA` | Operations | B | M | controlled direct disclosure; weighted-field methodology and snapshot date |
| 23 | `AGRO_SUGAR_CONTENT` | Operations | B | C | controlled assay/disclosure source and crop applicability |
| 24 | `AGRO_WATER_INTENSITY` | Operations | B | C | controlled meter/area disclosure and same-area basis |
| 25 | `AGRO_FERTILIZER_INTENSITY` | Operations | B | C | controlled input/area disclosure and crop-cycle period |
| 26 | `AGRO_CUT_TO_MILL` | Operations | B | C | population weighting and harvest-window semantics |
| 27 | `AGRO_HARVEST_PROGRESS` | Operations | B | M | add season-progress context before threshold certification |
| 28 | `AGRO_DROUGHT_RISK` | External/operations | B/C | C | name the authoritative source, As-of and regional scope |
| 29 | `AGRO_WEATHER_RAINFALL` | External | C | X | region mapping, trailing-window completeness and historical As-of |
| 30 | `AGRO_SALYAN_RAINFALL_14D_FCST` | External | C | X | forecast issue time, horizon expiry and EDEN/Salyan applicability |

### 6.4 Explicitly outside T-5

- `AGRO_REVENUE_PER_HA`, `AGRO_COST_PER_HA`, `AGRO_YIELD_EFFICIENCY`: excluded by the owner-approved T-7 interim posture until denominator and financial reconciliation are approved.
- `RE_DEBT_SERVICE_COVERAGE`: excluded until T-6 approves the numerator and scheduled-principal source.
- `IND_REVENUE_TOTAL`, `IND_HOLDING_REVENUE`: internal calculation building blocks, not decision KPIs.
- ESG/carbon composite indicators: currently modeled/proxy evidence; remain Research/Expert until source and methodology approval.
- `IND_NEWS_SENTIMENT_30D`: remains contextual Research/Expert until entity matching, freshness and evidence lineage are certified.
- Anthropic is an explanation provider, not a KPI source, and paid LLM calls remain explicit-user-action only.
- Paid Google Trends indicators are not in this pilot because the four active companies are `agro_crops`/`food_processing`; the existing Trends codes target retail/entertainment/hospitality. Their exclusion does **not** mean the integration is broken.
- KPI packs for hospitality, real estate, services, industrial, retail, pharma, poultry, logistics, construction, education, entertainment and beverage remain Research/Expert until a company from that industry joins the controlled pilot.

## 7. Approval record

The owner may approve the package as a whole or record changes row by row.

| Decision | Proposed choice | CFO | Risk Owner | Finance Controller | Effective date |
|---|---|---|---|---|---|
| T-1 | §3 **Option A** dual tolerance — SHAPE approved for shadow methodology; decision-grade gated on §7.1 conditions + one shadow close cycle | approved — Aziz Azizov (CFO) | — | approved — Suleyman Suleymanov (Finance Controller) | 2026-07-19 (shadow) |
| T-2 | §4.1 enhanced 80% gate | pending | pending | — | — |
| T-3 | §4.2 seven-factor Confidence | pending | pending | — | — |
| T-4 | §5 weights and rollup | pending | pending | — | — |
| T-5 | §6 30-code pilot envelope | pending | pending | pending | — |

T-1 is recorded as of 2026-07-19: the owner selected **Option A's tolerance shape for shadow methodology only** (see §7.1). T-2 through T-5 remain open. Even for T-1, engineering may prepare non-enforcing golden fixtures/tests, but it must not claim `reconciled`, `methodology-approved` or `decision-grade`, and must not enable the V2 score, until the §7.1 shadow-gate conditions and approved golden evidence land.

### 7.1 T-1 recorded decision — Option A shape, shadow-only (2026-07-19)

**Selected:** Option A — dual tolerance `max(absoluteFloor, basis × 0.00001)` (0.001% = 0.1 bp), absolute floors 1.00 AZN / 0.01 source-minor-unit / one ISO minor unit otherwise, unit/count controls at exact equality, materiality (`> max(10,000 AZN, basis × 0.001)`) as a separate non-gating triage flag. Recorded by Aziz Azizov (CFO) and Suleyman Suleymanov (Finance Controller); Risk Owner not applicable to T-1.

**This records the tolerance _shape_ for shadow evaluation. It does NOT certify any observation, enable V2 or authorize cutover.** A finance judge-panel (Group Financial Controller, external IFRS auditor and reconciliation-engineering lenses) ranked A first unanimously (B second, C last), but the adversarial review confirmed A as written does not yet deliver the FX/sign assurance it advertises. Two residual gaps and nine conditions gate any move to decision-grade.

**Two assurance gaps A cannot close by tolerance alone:**

1. **Uniform-wrong-FX-rate blindness.** Currency is an exact structural gate, so both sides are already in AZN base; a wholesale-wrong translation rate scales assets, liabilities and equity together, so `A = L + E` and the cash-flow sum still balance exactly (signed delta 0 — a false pass of unbounded size). Invisible to A, B and C alike. Closable only by a sixth `fx_translation` control per source currency (`base = Σ local × rate` vs the AZN figure), plus evidenced `fx_effect_on_cash` and CTA/OCI `translation_adjustment` components.
2. **No sign gate.** The evaluator implements no sign check although this pack calls sign an exact structural gate. A near-breakeven inversion (e.g. net income +0.40 vs −0.40 → delta 0.80 ≤ the 1.00 AZN floor) certifies clean. Seasonal agro/food entities sit near zero often enough that this is a normal state, not a corner case.

**Nine shadow-gate conditions before A may gate confirmed colour/alerts/board:**

1. add a structural sign gate for `net_income_link`, `retained_earnings` and `cash_to_balance_sheet` — **implemented 2026-07-19 (evaluator-level, applies to all five controls; IMPLEMENTATION-STATUS §41), shadow-only**;
2. implement the sixth `fx_translation` control and run each identity in both local and AZN base currency (route "local agrees, base differs" to an FX-review queue) — **the pure `fx_translation` control + builder are implemented 2026-07-19 (per source currency; IMPLEMENTATION-STATUS §42), shadow-only. Its soundness rests on an owner precondition the pure builder cannot verify: the recompute rate must be INDEPENDENT of the ledger's own rate, or a wholesale-wrong rate cancels on both sides. The dual-currency runs of the other five identities and the FX-review queue are a runtime/caller concern, not yet built.**;
3. carry evidenced `fx_effect_on_cash` and CTA/OCI `translation_adjustment` components in the builders — **implemented 2026-07-19 as optional, backward-compatible plug terms (IMPLEMENTATION-STATUS §43), shadow-only: `translationAdjustment` on `balance_sheet` (right side, closing), `fx_effect_on_cash` on `cash_to_balance_sheet` (canonical) and `cash_flow_sum` (left side, flow); `retained_earnings` is deliberately unchanged (IAS 21 keeps the CTA in a separate OCI/FCTR reserve, not RE). Double-counting (equity that already includes the FCTR, or the FX effect placed on both cash controls) is a caller precondition the pure builder cannot verify.**;
4. validate the 1.00 AZN floor and qəpik precision against the smallest real pilot (EDEN) — a whole-AZN-rounded four-component roll-forward can accumulate ~2–2.5 AZN and false-break a clean close;
5. make the materiality floor scope-aware (10,000 AZN consolidation; `max(1,000 AZN, basis × 0.001)` for single small entities) and render every `outside_tolerance` result regardless of the material flag;
6. forbid caller-supplied `basisAmount` for the five controls (or bound it to `≤ max(|left|, |right|)`), else the tolerance is caller-loosenable into C under an "A" label;
7. pre-register absolute floors for every source currency actually present in the pilots (at least AZN, USD, EUR, and likely TRY, RUB) in both floor maps;
8. unit-test the builder sign convention against real pilot imports (this codebase stores liabilities/equity negative; the evaluator trusts builder polarity entirely);
9. keep `decisionStatus` provisional across all four pilots for at least one full close after `revisionId` lineage lands, and produce a shadow-run report plus committed determinism test vectors for Controller + Auditor sign-off before flipping `policy.approval` to `approved`.

**Changes no live value today.** All 88 pilot company × KPI pairs carry 0 `revisionId` and 0 `lastReconciledAt`, so every control already resolves `provisional` (lineage_missing + policy_not_approved) regardless of A/B/C; this record changes no colour, formula, threshold, score, row, schema, provider call or feature flag. **Recorded minority position:** Option B's exact equality has the safer failure direction and is mandatory for future count/quantity controls — A's monetary policy must never be reused there.

**Scope defect to resolve before controls gate colour:** AZSEKER-CPC is labelled `food_processing` in §2 but `agro_crops` in the org-context line used elsewhere; scope gates key off company classification, so reconcile the label first.

## 8. What follows after approval

1. T-1: build B1 golden statement fixtures and the signed reconciliation result contract.
2. T-5: create versioned registry specifications for the 30 codes; move each through Draft → Review → Approved → Effective.
3. T-2/T-3/T-4: implement B6 as a pure, versioned scoring module behind the disabled V2 path, with the 88-pair baseline as an abstention regression.
4. B7: prove confirmed events can originate only from effective, decision-grade observations.
5. Run old/new shadow comparison; no production cutover until lineage, reconciliation, UAT, one close cycle and rollback gates pass.
