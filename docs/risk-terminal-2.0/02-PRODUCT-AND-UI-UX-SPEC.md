# Risk Terminal 2.0, product and UI/UX specification

## 1. Product experience statement

Risk Terminal 2.0 is a calm decision environment for a holding CFO, risk manager and finance controller. It is not a trading terminal and it does not need to imitate Bloomberg visually. It should borrow the useful qualities of a professional terminal:

- exact context;
- fast keyboard access;
- stable functions;
- deep drill-down;
- visible source and as-of;
- high information density when the user asks for it.

The default experience must be understandable without memorizing internal KPI codes, F1-F4 panels or command verbs.

Friendly means clear, forgiving and explanatory. It does not mean playful, decorative or imprecise.

## 2. Physical scene and visual direction

### 2.1 Scene

A CFO or risk manager works on a 27-inch monitor in a bright office. They have 10-15 minutes before a meeting. They need to distinguish a real material problem from incomplete or stale evidence, assign an owner and move on.

### 2.2 Direction: Calm Control Room

- Light operational workspace is the default.
- A deep graphite context header anchors the product.
- Semantic color is used primarily for risk and status, not decoration.
- Dark `Night Ops` is a supported theme, not the only identity.
- Expert Mode retains the compact terminal character.
- Decision/Expert mode and Light/Night theme are independent settings.
- No glassmorphism, neon glow, gradient text, decorative particle effects or endless equal card grids.
- Grouping uses alignment, spacing, bands and dividers before containers.

The information hierarchy is:

> Material risk, then Confidence/Coverage, then As-of, then evidence, then action.

## 3. Personas and jobs to be done

| Persona | Primary job | Current friction | Required outcome |
|---|---|---|---|
| Holding CFO | Identify decisions needed today | Four panes and a dense matrix require analysis before prioritization | Top material risks and required actions visible in 30 seconds |
| Risk Manager | Investigate, assign and resolve risk events | Today, Alerts and Action Center are separate surfaces | One Risk Inbox with lifecycle, owner, SLA and evidence |
| Risk Analyst | Compare entities/periods/KPIs and inspect formulas | Many equal-weight controls, but strong analytical depth | Expert Mode retains matrix, shortcuts and drill-down |
| Finance Controller | Close data gaps and reconcile sources | Readiness, freshness and reconciliation are distributed | One Data Health queue tied to affected decisions |
| Methodology Owner | Govern KPI definitions and thresholds | Definitions are not experienced as a controlled registry | Versioning, review, effective dates and impact preview |
| Auditor/Viewer | Reproduce a value without changing data | Lineage is incomplete or hidden | Evidence chain available from every decision-grade value |
| First-time manager | Understand the system without training | Internal codes, F-keys, `GO`, tiny labels and multiple searches | Natural-language default and progressive disclosure |
| Mobile approver | Review and assign risk away from desk | Current mobile behavior is an advisory banner | True mobile brief, evidence summary and actions |

Core jobs:

1. When the day starts, show only items that need attention or a decision.
2. When risk changes, explain the driver, evidence, confidence and date basis.
3. When a risk is delegated, preserve owner, deadline, comments and audit history.
4. When a number is challenged, trace it to the source file and row.
5. When a shock is modeled, preserve the baseline and explain the financial/risk delta.
6. When an analyst needs depth, provide the full professional matrix without simplification.

## 4. Information architecture

### 4.1 Top-level views

The default navigation contains five views:

1. **Today**
2. **Portfolio**
3. **Companies**
4. **Scenarios**
5. **Data Health**

Methodology remains under Admin/Settings and appears only for authorized roles.

### 4.2 Experience mode

Persistent mode switch:

- **Decision**: default, task-oriented and progressively disclosed.
- **Expert**: full matrix, shortcuts, dense filters, layouts and pop-outs.

### 4.3 URL contract

Keep the current route and deep-link compatibility during migration:

```text
/budgeting/terminal?view=today
/budgeting/terminal?view=portfolio
/budgeting/terminal?view=company&company=AZSF
/budgeting/terminal?view=scenarios
/budgeting/terminal?view=data-health
/budgeting/terminal?view=expert
```

Existing parameters remain supported:

```text
company, indicator, period, from, alertId
```

View, scope, period, company, selected risk and KPI must be shareable. A refresh must restore the same context.

## 5. Global shell

The modern shell replaces the stacked HotkeyToolbar, CommandBar, SignalsStrip and PanelGrid on the default experience. Expert Mode continues to render them until its own controlled simplification.

### 5.1 Context header, 56 px

Left:

- product label `Risk Center`;
- hierarchy breadcrumb;
- scope switcher for holding, subgroup or company.

Center:

- selected period;
- `Data through`;
- material Coverage;
- reconciliation/lock state.

Right:

- global search and command palette, `Cmd/Ctrl+K`;
- Decision/Expert mode;
- theme;
- help;
- user menu.

### 5.2 Section navigation, 40 px

- five top-level views;
- active view clearly identified;
- one contextual primary action;
- no more than two visible secondary actions;
- remaining actions live under `More` or the command palette.

### 5.3 Command model

The modern user can search by:

- company name/code;
- KPI natural-language name/code;
- risk event;
- action;
- application destination.

Legacy command verbs continue to work in Expert Mode. They are a power-user accelerator, not a prerequisite for navigation.

## 6. Today, Risk Inbox

Today is the default destination.

### 6.1 Desktop structure

```text
┌ FO Holding · YTD May 2026 · data through 31 May · coverage 82% ┐
├ Today | Portfolio | Companies | Scenarios | Data Health         ┤
├ 4 critical · 6 new · 3 overdue · 11 data issues                ┤
│ Risk Inbox, 64%                    │ Selected risk, 36%          │
│ Needs decision today              │ Why surfaced                │
│ New since last visit              │ Value, threshold, trend     │
│ Data gaps                         │ Confidence, as-of, evidence │
│ Watching                          │ Owner, action, activity     │
└────────────────────────────────────┴─────────────────────────────┘
```

### 6.2 Summary strip

Use one flat filter strip, not four hero cards:

- Critical;
- New;
- Overdue;
- Data issues.

Each item filters the Inbox and exposes count plus trend from the prior comparable period.

### 6.3 Risk Inbox sections

Default grouping:

1. Needs decision today;
2. New since last visit;
3. Data quality blockers;
4. Watching;
5. Recently resolved, collapsed.

Alternative sorting:

- materiality;
- severity;
- due date;
- company;
- confidence;
- newest change.

### 6.4 Risk row contract

Desktop height: 64-72 px. Mobile height may grow with content.

Required fields:

- severity shape plus localized text;
- company;
- human-readable headline;
- material impact;
- change or distance to threshold;
- Confidence;
- Data through;
- owner and SLA;
- lifecycle state.

Example:

> AZSF: EBITDA margin is 4.2 pp below the approved threshold.  
> High impact, Confidence 88%, data through May 2026, owner not assigned.

Internal identifiers such as `IND_EBITDA_MARGIN` are secondary metadata in Decision Mode.

### 6.5 Row actions

Always reachable by keyboard and visible on selection:

- Assign owner;
- Acknowledge;
- Open analysis;
- Run scenario;
- Add comment;
- Resolve, only when evidence requirements are met.

### 6.6 Inspector

Selection updates a persistent right inspector. It does not open a modal.

Order:

1. why the event surfaced;
2. value, threshold and delta;
3. Risk Index and Confidence separately;
4. trend and comparison;
5. period, Data through, Coverage and reconciliation;
6. provenance and evidence summary;
7. recommended response, clearly labelled as rule-based or AI-generated;
8. owner, due date and state;
9. comments and activity;
10. `Open company workspace` and `Open in Expert Matrix`.

### 6.7 Risk event lifecycle

```text
New -> Acknowledged -> Assigned -> In progress -> Resolved -> Reopened
```

Rules:

- Acknowledge does not mean Resolve.
- Resolve requires a reason and evidence/reference.
- Every transition creates an AuditEvent.
- Undo is available for reversible transitions.
- Duplicate alerts for the same driver/company/period are grouped into one event with affected KPIs.
- Stale/proxy signals create data or watch events, not confirmed financial breaches.

## 7. Portfolio view

### 7.1 Decision view

Portfolio summarizes companies across 6-8 domains:

- Financial;
- Liquidity;
- FX;
- Operations;
- Counterparty;
- Compliance;
- External;
- Data Quality.

Do not expose 110 KPI columns by default.

### 7.2 Domain cell

Required content:

- risk state and shape;
- trend;
- Confidence/Coverage;
- count of material events;
- stale/provisional marker when applicable.

Example:

> Risk 77, Confidence 42%, Provisional

One opaque `R77` is not acceptable.

### 7.3 Interaction

- Single selection opens contributing risks in the inspector.
- `Enter` or second activation opens the Company Workspace.
- Unknown is visible by default and can be filtered, not silently hidden.
- Filters: scope, materiality, owner, event state, Confidence and data status.

## 8. Company Workspace

### 8.1 Header

- company name and hierarchy;
- Risk Index;
- Confidence and material Coverage;
- Data through;
- reconciliation/lock state;
- largest material change;
- responsible risk owner.

### 8.2 Tabs

- Summary;
- Drivers;
- Financials;
- Risks & Actions;
- Scenarios;
- Evidence.

Company and period remain stable while switching tabs.

### 8.3 Summary

Avoid an equal KPI-card grid. Use:

- one horizontal status band;
- trend timeline;
- ranked driver list;
- next actions;
- concise data-quality note.

### 8.4 Drivers

A contribution waterfall or ranked list shows:

- contribution to the Risk Index;
- change from the comparable period;
- Confidence;
- direct KPI detail link.

### 8.5 Financials

P&L, Balance Sheet and Cash Flow consume the same `PeriodContext` and canonical statement snapshot used by KPIs. Changing statement does not reset scope or period.

### 8.6 Risks & Actions

Full event lifecycle, owner, SLA, comments, resolution evidence and audit activity.

### 8.7 Evidence

Lineage timeline:

```text
Workbook -> Import batch -> Source row -> Statement snapshot
-> KPI definition/version -> Calculation run -> Observation -> Risk event
```

## 9. KPI Detail

Open as a side inspector from Today/Portfolio/Expert, with an optional full nested state in Company Workspace.

Information order:

1. localized name;
2. value, unit and status;
3. Risk, Confidence and Coverage;
4. period, Data through and As-of;
5. threshold and distance to threshold;
6. trend and comparable periods;
7. plain-language formula;
8. inputs and aggregation semantics;
9. source/provenance;
10. benchmark and cohort;
11. calculation, formula and threshold version history;
12. actions and ownership.

Preserve and progressively reuse the strong current drill-down modules in `IndicatorDetail` and `indicator-detail/*`.

## 10. Scenario Lab

Replace modal-first scenario work with a full workspace.

Three zones:

- left: baseline and assumptions;
- center: financial and operational impact;
- right: Risk/Confidence delta and actions.

Always visible:

- baseline period and revision;
- Data through;
- assumption source;
- changed variables;
- affected companies;
- before/after values;
- Confidence;
- scenario owner;
- saved/unsaved state.

Primary actions:

- Compare with baseline;
- Save scenario;
- Share;
- Use in Board Deck.

Closing an unsaved scenario requires a warning. Recompute shows deterministic progress, such as `Recalculating 23 of 180 indicators`.

## 11. Data Health

Data Health is a finance-controller work queue, not a technical admin dashboard.

Top context:

- material period coverage;
- reconciled companies;
- stale sources;
- missing material inputs;
- close readiness.

Views:

- issues queue;
- companies;
- sources;
- close readiness;
- reconciliation history.

Issue row:

- missing/stale item;
- affected decisions and KPIs;
- severity;
- last successful load;
- owner;
- recommended remediation;
- `Open source`, `Upload data`, `Recompute` as permitted.

Distinct states:

- missing;
- stale;
- unreconciled;
- partial period;
- source drift;
- formula failure;
- permission issue.

## 12. Methodology Center

Registry columns:

- KPI;
- tier;
- owner/reviewer;
- industries;
- allowed periods;
- formula version;
- threshold version;
- effective date;
- approval state;
- last change.

KPI page:

- definition;
- numerator/denominator;
- stock/flow semantics;
- aggregation and annualization;
- units/currency;
- threshold and cohort;
- examples and test cases;
- version diff;
- affected entities and outputs.

Lifecycle:

```text
Draft -> Review -> Approved -> Effective -> Superseded
```

Before activation, show an impact preview across representative companies/periods.

## 13. Expert Mode

The current 2 x 2 PanelGrid remains available:

- Company Tree;
- full KPI HeatMap;
- KPI Detail;
- variance/analysis.

Required controlled improvements after the modern shell is stable:

- apply semantic Light and Night Ops tokens;
- retain F1-F4, pop-outs and saved layouts;
- combine search and filter concepts where possible;
- move rare toggles to `View options`;
- do not display Period Chips and Time Machine simultaneously;
- normal row density 28-32 px;
- compact row density 20-24 px;
- minimum expert text 11 px;
- separate Risk and Confidence;
- keep Unknown visible;
- virtualize the large grid;
- support arrows, Home/End and Page Up/Down;
- provide an accessible semantic table alternative.

The Expert workspace keeps JetBrains Mono for numeric/data surfaces. The modern shell uses the system sans stack.

## 14. Interaction states

Every control/component supports:

- default;
- hover;
- focus-visible;
- active/selected;
- disabled with explanation;
- loading;
- error;
- success.

### 14.1 Loading

- Skeleton matches the final structure.
- Header/navigation remain available.
- Lists can stream progressively.
- Recompute shows processed/total.
- Do not replace the whole page with one spinner.

### 14.2 Empty states

Differentiate:

- no new material risks, a healthy state;
- data not loaded for the period;
- no filter matches;
- no accessible companies;
- KPI/scenario not applicable.

Each state has one clear next action.

### 14.3 Error states

Never show raw `Unauthorized`, stack traces or opaque error codes as the primary copy.

Example:

> Risks could not be refreshed. The last saved data through 14 June, 10:32 is shown.  
> Retry, or open Data Health.

Technical detail belongs in a collapsible `For support` section with a copyable request ID.

### 14.4 Stale and provisional

- Preserve the last value only with an explicit stale/provisional treatment.
- Do not present it as decision-grade color.
- Show reason and last valid As-of.
- Disable actions that require confirmed data and explain why.

### 14.5 Feedback and focus

- Selected row uses a calm accent background.
- Inspector updates without page flash.
- Acknowledge/Assign update inline and offer Undo when reversible.
- Failed optimistic actions roll back and return focus to the trigger.

## 15. Visual design system

Exact final colors require contrast verification. The following is the implementation target.

### 15.1 Light, default

```css
--rt-canvas:          oklch(97% 0.008 165);
--rt-surface-1:       oklch(99% 0.004 165);
--rt-surface-2:       oklch(94% 0.010 165);
--rt-surface-3:       oklch(90% 0.012 165);
--rt-border:          oklch(86% 0.012 165);
--rt-text:            oklch(23% 0.018 190);
--rt-text-secondary:  oklch(46% 0.018 190);
--rt-text-muted:      oklch(58% 0.014 190);
--rt-nav:             oklch(21% 0.022 190);
--rt-nav-text:        oklch(92% 0.010 170);
--rt-accent:          oklch(56% 0.110 170);
--rt-accent-hover:    oklch(49% 0.110 170);
--rt-focus:           oklch(63% 0.140 225);

--risk-critical:      oklch(56% 0.180 25);
--risk-critical-bg:   oklch(95% 0.025 25);
--risk-warning:       oklch(69% 0.130 75);
--risk-warning-bg:    oklch(95% 0.030 75);
--risk-stable:        oklch(54% 0.100 150);
--risk-stable-bg:     oklch(95% 0.022 150);
--risk-unknown:       oklch(59% 0.018 225);
--risk-unknown-bg:    oklch(94% 0.010 225);
--risk-provisional:   oklch(58% 0.090 300);
```

### 15.2 Night Ops

```css
--rt-canvas:          oklch(17% 0.012 190);
--rt-surface-1:       oklch(20% 0.015 190);
--rt-surface-2:       oklch(24% 0.016 190);
--rt-surface-3:       oklch(28% 0.016 190);
--rt-border:          oklch(34% 0.018 190);
--rt-text:            oklch(92% 0.010 170);
--rt-text-secondary:  oklch(75% 0.014 175);
--rt-text-muted:      oklch(63% 0.014 180);
--rt-accent:          oklch(70% 0.090 170);
```

Dark depth comes from surface lightness, not heavy shadows or glow.

### 15.3 Risk encoding

| State | Shape | Text | Rule |
|---|---|---|---|
| Critical | square | Critical | confirmed material breach |
| Warning | triangle | Attention | confirmed approaching/medium breach |
| Stable | circle | Stable | decision-grade evidence only |
| Unknown | dash | Insufficient data | missing required evidence |
| Provisional | diamond | Provisional | result exists but assurance gate fails |

Confidence uses neutral/accent styling, never risk colors:

> Confidence 82%, 27 of 33 material KPIs

Provenance labels are written in full in Decision Mode:

- Reported;
- Calculated;
- External;
- Modeled.

### 15.4 Typography

- UI: system stack or Inter if locally supported.
- Numeric/data/code: JetBrains Mono.
- Tabular numbers for values and dates.
- Desktop body: 14/20.
- Mobile body: 16/24.
- Section heading: 18/24.
- Page heading: 24/30.
- Labels/meta: 12/16.
- Expert minimum: 11/14.
- Do not use 8-9px customer-facing text.

### 15.5 Spacing and geometry

Four-point scale:

```text
4, 8, 12, 16, 24, 32, 48
```

- control radius: 6 px;
- surface radius: 8 px;
- overlay radius: 12 px;
- primary desktop target: at least 40 x 40 px;
- mobile target: at least 44 x 44 px;
- avoid nested cards;
- use shadows only for true elevation such as overlays.

## 16. UX copy

Voice:

- precise;
- calm;
- human;
- non-dramatic;
- no jokes in error states;
- no unexplained internal jargon.

| Avoid | Use |
|---|---|
| `R77` | `High risk, Confidence 42%` |
| `UNKNOWN` | `Insufficient data` |
| `LOCKED` | `Period closed` |
| `RECOMPUTE` | `Recalculate indicators` |
| `Unauthorized` | `You do not have access to this company` |
| `No data` | `Data for May has not been loaded` |
| `Submit` | `Assign owner` |
| `OK` | `Acknowledge` |

Context sentence pattern:

> Data through May 2026, Coverage 82%, reconciled 14 June, formula v3.2.

## 17. Internationalization

Supported locales: EN, RU, AZ.

Rules:

- no hardcoded customer-facing strings;
- one glossary for Risk, Confidence, Coverage, As-of, Data through and Reconciliation;
- identifiers are not translated, labels are;
- dates, currencies and numbers use `Intl`;
- full sentences are translated as complete messages;
- use ICU plural rules;
- allow at least 30% text expansion;
- do not concatenate relative-time sentences;
- add pseudo-locale testing;
- prevent EN/RU/AZ mixing in one user block;
- abbreviations in Decision Mode have expanded labels.

Translation keys belong under a new `terminal.v2` namespace in all three message bundles.

## 18. Responsive behavior

### 18.1 At least 1440 px

- Today 64/36 list/inspector split;
- persistent inspector;
- complete navigation;
- Expert 2 x 2 grid.

### 18.2 1024-1439 px

- Today 58/42 split;
- collapsible secondary navigation;
- secondary actions under `More`;
- inspector can collapse.

### 18.3 768-1023 px

- one primary column;
- inspector opens as side sheet;
- Portfolio remains available;
- Company tabs scroll horizontally;
- Expert shows a constrained read-only/compact path or desktop recommendation.

### 18.4 Below 768 px

- Today, Portfolio brief, Company Summary, Risks & Actions and Data Health;
- bottom navigation with five destinations;
- sticky primary action;
- state preserved after backgrounding;
- Expert Matrix is not squeezed into the viewport;
- show `Open Expert Mode on desktop`, not a generic warning banner.

## 19. Accessibility

Target: WCAG 2.2 AA.

- text contrast at least 4.5:1;
- controls and meaningful graphics at least 3:1;
- visible 2 px focus ring with offset;
- color always duplicated by shape and text;
- skip links and correct heading hierarchy;
- proper tablist/tab/tabpanel behavior;
- arrow/J/K navigation for Inbox;
- Enter opens inspector;
- Escape closes overlay and restores trigger focus;
- charts have textual summary and data table;
- live regions only for progress, error and completed action;
- virtualized matrix exposes row/column count;
- complete keyboard flow;
- VoiceOver and NVDA manual testing;
- 200% zoom/reflow;
- hover is never the only action path;
- `prefers-reduced-motion` support;
- reversible actions expose Undo.

## 20. Motion

```css
--motion-instant: 100ms;
--motion-state:   180ms;
--motion-panel:   240ms;
--ease-out: cubic-bezier(0.25, 1, 0.5, 1);
--ease-in:  cubic-bezier(0.7, 0, 0.84, 0);
```

- press/toggle: 100 ms;
- hover/focus/state: 150-180 ms;
- inspector/sheet: 220-240 ms;
- exit approximately 25% faster;
- selected-risk inspector uses opacity plus a maximum 4 px transform;
- updated values may use one 450-600 ms soft flash;
- no bounce or elastic motion;
- no permanent decorative ticker/wallpaper animation;
- do not animate layout properties;
- reduced motion removes spatial movement while preserving feedback.

## 21. Usability acceptance

| Task | Target |
|---|---:|
| Find the largest decision-grade risk | 30 seconds or less |
| Identify Risk, Confidence and As-of | 15 seconds or less without tooltip |
| Assign owner and due date | 60 seconds or less |
| Open formula and source | 45 seconds or less |
| Compare two periods | 60 seconds or less |
| Run a simple scenario | 2 minutes or less |
| Find cause of a data gap | 45 seconds or less |
| Trace to original row | 60 seconds or less |
| Mobile acknowledge/assign | 90 seconds or less |

Global gates:

- at least 90% task success for trained users;
- at least 80% for first-time users;
- first-click success at least 85%;
- error action rate below 3%;
- SUS at least 80;
- SEQ at least 5.5/7;
- no critical WCAG violations;
- no raw technical error as primary copy;
- no dead-end empty states;
- no case where Unknown/Stale is interpreted as Stable/Green.
