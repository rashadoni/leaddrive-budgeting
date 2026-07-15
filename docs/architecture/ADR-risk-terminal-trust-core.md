# ADR: Risk Terminal 2.0 Trust Core

- **Status:** Accepted (contract only — no implementation yet)
- **Date:** 2026-07-15
- **Phase:** 10, Stage A (PR 1, documentation/ADR only)
- **Sources:** `docs/risk-terminal-2.0/03-DATA-KPI-TRUST-SPEC.md`,
  `04-TECHNICAL-IMPLEMENTATION-PLAN.md` §6, §12; `01-AUDIT-BASELINE.md`
- **Supersedes:** nothing. **Superseded by:** nothing.

## Context

The terminal today computes indicators, thresholds, history, scenarios and
alerts, and it does so on a real formula engine — the infrastructure is not the
problem. The problem is that a rendered value does not currently prove it is
reproducible: "the formula executed" is not "the indicator is methodologically
correct against an approved source".

Today's session made that concrete rather than theoretical. Debugging one client
workbook surfaced five defects that each silently changed money on screen:

- other-operating income (subsidies) was **subtracted** from revenue because the
  sign convention was read off `accountType` instead of the importer's
  `lineType` — Net Profit read −10.6M against the workbook's +3.83M;
- credit notes were **added** to cost (`Math.abs()` per row before summing);
- a whole month of revenue was booked to the previous month **and year** by a
  24-second timezone drift in date materialisation;
- a quantity column headed "Ton" held kilograms, so price read 1000× low;
- an entity alias routed an operating company's P&L to the holding, which the
  terminal excludes — the company's row rendered blank while the holding's
  rollups double-counted.

None of these were caught by types or unit tests. Each was caught by comparing a
rendered number against the source workbook. That is the evidence this ADR
exists to make structural instead of incidental.

## Decision

Adopt the evidence contract in `03-DATA-KPI-TRUST-SPEC.md` as the terminal's
architecture, with these binding consequences.

### 1. One canonical financial aggregation path

There is exactly one service/mart that owns CoA role, statement section,
leaf/parent filtering, contra-account behaviour, revenue contribution, COGS and
opex mapping, below-EBITDA classification, interest/tax/D&A treatment, sign
normalisation, elimination treatment, currency policy and actual/plan/forecast
basis. No consumer re-implements any of it.

The new overview API is a **façade** over certified services. It is not a second
finance engine. `pnl-aggregation.ts` is not copied into a new route.

*Rationale:* the subsidies and credit-note defects both came from two code paths
inside a single route disagreeing about sign. One path is the only structural
cure; a second path is the defect generator.

### 2. Sign and unit conventions are declared by the writer, not inferred

A value's sign convention is a property of how it was **written** (the
importer's own classification), never of a semantic label attached later. Unit
is declared, and a declared unit that contradicts the data's own magnitude is a
detectable error, not an assumption to carry forward.

*Rationale:* `accountType=revenue` + `lineType=expense` is a legitimate,
intentional combination in this data (income booked under the cost convention).
Reading the sign off the semantic field is what inverted 13.45M.

### 3. PeriodContext is explicit, versioned and never inferred

Every observation, score, alert and scenario carries the full `PeriodContext`
contract (§4.1 of the trust spec): `periodKey`, `periodKind`, fiscal year,
start/end, `dataThrough`, `latestClosedMonth`, coverage months vs expected,
`financialAsOf`, `externalAsOf`, timezone `Asia/Baku`, basis, `revisionId`,
lock/reconcile/approve timestamps, `computedAt`.

Flow and stock aggregate by different rules (§3.4). YTD Actual is labelled `YTD`
— never presented as comparable to FY Plan without an explicit
`YTD Actual vs FY Plan` label or a YTD plan slice. Current external context
(news, weather, commodity) is never scored into a historical period.

*Rationale:* the 24-second date drift proves period assignment is a correctness
surface, not a formatting detail. Timezone-sensitive materialisation must be
normalised once, centrally, with the rule written down.

### 4. DataRevision is immutable; recompute is exact and idempotent

A source change creates a new revision. A locked-period correction creates an
adjustment revision — it never mutates an approved snapshot. Old observations
stay queryable; rollback moves a read pointer and deletes no evidence.

The recompute queue payload preserves the full `PeriodKey` and must never reduce
a requested month or quarter to its year. Idempotency key:
`organization + company + KPI + periodKey + dataRevision + formulaVersion + thresholdVersion`.

### 5. Risk, Confidence and Coverage are three separate outputs

- **Risk Index** — severity of confirmed material risk (0–100).
- **Coverage** — eligible known material weight ÷ required material weight.
  Missing and unknown stay in the denominator.
- **Confidence** — evidence quality (coverage, freshness, reconciliation,
  lineage, tier mix, approval).
- **Decision grade** — whether the output may drive confirmed colour, alerts and
  board decisions.

Confidence never uses risk colours. One opaque composite number without
Confidence and Coverage is prohibited.

### 6. Abstention: unknown is uncertainty, not zero risk

Proposed initial gate (**requires CFO/Risk-owner approval before it is
enforced** — see Open Questions):

```text
decisionGrade = materialCoverage >= 80%
                AND mandatoryFinancialGatesPass
                AND no critical stale/lineage failure
```

Below the gate: show `Provisional` / `Insufficient coverage` with the missing
material evidence; no green composite; no confirmed financial-breach alerts;
data-quality events still allowed.

Hard gates override a high weighted confidence number — unreconciled mandatory
statements block decision-grade regardless of other inputs.

### 7. No lineage, no decision-grade colour

Every colour-bearing decision KPI traces to source artifact and row. An
observation that cannot be reproduced is downgraded — it does not keep its
green/amber/red treatment while the recompute is pending or after it fails.

### 8. Evidence tiers gate eligibility, not just badges

A (certified financial) · B (disclosed operational) · C (external, own As-of) ·
D (modeled/proxy — excluded from confirmed score/alerts by default). Tier
changes eligibility and Confidence, not only a label.

### 9. KPI methodology is owned, versioned and approved by a human

Every decision KPI has an owner, formula version, threshold version, effective
date, stock/flow semantics per input, permitted period kinds, golden tests and
an approval state. **An engineering test cannot replace finance/risk owner
approval.** First release certifies 25–35 KPIs; the rest stay in
Research/Expert Catalog and cannot affect the decision score.

Where methodology is undecided, the KPI ships `provisional` with a recorded
question — never with an invented formula.

### 10. AI summarises evidence; it never creates it

AI cannot create a value or status. Every factual number in a narrative
references an observation ID. AI confidence ≠ data Confidence. Paid calls need
explicit user action. Cache keys include revision, period, formula version and
language. AI never changes Risk Index, thresholds or event lifecycle.

## Consequences

**Accepted cost.** Slower delivery of new KPIs; a real methodology-approval
bottleneck on a human owner; additive schema (SourceArtifact, DataRevision,
StatementSnapshot, KpiDefinitionVersion, ThresholdVersion, KpiCalculationRun,
KpiObservation, KpiInputLineage, CompositeSnapshot, RiskEvent) carried alongside
the legacy `IndicatorValue` serving projection through the shadow period; some
values that look green today will correctly become `Provisional`.

**Rejected alternative — ship the new UI first, harden data later.** Rejected
because a calmer interface over unverified numbers increases the blast radius of
exactly the defect class found today: it makes a wrong number *more* believable.

**Rejected alternative — a general data warehouse.** Rejected as premature; the
scope is deliberately the statements and 25–35 KPIs needed for decisions.

**Rollback.** This ADR adds no runtime behaviour. Downstream implementation
stays behind flags with the legacy path intact; cutover is a read-pointer flip.

## Open questions (owner decisions — block enforcement, not this ADR)

| # | Question | Owner | Blocks |
|---|---|---|---|
| T-1 | Reconciliation tolerance: absolute and/or relative, by currency/materiality | CFO / Finance | Canonical mart gate |
| T-2 | Is the 80% material-coverage abstention gate approved as written? | CFO / Risk | Decision-grade gating |
| T-3 | Confidence model coefficients and hard gates | Risk owner | Confidence publication |
| T-4 | Domain/portfolio weights and any nonlinear rollup | Risk owner | Composite score |
| T-5 | The 25–35 pilot KPI list | CFO + Risk | KPI registry scope |
| T-6 | DSCR numerator (CFADS vs NOI) + scheduled principal source | CFO | DSCR certification (proxy until then) |
| T-7 | Per-hectare basis: registry area vs planted area, and the period basis for the numerator | CFO / Ops | Agro per-ha KPI certification — see the verification note below |

### T-7 verification note (2026-07-16, owner-directed correction)

The T-7 row as first written on 2026-07-15 claimed that EDEN divides by 22 595 ha
(registry) and returns −131.8 ₼/ha. **That claim is unverified and is
contradicted by the code, the database and this repository's own history. It is
recorded here as withdrawn, not carried forward.** It was written without the
lineage that §7 of this ADR requires of any number that carries weight.

Verified by read-only inspection on 2026-07-16:

- The three per-ha KPIs (`AGRO_REVENUE_PER_HA`, `AGRO_COST_PER_HA`,
  `AGRO_YIELD_EFFICIENCY`) resolve `hectares_planted` from
  `Company.settings.hectaresPlanted` and nothing else
  (`src/lib/risk/recompute-resolvers-a.ts`). No code path reads
  `settings.landParcels`.
- EDEN's `hectaresPlanted` is **4 000** — the same basis the thresholds were
  calibrated on (`src/lib/risk/seeds/agro.ts`). The persisted calculation inputs
  record `"hectares_planted": 4000` for both 2025 and 2026, so this is the
  recorded input, not an inference from the formula.
- The 22 595 ha figure is the **leased land registry** (17 parcels, from
  `Çıxarışların uçotu.xlsx`), held in `settings.landParcels`. The roadmap
  changelog for 2026-05-31 states this explicitly and records
  `hectaresPlanted`=4 000 as the separate planted-cane figure, owner-confirmed.
- No observation anywhere in the database holds a value near −131.8. The figure
  appears in exactly one commit — the one that asserted it — and in no code, no
  data and no log.

**The question T-7 asks stays open and still needs a CFO/Ops decision.** Registry
area and planted area answer different questions — return on land held versus
return on land farmed — and each needs its own threshold. Engineering cannot
choose between them without inventing methodology, which §9 forbids. The question
is simply not live in the form first described.

What *is* live and verified on the same data, and is why the three KPIs are held
off the decision surface:

- **Period basis.** Thresholds were calibrated on quarterly actuals and the hint
  copy says "per quarter", but only annual observations (2023–2026) exist. A
  quarterly threshold is being applied to an annual numerator — prohibited by
  trust spec §8.6 without owner approval.
- **Aggregation.** EDEN's 2026 input bundle is internally inconsistent: `ebitda`
  (+11 962 639.82) is the exact sum of twelve monthly `pl_ebitda` operational
  facts, while `revenue` (266 379.02) and `net_income` (−3 382 397.83) come from
  the budgetLine path. With `da_total = 0`, EBITDA and net income cannot differ
  by 15.3M. The audit independently records the same revenue as 0.266M against a
  financial P&L of 3.514M, a −92.4% difference. This is §1 of this ADR being
  violated inside the very indicator T-7 describes.

**Interim posture, owner-approved 2026-07-16.** The three EDEN per-ha KPIs remain
`provisional`: excluded from the decision-grade surface, from confirmed alerts,
from the composite score and from the T-5 pilot set, until the financial
reconciliation closes. Formulas, thresholds, weights and source data are
unchanged by this decision, and no production change is made.

Enforcing that posture belongs to A5 — with one caveat the owner should carry
into A5's scope: A5 as written covers `stale/untraced` values, and these
observations are neither. They are fresh and traceable, and are withheld because
their methodology is unapproved and their input bundle is incoherent. A5 will not
catch them unless its rule is widened to cover unapproved methodology.
