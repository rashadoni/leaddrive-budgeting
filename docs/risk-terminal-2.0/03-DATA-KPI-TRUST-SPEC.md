# Risk Terminal 2.0, data, KPI and trust specification

## 1. Objective

This specification defines the minimum evidence contract behind every value, status, score, alert, scenario and narrative shown by Risk Terminal 2.0.

It is deliberately narrower than a general data warehouse. The target is a controlled, reproducible path for the financial statements and certified risk indicators needed by the first 25-35 decision KPIs.

## 2. Foundational rule

```text
SourceArtifact / ImportBatch
  -> DataRevision + PeriodContext
  -> Canonical Financial Statement Mart
  -> Versioned KPI Specification + CalculationRun
  -> KPI Observation + Input Lineage
  -> Risk Index + Confidence/Coverage
  -> Risk Event / Scenario / Board Deck / UI
```

If a stage cannot be reproduced, the downstream value is downgraded. It must not retain a decision-grade green/amber/red treatment.

## 3. Canonical Financial Statement Mart

### 3.1 Purpose

One canonical service/mart must supply:

- financial P&L screen;
- Balance Sheet screen;
- Cash Flow screen;
- Risk Terminal;
- scenario engine;
- variance explanation;
- Board Deck;
- exports;
- alert evaluation.

No consumer may implement its own chart-of-account classification, sign normalization or period aggregation.

### 3.2 Required normalized dimensions

Every fact used by the mart must resolve:

- organization;
- company/entity;
- account and canonical statement role;
- statement section;
- period start/end;
- period kind;
- scenario/basis: actual, plan, forecast, scenario;
- base and original currency;
- amount with normalized statement sign;
- source artifact/import batch;
- data revision;
- optional department, product, customer and other analytical dimensions.

### 3.3 Canonical classification

The mart owns:

- CoA role and statement section;
- leaf/parent filtering;
- contra-account behavior;
- revenue contribution;
- COGS and operating-expense mapping;
- below-EBITDA classification;
- interest, tax and D&A treatment;
- sign normalization;
- intercompany/elimination treatment when available;
- currency conversion policy;
- actual/plan/forecast/scenario basis.

The canonical mapping is versioned. A mapping change creates a new statement snapshot and data revision.

### 3.4 Flow and stock semantics

Flow measures are accumulated over a period:

- revenue;
- COGS;
- expenses;
- cash flows;
- production volume;
- room revenue and sold room-nights.

Stock measures are point-in-time:

- cash;
- inventory;
- receivables/payables;
- debt;
- equity;
- assets/liabilities.

Rules:

- Monthly flow is one month.
- Quarterly flow is the sum of the three quarter months.
- YTD flow is the sum from fiscal-year start through `dataThrough`.
- FY flow requires complete approved year coverage or a clearly labelled plan/forecast basis.
- LTM flow is the exact trailing twelve months.
- A balance-sheet quarter is the approved quarter-end snapshot.
- A balance-sheet year is the approved year-end snapshot.
- Fallback to the last closed stock date is allowed only when explicitly labelled with that date and downgrade.
- Average stock uses approved opening and closing snapshots, or a documented monthly-average method.

### 3.5 Reconciliation contracts

For each statement snapshot:

- P&L totals reconcile to approved source controls;
- Balance Sheet satisfies Assets = Liabilities + Equity within approved rounding tolerance;
- Cash Flow ending cash reconciles to the Balance Sheet when the source supports the link;
- retained earnings/net income linkage is tested where applicable;
- base/original currency controls reconcile;
- source row totals reconcile to normalized facts;
- excluded/unsupported rows are reported explicitly.

Tolerance is a finance-owner decision. It must be expressed as an absolute and/or relative rule by currency/materiality, not an undocumented constant.

## 4. PeriodContext

### 4.1 Required contract

Every observation, score, alert and scenario carries:

```ts
interface PeriodContext {
  periodKey: string
  periodKind: "MONTH" | "QUARTER" | "YTD" | "FY" | "LTM"
  fiscalYear: number
  periodStart: string
  periodEnd: string
  dataThrough: string | null
  latestClosedMonth: string | null
  coverageMonths: number
  expectedCoverageMonths: number
  financialAsOf: string | null
  externalAsOf: string | null
  timeZone: "Asia/Baku"
  basis: "ACTUAL" | "PLAN" | "FORECAST" | "SCENARIO"
  revisionId: string
  lockedAt: string | null
  reconciledAt: string | null
  approvedAt: string | null
  computedAt: string
}
```

The concrete schema may use enums and timestamps, but no semantic field may be lost.

### 4.2 Period presentation rules

- Actual through May is `YTD May`, not FY Actual.
- Full-year plan compared with YTD Actual must be labelled `YTD Actual vs FY Plan`, or use a YTD plan slice for a like-for-like variance.
- A ratio must declare whether numerator and denominator use period flow, annualized flow, opening/closing stock or average stock.
- Monthly/quarterly annualization is opt-in per KPI specification.
- Unsupported annualization returns `notApplicable` or `unknown`, not a guessed value.
- External inputs carry their own `externalAsOf` and historical-snapshot capability.
- Current news/weather/commodity context is not silently scored into an old period.
- Locked-period corrections create an adjustment/new revision. They do not silently mutate the approved snapshot.

### 4.3 Complete period definition

A complete period is not merely a period with at least one IndicatorValue.

Required conditions:

- expected source months/snapshots exist;
- mandatory statements pass structural tests;
- reconciliation passes;
- period is locked or explicitly approved;
- mandatory material inputs exist;
- source revision is identifiable.

## 5. DataRevision and immutable history

### 5.1 DataRevision

A revision represents the exact source/mapping state used by downstream calculations.

Required fields:

- id;
- organization and scope;
- source batch/artifact identifiers;
- period range;
- mapping/version identifiers;
- createdAt/createdBy;
- reason code: import, correction, mapping change, late adjustment, external refresh, manual override;
- supersedes/supersededBy;
- lock/reconciliation/approval state;
- deterministic content hash.

### 5.2 Revision rules

- A source change creates a new revision.
- A locked-period correction creates an adjustment revision.
- Old observations remain queryable.
- Serving projections may point to the latest approved observation.
- A rollback changes the read pointer; it does not delete historical evidence.
- Scenarios reference an immutable baseline revision.

## 6. Exact recompute and invalidation

### 6.1 Event contract

Every source mutation emits:

```ts
interface SourceChangeEvent {
  organizationId: string
  companyId: string
  sourceDomain: string
  affectedPeriodKeys: string[]
  revisionId: string
  changedFactIds: string[]
  occurredAt: string
}
```

### 6.2 Dependency expansion

A changed month may affect:

- the exact month;
- its quarter;
- YTD windows including the month;
- fiscal year;
- up to twelve LTM windows;
- parent rollups;
- dependent composite/domain scores;
- decision alerts;
- scenarios whose baseline is configured to follow latest approved data.

### 6.3 Queue contract

Queue payload must preserve the full PeriodKey. It may not reduce a requested month/quarter to the year.

Idempotency key:

```text
organization + company + KPI + periodKey + dataRevision
+ formulaVersion + thresholdVersion
```

### 6.4 Observation states

```text
pending -> computing -> ready
                     -> unknown
                     -> failed

ready -> stale -> superseded
```

Rules:

- While recompute is pending, the old value may be shown only with stale/provisional treatment and its last valid As-of.
- A failed calculation never silently preserves the old decision-grade status.
- Repeated jobs with the same idempotency key return the same result or reference the completed run.
- Composite and alerts wait for required downstream observations or explicitly publish a provisional snapshot.

## 7. KPI Specification Registry

### 7.1 Required fields

Every KPI version includes:

- stable KPI key;
- localized names and plain-language definition;
- business owner and methodology reviewer;
- risk direction;
- numerator and denominator definitions;
- required inputs and source priority;
- stock/flow semantics per input;
- aggregation rule per input;
- annualization rule;
- permitted period kinds;
- unit and currency behavior;
- missing/not-applicable behavior;
- freshness SLA;
- data-quality and sanity guards;
- benchmark cohort;
- threshold source and rationale;
- threshold effective date;
- materiality weight;
- risk domain;
- formula expression/version;
- threshold version;
- evidence tier;
- approval state;
- golden examples;
- boundary, null, stale and period-kind tests;
- superseded version reference.

### 7.2 Evidence tiers

| Tier | Name | Meaning | Decision use |
|---|---|---|---|
| A | Certified Financial | reconciled canonical statement data | may drive score/alerts after period gates |
| B | Disclosed Operational | controlled operational fact with owner/source | may drive score/alerts after coverage gates |
| C | External | macro/news/weather/commodity with own As-of | may contribute when methodology explicitly approves it |
| D | Modeled/Proxy | inferred, estimated or proxy measure | displayed separately, excluded from confirmed score/alerts by default |

Tier is not a visual badge only. It changes eligibility and Confidence.

### 7.3 Approval lifecycle

```text
Draft -> Review -> Approved -> Effective -> Superseded
```

An engineering test cannot replace finance/risk owner approval.

### 7.4 First release scope

Select 25-35 decision KPIs that together prove:

- canonical financial statements;
- stock/flow ratios;
- operational facts;
- external freshness;
- lineage;
- thresholds;
- company/domain/composite aggregation.

The remaining catalog stays visible in Research/Expert Catalog and cannot affect the decision score until certified.

## 8. Priority KPI corrections

### 8.1 EBITDA and EBITDA margin

Approved alternatives:

```text
EBITDA = EBIT + Depreciation + Amortization
```

or, when derived from net income:

```text
EBITDA = Net Income + Interest + Tax + Depreciation + Amortization
```

Requirements:

- use canonical CoA roles;
- prevent double counting of D&A;
- numerator and revenue denominator share the same period basis;
- YTD uses YTD EBITDA/YTD revenue;
- period annualization is not required for a margin when both are comparable flows;
- persist bridge inputs for audit.

### 8.2 Inventory turnover and days

```text
Average Inventory = (Opening Inventory + Closing Inventory) / 2
Inventory Turnover = Period COGS / Average Inventory
Inventory Days = Days in Period / Inventory Turnover
```

If annualized:

```text
Annualized Turnover = Period COGS * (12 / coveredMonths) / Average Inventory
```

Annualization must be explicit and coverage must be sufficient. Opening/closing dates are persisted. Matching must handle canonical inventory roles and naming variants, not English substring guesses.

### 8.3 DSCR

```text
DSCR = Approved CFADS or NOI / (Interest + Scheduled Principal)
```

Until principal and an approved numerator exist, label the current measure as a proxy and exclude it from certified score/alerts.

### 8.4 Operational flows

Each input declares its aggregation:

- sum;
- average;
- latest;
- opening;
- closing;
- weighted average;
- distinct count.

The KPI may combine different aggregation methods for numerator and denominator.

### 8.5 Hospitality

```text
Occupancy = Sold Room-Nights / Available Room-Nights
ADR = Room Revenue / Sold Room-Nights
RevPAR = Room Revenue / Available Room-Nights
```

Bookings and arrival counts are not substitutes unless the methodology explicitly converts them to room-nights.

### 8.6 Agriculture/per-hectare

- numerator flow period must match area basis;
- month/quarter/year thresholds are separately approved;
- seasonal/fiscal crop-year rules are explicit;
- no quarterly threshold is reused for annual data without owner approval.

### 8.7 Concentration/HHI

HHI must use customer, product or counterparty share depending on the named metric. Chart-of-account categories do not prove revenue concentration.

### 8.8 ESG/climate

- separate E, S and G evidence;
- do not use a fixed score as observed company data;
- normalize scale effects where appropriate;
- expose modeled/proxy status;
- exclude incomplete composites from confirmed score until methodology and data are approved.

### 8.9 Misleading names and dead zones

- Rename metrics whose formula does not match the business name.
- Every threshold band covers the full valid numeric domain or returns a deliberate invalid/not-applicable reason.
- A low-risk/high-risk direction is unambiguous.

## 9. Lineage and calculation history

### 9.1 Proposed additive entities

- `SourceArtifact`;
- `ImportBatch`, reuse/extend existing where possible;
- `DataRevision`;
- `StatementSnapshot`;
- `KpiDefinitionVersion`;
- `ThresholdVersion`;
- `KpiCalculationRun`;
- `KpiObservation`;
- `KpiInputLineage`;
- `CompositeSnapshot`;
- `RiskEvent` and event transitions.

The final Prisma design is an implementation ADR. Changes must be additive through the shadow period.

### 9.2 KpiObservation minimum contract

```ts
interface KpiObservation {
  id: string
  organizationId: string
  companyId: string
  kpiDefinitionVersionId: string
  thresholdVersionId: string
  calculationRunId: string
  revisionId: string
  periodKey: string
  value: number | null
  unit: string
  status: "stable" | "warning" | "critical" | "unknown" | "provisional"
  reasonCode: string | null
  evidenceTier: "A" | "B" | "C" | "D"
  computedAt: string
  reconciledAt: string | null
  approvedAt: string | null
}
```

### 9.3 Lineage contract

For every input used by an observation, persist:

- source artifact and hash;
- sheet/table and original row/record identifier;
- normalized fact identifier;
- statement snapshot identifier when applicable;
- resolver/input name;
- input value/unit/currency;
- aggregation role;
- revision.

## 10. Risk Index, Confidence and Coverage

### 10.1 Separate outputs

- **Risk Index:** severity of confirmed material risk, 0 low to 100 critical.
- **Coverage:** eligible known material weight divided by required material weight.
- **Confidence:** quality of the evidence based on coverage, freshness, reconciliation, lineage, evidence tier and approval.
- **Decision grade:** whether the output is permitted to drive confirmed color, alerts and board decisions.

### 10.2 Eligibility

A KPI contributes to confirmed Risk Index only when:

- its specification version is effective;
- period kind is permitted;
- mandatory inputs exist;
- observation is not stale/failed;
- lineage requirements pass;
- required reconciliation/approval gates pass;
- tier is eligible for the target score.

### 10.3 Coverage

```text
Coverage = sum(eligible known material weights)
           / sum(required applicable material weights)
```

Not applicable is excluded only when applicability is proven by the specification. Missing and unknown remain in the denominator.

### 10.4 Risk calculation

For eligible KPIs:

```text
Domain Risk = weighted mean or approved nonlinear aggregation of KPI risk severities
Portfolio Risk = approved aggregation of domain/company risks
```

The methodology owner must approve weights, nonlinear rules and rollup treatment. Qualitative risk tags are shown as explicit drivers, not an invisible score penalty.

### 10.5 Confidence model

The exact coefficients require owner approval. A starting framework may use:

- material Coverage;
- source freshness;
- statement reconciliation;
- complete lineage;
- evidence tier mix;
- approved methodology/version;
- source sanity checks.

Hard gates override a high weighted confidence number. For example, unreconciled mandatory financial statements can prevent decision-grade status even if other inputs are complete.

### 10.6 Abstention rule

Proposed initial gate, subject to CFO/Risk Owner approval:

```text
decisionGrade = materialCoverage >= 80%
                AND mandatoryFinancialGatesPass
                AND no critical stale/lineage failure
```

Below the gate:

- display `Provisional` or `Insufficient coverage`;
- show Coverage and missing material evidence;
- do not display a green composite;
- do not create confirmed financial breach alerts;
- allow data-quality events.

### 10.7 Explainability

Every score snapshot provides:

- known weight / required weight;
- tier mix;
- top positive/negative drivers;
- change bridge from prior snapshot;
- formula/threshold versions;
- excluded KPI list with reasons;
- data revision and period context.

## 11. Alert and Risk Event rules

### 11.1 Event types

- confirmed risk breach;
- emerging/watch signal;
- data-quality breach;
- stale source;
- reconciliation failure;
- methodology/formula failure;
- predicted breach, clearly separated from observed breach.

### 11.2 Confirmed alert eligibility

- decision-grade observation;
- effective approved threshold;
- required evidence tier;
- current revision;
- period not superseded;
- deduplication key is stable;
- evidence snapshot is persisted.

### 11.3 Event contract

Persist:

- event type and severity;
- company/domain/KPI;
- source observation/composite snapshot;
- period/revision;
- headline and deterministic explanation;
- owner, due date and SLA;
- lifecycle state;
- acknowledgement/resolution history;
- comments and evidence attachments/references;
- reopen reason.

### 11.4 Noise controls

- deduplicate repeated evaluation of the same condition;
- group related KPI breaches by driver where approved;
- cooldown/suppression is explicit and auditable;
- stale/proxy observations do not masquerade as confirmed breaches;
- shadow mode produces no notifications or duplicate user actions.

## 12. Terminal overview API contract

The modern UI consumes a view façade. The façade composes certified domain services and must not reimplement financial aggregation.

```ts
interface TerminalOverviewResponse {
  periodContext: {
    periodKey: string
    periodKind: string
    dataThrough: string | null
    financialAsOf: string | null
    externalAsOf: string | null
    coveragePct: number
    locked: boolean
    reconciliationStatus: "passed" | "failed" | "pending" | "not_applicable"
    revisionId: string
  }
  portfolio: {
    riskIndex: number | null
    confidence: number
    coveragePct: number
    decisionGrade: boolean
    gradeReason: string | null
    counts: {
      critical: number
      warning: number
      stable: number
      unknown: number
      provisional: number
      overdue: number
    }
  }
  inbox: RiskInboxItem[]
  companies: CompanyRiskSummary[]
  dataHealth: DataHealthSummary
}
```

Required response rules:

- all customer-facing strings are message keys/params or localized safely at the UI boundary;
- no row omits period/revision/as-of fields;
- unknown/provisional counts are first-class;
- permission scope is applied server-side;
- no cross-org data is serialized;
- list items include stable IDs for deep links and action mutation.

## 13. AI and narrative constraints

- AI may summarize verified evidence; it cannot create a value or status.
- Every factual number in a narrative references an observation/snapshot ID.
- Confidence of an AI explanation is not the same as data Confidence.
- Unsupported claims are omitted, not guessed.
- Paid calls require explicit user action in the default terminal.
- Cache keys include revision, period, formula version and language.
- A stale narrative is invalidated when any cited observation is superseded.
- AI output never changes Risk Index, threshold or event lifecycle automatically.

## 14. Trust acceptance gates

### Canonical mart

- zero unexplained material differences against approved P&L/BS/CF controls;
- one statement snapshot ID is used by financial screens and Risk calculations;
- all exclusions documented.

### Period/revision

- every displayed observation has PeriodContext and revision;
- YTD/FY/current-external mixing tests pass;
- locked correction creates a new revision;
- exact M/Q/YTD/FY/LTM invalidation tests pass.

### KPI registry

- 100% of decision KPIs have owner, formula, inputs, stock/flow, period kinds, thresholds, evidence tier and golden tests;
- methodology owner signs each effective version;
- uncertified KPIs cannot affect confirmed score/alerts.

### Lineage

- 100% of colored decision KPIs trace to source artifact and row/record;
- every observation references calculation, formula, threshold and revision versions;
- recompute preserves old observations.

### Risk and Confidence

- low material Coverage cannot produce a green composite;
- unknown is not silently excluded;
- every score has a deterministic driver bridge;
- data Confidence and AI confidence are never conflated.

### Alerts

- every confirmed alert reproduces from an immutable evidence snapshot;
- owner/SLA/lifecycle are complete;
- shadow alerts cause zero external side effects.
