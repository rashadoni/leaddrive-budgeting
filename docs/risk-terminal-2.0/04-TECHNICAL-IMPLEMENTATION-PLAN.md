# Risk Terminal 2.0, technical implementation plan

## 1. Delivery strategy

Use a strangler migration:

1. Protect users from false assurance.
2. Establish canonical data/period contracts.
3. Run old and new calculation paths side by side.
4. Isolate the current Expert workspace without changing behavior.
5. Add the modern shell behind a feature flag.
6. Add Today, Portfolio and Company views over the new overview contract.
7. Pilot, compare, sign off and change the default.
8. Retain the legacy Expert fallback through at least one close cycle and two stable releases.

Do not combine the financial-truth migration, store replacement, full UI redesign and KPI-catalog rewrite into one branch or PR.

## 2. Repository and workflow constraints

### 2.1 Required reading

Before any implementation session:

1. `AGENTS.md`;
2. `docs/ROADMAP.md`;
3. `PRODUCT.md`;
4. this documentation package in numerical order.

### 2.2 Development server

- The dev server is managed by LaunchAgent `com.budgetpro.dev`.
- Do not start `npm run dev` manually.
- Restart only with the documented LaunchAgent command when needed.
- Read `/Users/rashadrahimov/Library/Logs/budgetpro.log` for the effective port and server health.

Environment observation on 2026-07-15: Docker occupied port 3000 and Next fell back to 3001. This is drift-prone. Verify at execution time. If still true, point E2E explicitly with `E2E_BASE_URL=http://localhost:3001`; do not edit global test defaults to match a temporary local collision.

### 2.3 Existing uncommitted/untracked work

At documentation time, the worktree contained unrelated user-owned changes:

```text
M  .claude/settings.json
?? .agents/
?? AGENTS.md
?? scripts/check-sales-parse-local.ts
?? scripts/import-fo-workbook-local.ts
?? scripts/recompute-local-all.ts
```

Recheck `git status --short`. Do not stage, reset, edit or delete these paths unless the user explicitly adds them to scope.

### 2.4 Git and roadmap

- Use path-scoped staging only.
- Do not use `git add .` or `git add -A`.
- User owns the ship/cut decision.
- Update `docs/ROADMAP.md` only for tasks actually started/completed.
- Add dated changelog entries when implementation tasks complete.
- Do not mark Phase 10 complete based on documentation, code compilation or a screenshot alone.

## 3. Current terminal architecture

### 3.1 Route composition

Current page:

`src/app/(dashboard)/budgeting/terminal/page.tsx`

Composition:

```text
TerminalDeepLinkHandler
TerminalLockedPeriodBanner
HotkeyToolbar
CommandBar
SignalsStrip
PanelGrid
```

JetBrains Mono and the dark background are applied to the entire route. The target shell should scope mono/dark-terminal styling to Expert Mode.

### 3.2 PanelGrid responsibilities

`src/features/terminal/components/PanelGrid.tsx` currently owns:

- mounting of global overlays/export listeners;
- keyboard shortcuts;
- compact/watchlist hydration;
- persisted resizable layouts;
- the four-pane Expert workspace.

Expert panes:

- F1 `CompanyTree`;
- F2 `HeatMap`;
- F3 `IndicatorDetail`;
- F4 `VarianceExplainerPanel`.

Persisted layout keys that must remain compatible:

```text
terminal-layout-v1-outer
terminal-layout-v1-top
terminal-layout-v1-bottom
```

### 3.3 Terminal store

`src/features/terminal/store/terminalStore.ts` is a hand-rolled reactive singleton.

Important state:

- active company, panel and period;
- active IndicatorValue;
- mutually exclusive missing/rollup selection;
- panel searches;
- alert counts/matches;
- watchlist/starred/recent companies;
- compact mode;
- scenario delta and scenario brief.

Do not replace this store during the shell migration. Add view/provider layers around it. A store migration is a separate decision and PR.

Preserve selection invariants. New Inbox/Portfolio interactions must call existing actions such as `selectCompany`, `setActiveIndicatorValue`, `setPendingMissingCell` and `setPendingRollupCell` rather than writing partial state directly.

### 3.4 Shared matrix

`src/features/terminal/hooks/use-matrix.ts`

Current response:

```ts
interface MatrixResponse {
  period: string
  availableYears?: number[]
  companies: MatrixCompanyRow[]
  indicators: MatrixIndicatorCol[]
  cells: HeatMapCell[]
  lastComputedAt?: string | null
}
```

Endpoint:

```text
GET /api/indicators/matrix?period=...&includePending=...
```

The hook has a module-level per-period cache. It does not centralize SSE invalidation.

### 3.5 Shared company tree

`src/features/terminal/hooks/use-companies.ts`

This hook can be reused. It returns the hierarchy, ID/code maps, loading/error and refresh.

### 3.6 Couplings that must be removed before cutover

#### Alerts depend on HeatMap

Alert matches are evaluated/published in HeatMap-related logic. If Expert Mode is unmounted, consumers may see `null` alerts.

Required: move evaluation to a shared provider or server overview endpoint.

#### Overlays depend on PanelGrid

Audit, Alerts, Scenarios, What-if, Help, Compare, Peer, Exports, Comments, Chat, Subscriptions, Intel and Breach Forecast components are mounted within PanelGrid.

Required: extract `TerminalOverlayHost`, always mounted by the route.

#### Today triggers AI prewarm

The current `TodayBrief` can automatically trigger a variance explanation after mount.

Required: remove auto-run from the modern default. Add a regression test that no paid/slow AI endpoint is called before explicit user action.

#### Freshness contract drift

Align per-cell timestamp fields between matrix route, HeatMapCell type and CompanyTree before building company freshness summaries.

## 4. Proposed architecture

```text
TerminalPage (server boundary, resolves feature flags)
└─ TerminalDataProvider
   └─ TerminalShell
      ├─ TerminalHeader
      ├─ TerminalViewNav
      ├─ Active view
      │  ├─ TodayView
      │  ├─ PortfolioView
      │  ├─ CompanyWorkspace
      │  ├─ ScenarioLabView
      │  ├─ DataHealthView
      │  └─ ExpertWorkspace (lazy)
      └─ TerminalOverlayHost
```

### 4.1 Server façade

Add a thin view façade:

```text
src/lib/risk/terminal-overview.ts
src/app/api/terminal/overview/route.ts
```

The façade composes certified services. It must not contain new statement classification or KPI formulas.

### 4.2 Provider

Initial provider responsibilities:

- selected PeriodContext;
- company hierarchy;
- overview/inbox/company summaries;
- locks/reconciliation state;
- one centralized SSE refresh;
- alert/event data;
- stable loading/error/last-good state;
- view refresh.

During the transition, it may wrap `useMatrix` and `useCompanies`. The long-term data source is the versioned terminal overview contract.

### 4.3 URL view state

Add:

```text
src/features/terminal/lib/terminal-view.ts
src/features/terminal/hooks/use-terminal-view.ts
```

Canonical values:

```text
today | portfolio | company | scenarios | data-health | expert
```

The hook reads/writes `view` while preserving `company`, `indicator`, `period`, `from` and `alertId`.

### 4.4 Expert boundary

Add:

```text
src/features/terminal/components/expert/ExpertWorkspace.tsx
```

Initial composition is behavior-identical:

```text
HotkeyToolbar
CommandBar
SignalsStrip
PanelGrid
```

Load Expert Mode dynamically so the dense matrix and export/analysis bundles do not block Today. Preload it on mode-switch hover/focus when practical.

### 4.5 Overlay host

Add:

```text
src/features/terminal/components/shell/TerminalOverlayHost.tsx
```

Move overlay/export mounts out of PanelGrid without changing their CustomEvent names. Add one `data-testid="terminal-overlays"` root for test stability.

## 5. Proposed file map

### 5.1 Design and architecture

```text
DESIGN.md
docs/architecture/ADR-risk-terminal-trust-core.md
docs/architecture/ADR-risk-terminal-experience-shell.md
```

### 5.2 Domain/view-model layer

```text
src/features/terminal/types/terminal-overview.ts
src/features/terminal/lib/build-risk-inbox.ts
src/features/terminal/lib/build-portfolio-domains.ts
src/features/terminal/lib/build-company-summary.ts
src/features/terminal/lib/terminal-view.ts
src/features/terminal/hooks/use-terminal-view.ts
src/features/terminal/hooks/use-terminal-overview.ts
src/features/terminal/providers/TerminalDataProvider.tsx
```

Extract pure logic currently embedded in `TodayBrief`, `ActionCenterPanel`, `CompanySnapshot` and `use-heat-map-model` before reusing it.

### 5.3 Shell

```text
src/features/terminal/components/shell/TerminalShell.tsx
src/features/terminal/components/shell/TerminalHeader.tsx
src/features/terminal/components/shell/TerminalViewNav.tsx
src/features/terminal/components/shell/TerminalContextBar.tsx
src/features/terminal/components/shell/TerminalCommandPalette.tsx
src/features/terminal/components/shell/TerminalOverlayHost.tsx
src/features/terminal/components/expert/ExpertWorkspace.tsx
```

### 5.4 Modern views

```text
src/features/terminal/components/today/TodayView.tsx
src/features/terminal/components/today/RiskInbox.tsx
src/features/terminal/components/today/RiskInboxRow.tsx
src/features/terminal/components/today/RiskInspector.tsx

src/features/terminal/components/portfolio/PortfolioView.tsx
src/features/terminal/components/portfolio/PortfolioRiskMap.tsx
src/features/terminal/components/portfolio/RiskDomainCell.tsx

src/features/terminal/components/company/CompanyWorkspace.tsx
src/features/terminal/components/company/CompanySummaryTab.tsx
src/features/terminal/components/company/CompanyDriversTab.tsx
src/features/terminal/components/company/CompanyFinancialsTab.tsx
src/features/terminal/components/company/CompanyRisksTab.tsx
src/features/terminal/components/company/CompanyScenariosTab.tsx
src/features/terminal/components/company/CompanyEvidenceTab.tsx

src/features/terminal/components/data-health/DataHealthView.tsx
src/features/terminal/components/scenarios/ScenarioLabView.tsx
```

### 5.5 Shared components

```text
src/features/terminal/components/shared/CompanySwitcher.tsx
src/features/terminal/components/shared/RiskBadge.tsx
src/features/terminal/components/shared/ConfidenceBadge.tsx
src/features/terminal/components/shared/AsOfBlock.tsx
src/features/terminal/components/shared/CoverageMeter.tsx
src/features/terminal/components/shared/DecisionGradeBadge.tsx
src/features/terminal/components/shared/FriendlyEmptyState.tsx
src/features/terminal/components/shared/KpiDetailSheet.tsx
```

Reuse existing primitives:

- Button, Input, Select, Tooltip, Popover, Progress;
- Tabs and Sheet;
- DataBoundary;
- Sparkline;
- extracted IndicatorDetail sections.

Do not use marketing-oriented magic cards, particles or glass effects in the terminal.

## 6. Workstreams and dependencies

```text
Protective mode
  -> Canonical finance
  -> Period/Revision
  -> Exact recompute
  -> Certified KPI subset
  -> Lineage
  -> Risk × Confidence
  -> Decision-grade alerts
  -> Overview façade
  -> Modern views
  -> Shadow/UAT/Cutover
```

UI discovery and prototype can run after contracts are documented, but production UI cannot present uncertified values as trusted.

## 7. Implementation phases

### Phase 0, protective mode, 2-3 days

Deliverables:

- feature flags;
- `Legacy / Provisional` labels;
- stale/untraced values lose decision-grade color;
- freeze new KPI/AI feature expansion;
- capture baseline calculation/runtime comparison;
- pilot company/KPI list;
- RACI and methodology decision log.

Gate: no old cached result can be mistaken for current reconciled evidence.

### Phase 1, canonical finance and period, weeks 1-3

Deliverables:

- canonical statement service/mart;
- mapping version;
- StatementSnapshot;
- PeriodContext;
- DataRevision;
- golden reconciliations;
- one shared consumer path for P&L/Risk pilot KPIs.

Gate: no unexplained material difference for pilot statements/periods.

### Phase 2, exact recompute and first KPI set, weeks 3-6

Deliverables:

- exact PeriodKey queue payload;
- dependency expansion M/Q/YTD/FY/LTM;
- idempotent CalculationRun;
- KPI registry;
- corrected first 25-35 KPIs;
- period-kind/golden/boundary/null/stale tests.

Gate: 100% of pilot decision KPIs are approved and deterministic.

### Phase 3, lineage and Risk × Confidence, weeks 4-7

Deliverables:

- immutable observation/history;
- source input lineage;
- CompositeSnapshot;
- Coverage/Confidence;
- abstention below gate;
- decision-grade event eligibility.

Gate: every colored pilot value traces to source and no low-coverage green composite exists.

### Phase 4, UI prototype and pure view models, weeks 2-6 in parallel

Deliverables:

- `DESIGN.md`;
- interactive prototype for Today, Portfolio, Company;
- usability round 1;
- extracted pure inbox/company/domain builders;
- stable overview response proposal.

Gate: five primary tasks are understood before expensive UI construction.

### Phase 5, modern shell and views, weeks 7-10

Deliverables:

- provider, URL view state and overlay host;
- isolated lazy Expert workspace;
- Today/Inbox;
- Portfolio;
- Company Workspace and KPI Detail;
- Data Health;
- Scenario Lab;
- EN/RU/AZ and responsive structure.

Gate: UI contains no financial/KPI formulas and consumes certified contracts.

### Phase 6, controlled beta, weeks 9-12

Deliverables:

- shadow old/new comparison;
- silent V2 alerts;
- visual/a11y/performance gates;
- task-based UAT;
- documented divergence reasons;
- pilot allowlist.

Gate: no P0/P1, task success at least 90%, every material difference explained.

### Phase 7, close cycle and cutover, weeks 13-16

Deliverables:

- one real close cycle;
- sign-offs;
- training/help;
- rollback rehearsal;
- Today default for approved entities;
- monitoring.

Gate: all production criteria in `05-TEST-UAT-ROLLOUT.md` pass.

## 8. Recommended PR sequence

### PR 1, documentation and ADRs only

- Add Phase 10 roadmap items when implementation starts.
- Add `DESIGN.md` and ADRs.
- No runtime change.

Suggested commit:

```text
docs(terminal): define Risk Terminal 2.0 contracts
```

### PR 2, pure extraction with zero visual change

- Extract risk-inbox, company-summary and portfolio-domain builders.
- Make current components call the extracted functions.
- Add unit tests.

Suggested commit:

```text
refactor(terminal): extract reusable risk view models
```

### PR 3, canonical view/data contracts

- Align freshness/timestamp fields.
- Add overview façade/hook.
- Centralize alerts, period locks and SSE refresh.
- Keep current UI default.

Suggested commit:

```text
refactor(terminal): centralize overview and freshness data
```

### PR 4, overlays and Expert boundary

- Extract `TerminalOverlayHost`.
- Add `ExpertWorkspace`.
- Preserve events, layout keys, shortcuts and visual output.
- Root still defaults to Expert.

Suggested commit:

```text
refactor(terminal): isolate expert workspace and overlays
```

### PR 5, modern shell behind opt-in

- Add shell/header/nav and URL view state.
- Enable only with server-resolved feature flag or `?view=today` for authorized pilot users.
- Add focus, hydration and URL tests.

Suggested commit:

```text
feat(terminal): add decision cockpit shell
```

### PR 6, Today / Risk Inbox

- Add context strip, Inbox, inspector and explicit actions.
- No automatic AI call.
- Add mobile single-column adaptation.

Suggested commit:

```text
feat(terminal): add decision-first risk inbox
```

### PR 7, Portfolio and Company

Prefer two commits/PRs if large:

```text
feat(terminal): add portfolio risk domains
feat(terminal): add company risk workspace
```

### PR 8, Data Health and Scenario Lab

- Reuse existing drift/scenario endpoints where contractually safe.
- Retain event adapters for old commands.

Suggested commit:

```text
feat(terminal): add data health and guided scenarios
```

### PR 9, controlled cutover

- Today becomes default only for pilot allowlist.
- Expert is one click and one URL parameter away.
- Replace warning-only mobile behavior with structural adaptation.

Suggested commit:

```text
feat(terminal): make risk inbox the pilot default
```

### PR 10, Expert polish and scale

- Only after modern cutover is stable.
- Virtualization, control hierarchy, type size and semantic tokens.
- Intentional visual baseline update.

## 9. Feature flags

Minimum server-resolved flags:

```text
RISK_TERMINAL_V2_ENABLED=false
RISK_TERMINAL_V2_ORG_ALLOWLIST=
RISK_TERMINAL_V2_DEFAULT_VIEW=expert
RISK_TERMINAL_V2_AI_AUTORUN=false
```

These are operational rollout flags, not commercial entitlements.

Resolve flags on the server and pass initial state to the client. Do not read a client-only environment flag that causes SSR/hydration divergence.

## 10. React and Next.js constraints

- Start independent server requests concurrently and await late.
- Do not serialize the full matrix into views that only need overview rows.
- Dynamically import Expert workspace and heavy export/scenario modules.
- Import components directly, avoid broad barrel imports for large terminal modules.
- Keep derived view models in pure functions and memoize expensive projections.
- Use stable primitive dependencies in effects.
- Do not mirror derived state with effects when it can be computed during render.
- Use transitions/deferred values for expensive filters.
- Centralize global listeners and clean them up exactly once.
- Use content visibility/virtualization for long lists/matrix.
- Avoid inline component declarations and unstable non-primitive defaults.
- Keep command/search inputs responsive during background recomputation.

## 11. API and security constraints

- Every new route uses existing auth/org/RBAC helpers.
- Scope is derived server-side, never trusted from a client organization ID.
- Company/subgroup access applies before serialization.
- Every mutation creates AuditEvent and uses idempotency where relevant.
- Do not expose source rows outside the user's allowed company scope.
- Evidence downloads/uploads require explicit user action and existing role gates.
- Shadow compute creates no notifications or external side effects.
- Scenario overrides never mutate actual/plan source data.

## 12. Schema migration strategy

- Additive models/columns only through shadow rollout.
- Backfill in resumable batches with progress and audit log.
- Keep legacy `IndicatorValue` as serving projection until cutover.
- New observations/history live beside it.
- Cutover uses a read pointer/feature flag, not an irreversible rewrite.
- Destructive cleanup happens only after two stable releases and explicit approval.

## 13. Prohibited implementation shortcuts

- Do not build Today directly from ad hoc component filters over raw DB records.
- Do not copy `pnl-aggregation.ts` into a new API.
- Do not use `MAX(computedAt)` as portfolio freshness.
- Do not calculate alerts only when HeatMap is mounted.
- Do not hide Unknown by default.
- Do not use one composite number without Confidence/Coverage.
- Do not keep the whole modern route in JetBrains Mono.
- Do not auto-run AI on terminal entry.
- Do not replace the store, router, data model and UI at once.
- Do not accept global screenshot baseline updates without inspecting the specific diffs.
- Do not claim 60-company performance without a representative fixture and measured result.

## 14. Phase definition of done

A phase is complete only when:

- code and migrations are present;
- targeted and full required tests pass;
- visual diffs are reviewed where required;
- runtime behavior is verified against the intended environment;
- documentation/roadmap are updated;
- owner sign-off exists when methodology or financial totals are involved;
- no unrelated worktree paths were staged;
- rollback/compatibility path is documented.
