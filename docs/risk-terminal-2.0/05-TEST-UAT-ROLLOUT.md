# Risk Terminal 2.0, test, UAT and rollout specification

## 1. Quality principle

The redesign is accepted only when it is correct, explainable, usable and reversible. A green TypeScript build or an attractive screenshot is insufficient.

Quality gates cover:

- financial reconciliation;
- period/revision correctness;
- KPI methodology;
- lineage;
- Risk × Confidence semantics;
- component and route behavior;
- visual structure;
- accessibility;
- performance;
- real-user task completion;
- shadow comparison and rollback.

## 2. Critical prerequisites before Today becomes default

### 2.1 Extract global overlays

The current global overlays/listeners are mounted inside `PanelGrid`. If Today replaces PanelGrid before extraction, Alerts, Scenario, Intel, Audit, Help, Compare, exports and other commands can stop working.

Required gate: `TerminalOverlayHost` is always mounted and all existing event contracts have regression coverage.

### 2.2 Remove automatic AI execution

The current `TodayBrief` can trigger an AI explanation after mount.

Required gate: opening Today performs no paid/slow AI request until the user activates an explicit control.

### 2.3 Repair visual masking

The existing TodayBrief root is marked `data-volatile`, causing its entire region to be masked by the visual test.

Required gate: the new Today baseline masks only dynamic leaf content such as clock text, AI narrative and volatile numeric values. Layout, labels, states and interaction structure remain test-visible.

### 2.4 Update HeatMap-default assumptions

Multiple E2E tests assume a table is immediately visible at `/budgeting/terminal`.

Required gate: tests for the Expert matrix navigate or select Expert explicitly. Tests must not use the first arbitrary table as a view selector.

## 3. Test pyramid

| Level | Scope | Release gate |
|---|---|---|
| Unit | pure period/KPI/view models, ranking, flags, labels, state reducers | 100% pass |
| Component | shell, tabs, keyboard, focus, actions, SSR/hydration, i18n, no AI autorun | 100% pass |
| Integration | canonical mart, PeriodContext, overview route, store, overlays, deep links, SSE refresh | 100% pass |
| E2E | Today to evidence/action, Expert, scenarios, auth, locales, responsive states | 100% critical paths |
| Visual | Today, Expert, KPI detail, mobile brief and critical states | approved explicit diffs |
| Accessibility | automated scan plus keyboard, zoom and screen-reader manual checks | 0 critical/serious |
| Performance | API, Today rendering, 60-company Expert matrix, interaction latency | all approved budgets pass |
| UAT | real CFO/risk/controller/operator tasks | at least 90% completion |

## 4. Financial and methodology tests

### 4.1 Golden reconciliation fixtures

For each pilot industry, include representative source workbooks/normalized fixtures with approved controls:

- monthly P&L;
- quarterly P&L;
- YTD P&L;
- FY P&L;
- Balance Sheet month/quarter/year-end;
- Cash Flow and ending-cash linkage where available;
- actual/plan/forecast basis;
- base/original currency;
- unusual account-role examples;
- incomplete period;
- late adjustment/new revision.

Assertions:

- statement totals match approved controls within signed tolerance;
- financial screen and Risk calculation reference the same StatementSnapshot;
- sign and classification match;
- leaf/parent treatment is deterministic;
- excluded rows are reported;
- revision changes produce a new snapshot and preserve history.

### 4.2 Period matrix tests

Every decision KPI is tested across applicable combinations:

```text
MONTH x ACTUAL
QUARTER x ACTUAL
YTD x ACTUAL
FY x ACTUAL
FY x PLAN
FY x FORECAST
LTM x ACTUAL
```

Include:

- January-only;
- January-May;
- complete year;
- quarter boundary;
- fiscal-year boundary;
- missing opening stock;
- missing closing stock;
- current external input on historical period;
- historical external snapshot supported/unsupported;
- locked correction revision.

### 4.3 KPI specification tests

For every decision KPI:

- golden examples;
- threshold boundary on both sides;
- zero/near-zero denominator;
- negative values where valid/invalid;
- missing input;
- stale input;
- not applicable;
- wrong period kind;
- annualization enabled/disabled;
- unit/currency conversion;
- formula/threshold version change;
- source tier eligibility.

### 4.4 Recompute tests

A changed monthly fact must assert recompute/invalidation of:

- exact month;
- quarter;
- affected YTD;
- fiscal year;
- affected LTM windows;
- parent rollups;
- domain/composite;
- alerts/events.

Also test idempotency, duplicate queue messages, failure/retry, superseded revision and partial completion.

### 4.5 Risk × Confidence tests

- Unknown remains in applicable Coverage denominator.
- Not applicable is excluded only with an applicability reason.
- Coverage below the approved gate cannot produce a green composite.
- Mandatory reconciliation failure prevents decision grade.
- Tier D cannot independently produce a confirmed alert.
- Top-driver bridge reconciles to score change.
- Every score snapshot lists excluded KPIs and reasons.

## 5. Standard technical commands

Run from repository root.

### 5.1 Targeted during development

```bash
npx tsc --noEmit
npx vitest run <changed-test-files>
```

Suggested terminal regression set:

```bash
npx vitest run \
  src/features/terminal/components/PanelGrid.ssr.test.tsx \
  src/features/terminal/components/HotkeyToolbar.test.tsx \
  src/features/terminal/components/TodayBrief.helpers.test.ts \
  src/features/terminal/components/i18n-hardcoded-strings.test.ts \
  src/features/terminal/hooks/use-matrix.test.tsx \
  src/features/terminal/store/terminalStore.watchlist.test.ts \
  src/features/terminal/store/terminalStore.pending-iv-invariant.test.ts \
  src/features/terminal/store/terminalStore.scenario-brief.test.ts \
  src/app/api/indicators/matrix/handler.test.ts \
  src/lib/risk/periods.test.ts
```

Adapt the list to the actual changed contracts. Do not use the list as a substitute for full tests before handoff.

### 5.2 Full code gate

```bash
npx tsc --noEmit
npx vitest run --reporter=dot
npx prisma validate
npm run build
```

### 5.3 Full E2E gate

Use the actual running server port:

```bash
E2E_SKIP_LLM=true E2E_BASE_URL=http://localhost:<PORT> npm run test:e2e
```

Do not use `networkidle` as the terminal readiness condition because the SSE connection remains open. Wait for a specific landmark/test ID, fonts and state-specific data.

### 5.4 Pre-demo script

```bash
bash scripts/pre-demo-check.sh
```

The current script includes TypeScript, full Vitest, server/auth probes, database sanity checks, Playwright including visual tests and migration status. It also contains legacy fixture/count assumptions. Review warnings and do not treat exit 0 with warnings as proof that Risk Terminal 2.0 trust gates passed.

Never pass `--apply-pending` unless migration deployment is explicitly authorized.

## 6. New unit and component suites

Add:

```text
build-risk-inbox.test.ts
build-portfolio-domains.test.ts
build-company-summary.test.ts
use-terminal-view.test.tsx
use-terminal-overview.test.tsx
TerminalDataProvider.test.tsx
TerminalShell.test.tsx
TerminalViewNav.test.tsx
TerminalOverlayHost.test.tsx
RiskInbox.test.tsx
RiskInspector.test.tsx
PortfolioRiskMap.test.tsx
CompanyWorkspace.test.tsx
KpiDetailSheet.test.tsx
DataHealthView.test.tsx
ScenarioLabView.test.tsx
terminal-experience-flag.test.ts
```

Required behavioral tests:

- Today does not invoke AI before an explicit click.
- View switch preserves company, period and KPI selection.
- Deep link opens the correct modern context and offers Expert access.
- Expert mode preserves current layout localStorage keys.
- All old CustomEvent overlay commands work in any view.
- Unknown, stale, provisional, unauthorized and empty states are distinct.
- Feature flags resolve consistently in server and client render.
- Selection invariants for IndicatorValue/missing/rollup cells remain intact.

## 7. E2E critical flows

### 7.1 Existing specs affected

Review and update deliberately:

```text
e2e/smoke/login-and-terminal.spec.ts
e2e/smoke/panelgrid-drag-resize.spec.ts
e2e/smoke/visual-baseline.spec.ts
e2e/smoke/visual-baseline-snapshotcard.spec.ts
e2e/smoke/intel-feed.spec.ts
e2e/smoke/i18n-locale-flow.spec.ts
e2e/smoke/terminal-audit.spec.ts
e2e/smoke/verify-ebitda-bs-cf-render.spec.ts
e2e/smoke/azerseker-pilot.spec.ts
```

Expert-dependent tests explicitly use `?view=expert` or a unique accessible tab selector.

### 7.2 New specs

```text
e2e/smoke/terminal-modern-shell.spec.ts
e2e/smoke/terminal-risk-inbox.spec.ts
e2e/smoke/terminal-portfolio-navigation.spec.ts
e2e/smoke/terminal-company-workspace.spec.ts
e2e/smoke/terminal-data-health.spec.ts
e2e/smoke/terminal-scenario-lab.spec.ts
e2e/smoke/terminal-responsive.spec.ts
e2e/smoke/terminal-deeplink.spec.ts
e2e/smoke/terminal-expert-mode.spec.ts
e2e/smoke/terminal-a11y.spec.ts
e2e/smoke/terminal-perf.spec.ts
```

### 7.3 Stable selectors

Prefer accessible roles and stable contracts:

- `role="tab"` with localized accessible name;
- `data-testid="terminal-view-today"`;
- `data-testid="terminal-view-expert"`;
- `data-testid="risk-inbox"`;
- `data-testid="risk-inspector"`;
- `data-testid="data-health-summary"`;
- `data-testid="terminal-overlays"`.

Do not use `getByRole('table').first()` to choose a view. Today and Company Financials may also contain tables.

### 7.4 V2 critical scenario

1. Authenticated root opens Today for an allowed pilot.
2. Context shows period, Data through, Coverage and reconciliation state.
3. User identifies a risk and sees Risk/Confidence separately.
4. Risk selection opens inspector without losing list context.
5. Evidence opens within two actions.
6. Assign/Acknowledge reaches a real action flow.
7. Switching to Expert reveals the HeatMap.
8. Returning to Today preserves period/company.
9. Alert deep link restores company, period and KPI.
10. Scenario shows baseline, assumption and before/after delta.
11. Stale/Unknown/Unauthorized/API error/empty states remain distinct.
12. EN/RU/AZ render without key leakage or clipping.
13. Mobile shows brief/actions and does not squeeze the desktop HeatMap.

## 8. Visual regression

### 8.1 Mandatory existing gate

Any change to:

- `HeatMap.tsx`;
- `CompanyTree.tsx`;
- `PanelGrid.tsx`;
- terminal module CSS;
- `src/app/globals.css`;
- `tailwind.config.ts`;

requires:

```bash
npm run test:e2e -- visual-baseline
```

### 8.2 V2 baselines

Add separate deterministic baselines:

```text
terminal-today-chromium-darwin.png
terminal-expert-chromium-darwin.png
terminal-kpi-detail-chromium-darwin.png
terminal-mobile-brief-chromium-darwin.png
```

The Expert baseline selects Expert explicitly. The Today baseline masks only dynamic leaf nodes.

### 8.3 Intentional update workflow

1. Run the gate and inspect the failure.
2. Compare expected, actual and diff PNGs.
3. Confirm exact changed regions and state.
4. Update only the affected baseline.
5. Inspect the new PNG directly.
6. Stage only approved files.
7. Include this commit-message line:

```text
BASELINE UPDATE: <specific reason>
```

Do not run a global snapshot update and accept unrelated changes.

### 8.4 Cross-platform

Current committed terminal baseline is macOS Chromium. Add Linux baselines when CI becomes an enforced target. Do not claim cross-platform visual stability before those baselines exist.

## 9. Accessibility validation

`@axe-core/playwright` is not currently installed. Adding it is an explicit dependency change and should be scoped to the accessibility PR.

Automated gate after installation:

```bash
npm run test:e2e -- terminal-a11y
```

Acceptance:

- zero critical/serious automated violations;
- complete primary flow with keyboard only;
- visible focus on every control;
- Escape closes overlays and returns focus;
- proper tablist/tab/tabpanel semantics;
- no color-only status;
- contrast thresholds pass;
- 200% zoom preserves actions/evidence;
- reduced motion works;
- VoiceOver manual flow: Today -> risk -> evidence -> action;
- no page-level horizontal scroll at 320 px for supported mobile views.

## 10. Performance validation

### 10.1 Representative fixture

Create a deterministic synthetic/performance organization with:

- 60 companies;
- at least 50 material KPI columns, preferably 80 for headroom;
- realistic known/unknown/provisional distribution;
- sparklines;
- company hierarchy and rollups;
- alerts and scenario overlays.

Until this exists, any 60-company performance claim is unverified.

### 10.2 Proposed budgets

| Metric | Target |
|---|---:|
| Overview API p95, warm | 500 ms or less |
| Today meaningful content, warm | 750 ms or less |
| Today meaningful content, cold staging | 1.5 s or less |
| 60 x 50 Expert render after data | 500 ms or less |
| View-switch visual feedback | 150 ms or less |
| Common interaction response | 200 ms or less |
| Matrix scroll | at least 55 fps without long stalls |
| Repeated view switches | no growing listeners, request count or memory |

API latency and browser render time are measured separately.

### 10.3 Existing monitor

The repository includes `npm run perf-monitor`. Confirm its current arguments before relying on a documented invocation. It measures database/API behavior, not the full browser rendering budget.

## 11. UAT

### 11.1 Participants

Minimum participant set:

- holding CFO or executive delegate;
- risk manager;
- finance controller;
- finance operator;
- internal auditor/viewer;
- analyst/power user;
- at least one first-time user.

Run two rounds:

1. interactive prototype;
2. pilot build over real approved data.

Developers observe but do not coach navigation.

### 11.2 Tasks

| Task | Pass target |
|---|---:|
| Find largest material risk | 30 s |
| State cause, Confidence and As-of | 45 s |
| Trace to original evidence | 60 s |
| Assign owner and deadline | 60 s |
| Switch period and explain Data through | 45 s |
| Find a KPI in Expert | 45 s |
| Run scenario and explain delta | 2 min |
| Interpret Unknown/Stale correctly | 100% correctness |

### 11.3 UAT metrics

- critical task completion at least 90%;
- first-click success at least 85%;
- median SEQ at least 5.5/7;
- SUS at least 80;
- zero cases where Unknown/Stale is interpreted as Stable/Green;
- zero cases where Modeled/Proxy is interpreted as confirmed reported evidence;
- first-time user can explain Risk versus Confidence;
- no irreversible action without appropriate confirmation/Undo.

Sign-off: CFO, Risk Owner, Finance Controller and Product Owner.

## 12. Shadow rollout

### 12.1 Flags

```text
RISK_TERMINAL_V2_ENABLED=false
RISK_TERMINAL_V2_ORG_ALLOWLIST=
RISK_TERMINAL_V2_DEFAULT_VIEW=expert
RISK_TERMINAL_V2_AI_AUTORUN=false
```

### 12.2 Stages

1. Dark launch, V2 disabled.
2. Shadow compute for at least 10 working days.
3. Internal opt-in for engineering and finance power users.
4. Pilot with 3-5 representative companies and 5-8 users.
5. Today available but not default.
6. Today default for pilot allowlist.
7. One real close cycle.
8. Gradual internal expansion.
9. Holding-wide expansion only after a new go/no-go decision.

Keep the legacy Expert shell available for at least 30 days or two stable releases after pilot cutover.

### 12.3 Shadow comparison

Compare by company/KPI/period/revision:

- value and unit;
- status;
- PeriodContext and Data through;
- Risk Index;
- Confidence/Coverage;
- alert/event count and deduplication;
- lineage completeness;
- response latency.

Every material difference receives a reason code:

```text
classification
sign
period_basis
source_coverage
formula_version
threshold_version
revision
legacy_defect
new_defect
approved_methodology_change
```

V2 alerts remain silent and create no notifications during shadow.

## 13. Rollback

- Keep the old shell and read path through rollout.
- Keep schema changes additive.
- Use a feature-flag/read-pointer cutover.
- Rehearse rollback before default switch.

Emergency configuration:

```text
RISK_TERMINAL_V2_ENABLED=false
RISK_TERMINAL_V2_DEFAULT_VIEW=expert
RISK_TERMINAL_V2_AI_AUTORUN=false
```

After rollback:

- restart/redeploy through the normal approved process;
- run login and terminal smoke;
- verify audit feed and alert actions;
- compare serving observation counts;
- confirm no V2 side effects continue.

Immediate rollback triggers:

- any cross-org/auth data exposure;
- unexplained material value/status difference;
- broken login, deep link or risk action;
- false green from Unknown/Stale evidence;
- AI execution without explicit action;
- sustained error or latency threshold breach;
- new UI prevents access to Expert fallback.

## 14. Production go/no-go

### GO only when

- TypeScript, full Vitest, build, Prisma validation and required Playwright pass;
- visual diffs are inspected and approved;
- zero P0/P1 defects;
- zero unexplained material financial/status differences;
- zero stale decision observations with normal active color;
- 100% of decision KPIs show As-of, Confidence, source and effective specification;
- 100% of colored decision KPIs have lineage;
- low Coverage cannot produce a green composite;
- accessibility has zero critical/serious issues;
- UAT reaches at least 90% and SUS 80;
- representative performance budgets pass;
- shadow runs at least 10 working days;
- one real close cycle passes;
- rollback rehearsal succeeds;
- CFO, Risk Owner and Finance Controller sign off;
- TLS and non-demo credentials are active before external client access.

### NO-GO examples

- only current small-company data was tested;
- Today unmounts overlays/commands;
- visual baseline hides the entire Today surface;
- E2E still depends on the first table;
- snapshot changes were regenerated without inspection;
- new UI hides Unknown, provenance, Coverage or stale state;
- methodology owner has not approved a decision KPI;
- a production date is prioritized over an unresolved material reconciliation.

## 15. Risk register

| Risk | Probability/impact | Mitigation |
|---|---|---|
| Today unmounts PanelGrid overlays | high/high | extract and test always-mounted overlay host first |
| AI prewarm spends money on entry | high/medium | autorun off, explicit action and network regression test |
| Existing E2E assumes HeatMap default | high/high | explicit Expert view and stable selectors |
| Today visual area is fully masked | high/high | mask only volatile leaves |
| Performance tested on 8, not 60 companies | high/high | representative 60 x 50/80 fixture and perf gate |
| Finance SME becomes bottleneck | high/high | fixed methodology sessions and 24-48h decision SLA |
| Team attempts all 110 KPIs | high/high | enforce 25-35 decision subset |
| New UI makes unsupported data look trustworthy | medium/high | mandatory Confidence/Coverage/As-of and abstention |
| SSR/client feature flags diverge | medium/high | server-resolved initial flags |
| View switch loses selection/SSE state | medium/high | provider/store invariants and E2E |
| RU/AZ text breaks layout | high/medium | locale E2E, expansion and visual tests |
| Simplification frustrates power users | medium/medium | retain one-click Expert Mode |
| Shadow doubles compute load | medium/medium | sampling, read-only compute and monitoring |
| Deep links open the wrong view | medium/high | company/indicator/period/from E2E matrix |
| Non-additive migration blocks rollback | low/high | additive schema until two stable releases |
| SSE makes tests wait forever | high/medium | condition-based readiness, no networkidle |
