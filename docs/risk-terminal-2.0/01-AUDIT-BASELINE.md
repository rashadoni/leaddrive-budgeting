# Risk Terminal 2.0, audit baseline

## 1. Purpose and scope

This document records the current-state evidence that motivates Risk Terminal 2.0. It separates:

- implementation mechanics that work;
- business definitions that are not yet decision-grade;
- data-period and lineage weaknesses;
- UI/UX strengths worth preserving;
- defects and risks that must be resolved before cutover.

The audit covers the terminal route, matrix feed, period selection, financial aggregation, KPI calculation, recompute behavior, composite score, provenance fields, runtime coverage, interaction density, responsive behavior and relevant tests.

## 2. Executive audit opinion

The current terminal is a capable analytical prototype with meaningful professional tooling. It is not yet a reliable enterprise decision system for all displayed outputs.

The central finding is not that every calculation is wrong. The central finding is that the system cannot consistently prove that a displayed status uses the same financial truth, same period basis, complete source coverage and auditable methodology as the financial reporting sections.

### Current ratings

| Area | Rating | Audit interpretation |
|---|---:|---|
| UI quality | 6/10 | coherent dark terminal style, but visually noisy and excessively dense |
| UX quality | 5/10 | efficient for a trained expert, difficult for a new finance/risk user |
| Bloomberg-style professional fit | 5.5/10 | keyboard and density exist, but trust context and function hierarchy are weaker than the density implies |
| Expert efficiency | 7/10 | resizable panes, shortcuts and drill-down are useful |
| First-time learnability | 3.5/10 | user must understand panels, commands, chips and matrix semantics before getting value |
| Period/as-of clarity | 5/10 | period syntax is clear; data-through and mixed-basis semantics are not |
| Operational trust | 4.5/10 | significant unknown coverage, duplicate financial logic and incomplete lineage |
| Accessibility | 5/10 | keyboard and shapes exist, but small text/targets and color density remain problematic |
| Responsive behavior | 3/10 | advisory banner exists; the information architecture does not adapt structurally |
| Confusion/cognitive load | 8.5/10 | too many equal-weight controls, statuses and panes at the default entry point |

### Decision-grade status

The terminal should currently be treated as **provisional for decision use** unless a specific KPI, period and company have been reconciled independently.

The following must not be inferred from a green or amber cell today:

- that the entire financial period is complete;
- that the value matches the financial P&L/BS/CF screens;
- that all required inputs are current;
- that source rows and calculation version can be reproduced;
- that missing indicators were incorporated into the composite;
- that the threshold is approved for the company industry and period kind.

## 3. Verified strengths

### 3.1 Period parsing and basic bucket selection

The period parser correctly supports:

- `YYYY`;
- `YYYY-Q1` through `YYYY-Q4`;
- `YYYY-MM`.

Reference: `src/lib/risk/periods.ts:37`.

The financial data source correctly selects exact month buckets and quarter month ranges for core P&L reads.

Reference: `src/lib/risk/recompute-data-source.ts:314`.

This is valuable infrastructure and should be extended, not replaced.

### 3.2 Formula and resolver infrastructure

The formula engine, resolver registry and recompute decomposition are technically mature relative to the prototype stage. Targeted suites have broad coverage and prove that the implementation follows its current contract.

What those tests do not prove is that every formula, threshold and aggregation contract is the correct accounting or risk methodology.

### 3.3 Professional interaction assets

The current Expert workspace provides:

- a four-pane resizable grid;
- persisted layouts;
- F1-F4 and command shortcuts;
- compact mode;
- company hierarchy and watchlist behavior;
- matrix search and period chips;
- indicator formula, threshold and drill-down detail;
- scenario and comparison tools;
- audit, alert and export overlays.

References:

- `src/features/terminal/components/PanelGrid.tsx:344`;
- `src/features/terminal/components/IndicatorDetail.tsx:207`;
- `src/features/terminal/store/terminalStore.ts`;
- `src/features/terminal/components/CommandBar.tsx`;
- `src/features/terminal/components/HeatMap.tsx`.

These capabilities justify keeping the matrix as Expert Mode.

### 3.4 Existing truth and control foundations

The repository already contains useful controls that Risk Terminal 2.0 should reuse:

- period locks;
- AuditEvent infrastructure;
- import staging and atomic application;
- organization scoping, RBAC and RLS;
- freshness/drift helpers;
- data readiness scoring;
- formula/source badges;
- visual regression gates.

The target is to connect these foundations into a source-to-decision chain, not to duplicate them.

## 4. Period and as-of audit

### 4.1 What is correct

- The requested syntax is parsed deterministically.
- Monthly and quarterly P&L bucket selection is explicit.
- Balance sheet selection uses point-in-time buckets rather than summing months.
- The terminal store exposes one selected period across panels.

### 4.2 What is not sufficient

#### Incomplete annual actuals

If actual data only exists through May, a request for the current year can be displayed beside full-year plan data. The UI does not consistently distinguish:

- full-year actual;
- YTD actual;
- plan for the whole year;
- annualized run rate.

Required target: January-May actual is `YTD May`, with `coverageMonths = 5`, not FY actual.

#### Balance sheet closing date

Annual balance-sheet logic can request December even when the latest closed period is May. The result becomes unknown rather than using a controlled last-closed snapshot or a clearly labelled fallback.

Reference: `src/lib/risk/recompute-data-source.ts:160`.

#### Historical financial plus current external context

Twenty-five macro/commodity indicators use the latest available external record regardless of the selected historical financial period. Weather and recent-news indicators behave similarly. At least 27 of 110 seeded definitions can therefore mix historical finance with current context.

Required target: every external input has its own `externalAsOf`; unsupported historical snapshots are hidden, marked `current context`, or excluded from historical scoring.

#### Latest complete year

The current matrix route can infer a latest complete year based on year age and the existence of IndicatorValues. It does not prove:

- twelve months of source coverage;
- period lock;
- statement reconciliation;
- finance sign-off.

Reference: `src/app/api/indicators/matrix/route.ts:80`.

#### Recompute granularity

The standard import/change trigger primarily schedules an annual recompute.

Reference: `src/lib/risk/recompute-trigger.ts:342`.

The large-fanout queue path can reduce a month or quarter request to a year-only payload. Monthly and quarterly observations may therefore remain stale after source changes.

### 4.3 Runtime freshness evidence

In the audited runtime snapshot, all 304 monthly and quarterly financial IndicatorValues for active companies were older than the relevant actual/plan update. Of those, 118 retained an active green, amber or red classification.

This demonstrates why `computedAt` alone is not a sufficient data-freshness contract.

### 4.4 Severity

| Finding | Severity | Reason |
|---|---|---|
| YTD actual presented under annual context without coverage | P0 | materially changes ratios and interpretation |
| Current external data applied to historical financial period | P0 | produces mixed-basis risk evidence |
| Exact M/Q recompute not guaranteed | P0 | stale colored results can remain after a write |
| Latest complete year does not require close/reconciliation | P1 | label implies more assurance than the gate proves |
| `MAX(computedAt)` used as overall freshness | P1 | one recent cell can make the matrix appear current |

## 5. Financial source-of-truth audit

### 5.1 Duplicate aggregation paths

Risk aggregation classifies rows using coarse account types, includes raw rows and treats expense categories broadly as operating expense.

Reference: `src/lib/risk/pnl-aggregation.ts:49`.

The financial P&L route uses a more detailed contract:

- leaf filtering;
- code-aware P&L sections;
- revenue contribution roles;
- below-EBITDA treatment;
- sign normalization.

References:

- `src/app/api/budgeting/pnl/route.ts:511`;
- `src/lib/budgeting/coa-role.ts:121`.

Both paths can be internally consistent and still disagree with each other.

### 5.2 Verified reconciliation differences

Read-only reconciliations found examples including:

- 2026 financial P&L revenue of 3.514m versus terminal risk revenue of 0.266m, a negative 92.4% difference;
- 2026 financial opex of 0.281m versus terminal risk opex of 1.057m, a positive 276.6% difference;
- 2025 financial revenue of 21.995m versus terminal risk revenue of 15.636m, a negative 28.9% difference.

The root cause includes rows whose stored account type needs code-aware revenue/sign handling. The Risk path can classify those rows as expense/opex while the financial P&L treats them as revenue or below-EBITDA.

### 5.3 Audit conclusion

The system must have one canonical `FinancialStatementMart` or normalized statement service. Risk, P&L, board deck, scenarios, variance explanation and exports must consume that same output.

Creating a third aggregator for the new UX is prohibited.

## 6. Indicator methodology audit

### 6.1 Coverage

The catalog contains 110 active seed definitions across universal and sector-specific packs.

In the audited annual runtime:

- 2025: 60 classified, 121 unknown;
- 2026: 71 classified, 110 unknown.

The catalog itself can be multi-industry by design. The risk is not merely the number of definitions. The risk is allowing uncertified, proxy, incomplete or period-incompatible KPIs to influence a decision surface without clear downgrade.

### 6.2 Priority methodology defects

#### EBITDA margin

The resolver can combine year-to-date actual revenue with a full-year stored EBITDA component.

Reference: `src/lib/risk/recompute-resolvers-b.ts:57`.

Observed results included materially inflated green margins and an extreme result that later fell into a guard/unknown path.

#### Inventory matching and turnover

- The matcher may fail to recognize the plural `Inventories` when searching for `inventory`.
- Turnover and days calculations use closing inventory instead of average opening/closing inventory.
- Monthly and quarterly ratios are not consistently annualized.

Reference: `src/lib/risk/recompute-resolvers-b.ts:604`.

#### Operational flow aggregation

`OperationalFact` can aggregate a `flow` using mean. Additive measures require sum, while denominators may require latest or average. A single indicator-level aggregation flag cannot safely express mixed numerator/denominator semantics.

#### Hospitality

Occupancy, ADR and RevPAR require room-nights and available-room-nights. Counting bookings and filtering by arrival date does not produce the same economic measure.

#### DSCR

The current proxy resembles gross-profit coverage of debt service. A decision-grade DSCR requires an approved NOI/CFADS definition and debt service including interest and principal.

#### EBITDA fallback

`net income + D&A` omits interest and tax. It is not EBITDA unless those components are proven absent or added.

#### Misleading names and thresholds

- One `operating leverage` measure is closer to gross-profit coverage of opex.
- Per-hectare thresholds described as quarterly can be applied to month or year.
- Some band definitions contain low-value dead zones that return unknown instead of red.
- Revenue HHI uses chart-of-account grouping rather than customer/product concentration.
- Universal thresholds need industry and methodology-owner approval.

#### ESG and climate

The current ESG composite is size-biased and incomplete across E/S/G dimensions. A fixed climate score is not an observed company risk metric.

### 6.3 Structural assessment

Before period/source problems, the static catalog audit suggested:

- roughly 60-65% structurally defensible for annual use;
- roughly 15-20% with concrete definition, scaling or aggregation defects;
- roughly 20-25% requiring proxy disclosure, business-owner validation or industry-specific thresholds.

This estimate is not a certification. Actual decision reliability is lower wherever period basis, input coverage, financial aggregation or lineage fails.

## 7. Lineage and auditability

### 7.1 Verified gap

For the audited annual IndicatorValues, the following fields were effectively absent:

- source document on the resulting value;
- last reconciliation timestamp;
- sanity band.

Underlying budget rows can carry source-document metadata, but that lineage is not propagated to the decision observation.

### 7.2 Required evidence chain

Every decision-grade observation must reproduce:

```text
source file and hash
  -> import batch
  -> original sheet/row or record identifier
  -> normalized fact
  -> financial statement snapshot
  -> KPI specification/formula version
  -> threshold version
  -> calculation run
  -> KPI observation
  -> composite/alert/scenario/deck output
```

### 7.3 Audit conclusion

The current `IndicatorValue` upsert model is useful as a serving projection. It must not remain the only historical/audit truth if recomputation overwrites the previous state.

## 8. Composite score audit

### 8.1 Current behavior

The current composite intentionally ignores unknown/missing observations.

References:

- `src/lib/risk/composite-score.ts:2`;
- `src/lib/risk/composite-score.ts:99`.

This can make a score appear more complete and healthier than the evidence supports.

### 8.2 Runtime example

One audited company displayed a composite near R77 based on only 7 known observations out of 33 applicable indicators. In another live view, 71 of 96 displayed values were unknown.

The issue is not that unknown should automatically mean red. The issue is that unknown cannot be treated as if no material uncertainty exists.

### 8.3 Required correction

Risk Terminal 2.0 must separate:

- Risk Index;
- Confidence;
- material Coverage;
- decision-grade status.

Below the approved coverage/reconciliation gate, the system abstains and displays `Provisional` or `Insufficient coverage` without a green composite.

## 9. UI/UX audit

### 9.1 Current route composition

The terminal page currently renders:

```text
Deep-link handler
Locked-period banner
Hotkey toolbar
Command bar
Signals strip
Four-pane PanelGrid
```

Reference: `src/app/(dashboard)/budgeting/terminal/page.tsx:17`.

JetBrains Mono is applied to the entire terminal. This helps data density but reduces friendliness and long-form readability.

### 9.2 Cognitive-load findings

The current default surface can expose:

- many fixed and overflow toolbar commands;
- a separate command bar;
- two search concepts;
- company and indicator filters;
- period chips and time controls;
- four simultaneous panes;
- alerts, signals, scenarios and audit tickers;
- status colors, shapes, readiness, risk tags and provenance markers.

The issue is not a lack of capability. The issue is insufficient progressive disclosure and weak visual priority.

### 9.3 Readability and accessibility

- Common 8-11px text is too small for a default finance workstation experience.
- Several interaction targets are smaller than recommended touch/motor targets.
- Status shapes improve color-blind use, but the density of color remains high.
- Raw or system-like errors such as `Unauthorized` can appear without a recovery path.
- EN/RU/AZ support exists, but hardcoded or fallback strings can create language mixing.
- The mobile approach warns the user rather than restructuring the task.

### 9.4 Strong UX to preserve

- fast matrix scanning for trained analysts;
- direct cell-to-detail behavior;
- keyboard navigation;
- resizable/persisted layouts;
- compact mode;
- formula, threshold, source and reconciliation drill-down;
- comparison and scenario tools;
- semantic table structure and status shapes.

## 10. Hidden architecture couplings relevant to redesign

### 10.1 Alerts depend on HeatMap mounting

Alert matches are currently evaluated/published through HeatMap-related client logic. If the new default does not mount HeatMap, Today, Snapshot, Alerts and Action Center can lose their alert data.

Reference: `src/features/terminal/components/use-heat-map-model.ts:367`.

Required action: move alert evaluation into a shared terminal provider or a server overview façade before changing the default route.

### 10.2 Overlay listeners live inside PanelGrid

Audit, alerts, scenarios, exports, comments, intel and related overlays are mounted inside `PanelGrid`. Making Expert mode optional without extracting a permanent overlay host would break global CustomEvent commands.

Reference: `src/features/terminal/components/PanelGrid.tsx:265`.

### 10.3 Freshness contract drift

The `HeatMapCell` type and CompanyTree expect per-cell `computedAt`, while the matrix route primarily uses raw timestamps for aggregate `lastComputedAt`. The view cannot build reliable company freshness until the response contract is aligned.

References:

- `src/lib/risk/heatmap-matrix.ts:22`;
- `src/features/terminal/components/CompanyTree.tsx:121`;
- `src/app/api/indicators/matrix/route.ts:447`;
- `src/app/api/indicators/matrix/route.ts:757`.

### 10.4 Automatic AI prewarm

`TodayBrief` can prewarm a variance explanation after mount. The new default experience must make paid/slow AI an explicit action.

Reference: `src/features/terminal/components/TodayBrief.tsx:267`.

## 11. Severity register

### P0, blocks decision-grade use

- Duplicate financial aggregation paths.
- Mixed YTD/FY basis in material ratios.
- Exact-period recompute/invalidation not guaranteed.
- Current external context mixed with historical finance.
- Unknown ignored by composite without a coverage gate.
- Colored outcomes without complete lineage/reconciliation.
- Material KPI definition defects such as EBITDA, inventory and DSCR.

### P1, blocks production cutover

- Overall freshness inferred from maximum computed timestamp.
- Latest complete year not tied to formal close.
- Missing immutable observation/revision history.
- Alert engine lacks a universal decision-grade evidence gate.
- Default UI is matrix-first and cognitively overloaded.
- Small type, incomplete responsive adaptation and inconsistent recovery states.
- UI/business logic coupled to HeatMap mounting.

### P2, important polish and scale

- Matrix virtualization for the 60 x 50/80 target.
- Reduced command density.
- Consistent terminology across locales.
- Friendly empty states and onboarding.
- Reduced decorative/status noise.
- Stronger screen-reader and target-size behavior.

## 12. What this audit does not claim

- It does not claim every current KPI is wrong.
- It does not certify any specific company or period.
- It does not replace finance-owner approval of formulas or thresholds.
- It does not claim the proposed architecture is already present.
- It does not authorize production cutover.
- It does not require discarding the current Expert Matrix.

The audit conclusion is precise: the current terminal has strong mechanics, but its decision assurance is inconsistent. The transformation must repair trust contracts first and then expose them through a simpler decision experience.
