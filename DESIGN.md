# DESIGN.md — Risk Terminal 2.0

Implementation-facing design contract, derived from
`docs/risk-terminal-2.0/02-PRODUCT-AND-UI-UX-SPEC.md`. That spec is the source
of truth; this file is what you read while writing a component.

- **Status:** contract only — no implementation yet (Phase 10, Stage A)
- **Pairs with:** `docs/architecture/ADR-risk-terminal-experience-shell.md`,
  `docs/architecture/ADR-risk-terminal-trust-core.md`

---

## 1. What this product is

A calm decision environment for a holding CFO, risk manager and finance
controller. **Not** a trading terminal and not a Bloomberg imitation. It borrows
the useful qualities — exact context, fast keyboard access, stable functions,
deep drill-down, visible source and as-of, density on demand — and drops the
theatre.

The default experience must be usable without memorizing KPI codes, F1–F4 panes
or command verbs.

> **Friendly means clear, forgiving and explanatory. It does not mean playful,
> decorative or imprecise.**

**Scene:** a CFO on a 27-inch monitor in a bright office, 10–15 minutes before a
meeting, needing to separate a real material problem from incomplete or stale
evidence, assign an owner, and move on.

**Information hierarchy — in this order, everywhere:**

> material risk → Confidence/Coverage → As-of → evidence → action

---

## 2. Direction: Calm Control Room

- Light operational workspace is the default; deep graphite context header.
- Night Ops is a supported theme, not the identity.
- Decision/Expert mode and Light/Night theme are **independent** settings.
- Expert Mode keeps the compact terminal character and JetBrains Mono.
- Semantic colour is for risk and status — not decoration.

**Banned:** glassmorphism, neon glow, gradient text, particle effects, endless
equal card grids, nested cards, marketing "magic" cards. Group with alignment,
spacing, bands and dividers **before** reaching for a container.

---

## 3. Information architecture

Five top-level views (Methodology lives under Admin/Settings, authorized roles
only):

`Today` · `Portfolio` · `Companies` · `Scenarios` · `Data Health`

Persistent mode switch: **Decision** (default, progressive disclosure) ·
**Expert** (full matrix, shortcuts, dense filters, layouts, pop-outs).

### URL contract

```text
/budgeting/terminal?view=today
/budgeting/terminal?view=portfolio
/budgeting/terminal?view=company&company=AZSF
/budgeting/terminal?view=scenarios
/budgeting/terminal?view=data-health
/budgeting/terminal?view=expert
```

Existing params stay supported: `company`, `indicator`, `period`, `from`,
`alertId`. View, scope, period, company, selected risk and KPI are shareable;
refresh restores the same context.

---

## 4. Shell

**Context header (56px).** Left: `Risk Center` label, hierarchy breadcrumb,
scope switcher (holding / subgroup / company). Center: period, `Data through`,
material Coverage, reconciliation/lock state. Right: search + command palette
(`Cmd/Ctrl+K`), Decision/Expert, theme, help, user menu.

**Section nav (40px).** Five views, active view clearly identified, **one**
contextual primary action, at most two visible secondary actions; the rest under
`More` or the palette.

**Command model.** Search by company name/code, KPI natural-language name/code,
risk event, action or destination. Legacy command verbs keep working in Expert —
an accelerator, not a prerequisite.

---

## 5. Today / Risk Inbox — the default destination

```text
┌ FO Holding · YTD May 2026 · data through 31 May · coverage 82% ┐
├ Today | Portfolio | Companies | Scenarios | Data Health         ┤
├ 4 critical · 6 new · 3 overdue · 11 data issues                ┤
│ Risk Inbox, 64%                    │ Selected risk, 36%          │
└────────────────────────────────────┴─────────────────────────────┘
```

**Summary strip:** one flat filter strip (Critical · New · Overdue · Data
issues) — **not** four hero cards. Each filters the Inbox and shows count +
trend vs the prior comparable period.

**Sections:** Needs decision today · New since last visit · Data quality
blockers · Watching · Recently resolved (collapsed).
**Sorting:** materiality, severity, due date, company, confidence, newest.

**Row (64–72px desktop; taller on mobile) must carry:** severity shape + text,
company, human headline, material impact, change/distance to threshold,
Confidence, `Data through`, owner + SLA, lifecycle state.

> AZSF: EBITDA margin is 4.2 pp below the approved threshold.
> High impact, Confidence 88%, data through May 2026, owner not assigned.

`IND_EBITDA_MARGIN` is secondary metadata in Decision Mode.

**Row actions** (keyboard-reachable, visible on selection): Assign owner ·
Acknowledge · Open analysis · Run scenario · Add comment · Resolve (only when
evidence requirements are met).

**Inspector** — persistent right panel, **never a modal**. Order: why it
surfaced → value/threshold/delta → Risk and Confidence *separately* → trend →
period/Data through/Coverage/reconciliation → provenance → recommended response
(labelled rule-based **or** AI-generated) → owner/due/state → comments →
`Open company workspace` / `Open in Expert Matrix`.

**Lifecycle:** `New → Acknowledged → Assigned → In progress → Resolved →
Reopened`. Acknowledge ≠ Resolve. Resolve requires reason + evidence. Every
transition writes an AuditEvent. Undo for reversible transitions. Duplicates for
the same driver/company/period group into one event. **Stale/proxy signals
create data or watch events — never confirmed financial breaches.**

---

## 6. Portfolio

Companies × 6–8 **domains** (Financial, Liquidity, FX, Operations,
Counterparty, Compliance, External, Data Quality) — **not** 110 KPI columns.

Domain cell carries: risk state + shape, trend, Confidence/Coverage, count of
material events, stale/provisional marker.

> Risk 77, Confidence 42%, Provisional

A bare `R77` is not acceptable. Single selection → contributing risks in the
inspector; `Enter` → Company Workspace. **Unknown is visible by default** and
filterable, never silently hidden.

---

## 7. Company Workspace

**Header:** name + hierarchy, Risk Index, Confidence + material Coverage,
`Data through`, reconciliation/lock, largest material change, risk owner.

**Tabs:** Summary · Drivers · Financials · Risks & Actions · Scenarios ·
Evidence. Company and period stay stable across tabs.

- **Summary** — one horizontal status band, trend timeline, ranked drivers, next
  actions, concise data-quality note. **No equal KPI-card grid.**
- **Drivers** — contribution waterfall/ranked list with contribution, change vs
  comparable period, Confidence, KPI detail link.
- **Financials** — P&L/BS/CF consume the **same** `PeriodContext` and canonical
  snapshot as KPIs. Switching statement never resets scope or period.
- **Evidence** — lineage timeline:
  `Workbook → Import batch → Source row → Statement snapshot → KPI
  definition/version → Calculation run → Observation → Risk event`.

---

## 8. KPI Detail

Side inspector from Today/Portfolio/Expert; optional nested full state in
Company Workspace. Order: localized name → value/unit/status → Risk, Confidence,
Coverage → period, `Data through`, As-of → threshold + distance → trend →
plain-language formula → inputs + aggregation semantics → source/provenance →
benchmark/cohort → version history → actions/ownership.

Reuse the strong existing `IndicatorDetail` / `indicator-detail/*` modules
progressively — do not rewrite them.

---

## 9. Scenario Lab

A workspace, not a modal. Left: baseline + assumptions. Center: financial and
operational impact. Right: Risk/Confidence delta + actions.

Always visible: baseline period and revision, `Data through`, assumption source,
changed variables, affected companies, before/after, Confidence, owner,
saved/unsaved. Closing unsaved warns. Recompute shows deterministic progress
(`Recalculating 23 of 180 indicators`).

---

## 10. Data Health

A finance-controller work queue — **not** a technical admin dashboard.

Distinct states, never collapsed into one: `missing` · `stale` ·
`unreconciled` · `partial period` · `source drift` · `formula failure` ·
`permission issue`.

Issue row: item, affected decisions/KPIs, severity, last successful load, owner,
recommended remediation, `Open source` / `Upload data` / `Recompute` as
permitted.

---

## 11. States (every component)

default · hover · focus-visible · active/selected · disabled **with
explanation** · loading · error · success.

- **Loading** — skeleton matches final structure; header/nav stay available;
  lists stream; recompute shows processed/total. Never one page-wide spinner.
- **Empty** — differentiate: no new material risks (healthy) · data not loaded ·
  no filter matches · no accessible companies · not applicable. Each has one
  clear next action. **No dead ends.**
- **Error** — never raw `Unauthorized`, stack traces or opaque codes as primary
  copy:

  > Risks could not be refreshed. The last saved data through 14 June, 10:32 is
  > shown. Retry, or open Data Health.

  Technical detail goes in a collapsible `For support` with a copyable request ID.
- **Stale / provisional** — last value only with explicit treatment, never
  decision-grade colour; show reason and last valid As-of; disable actions
  needing confirmed data **and explain why**.

---

## 12. Visual system

Tokens are the implementation target from spec §15 — **final colours require
contrast verification before freeze** (open question E-2).

Light default: canvas `oklch(97% 0.008 165)`, surfaces 99/94/90%, border
`oklch(86% 0.012 165)`, text `oklch(23% 0.018 190)`, nav `oklch(21% 0.022 190)`,
accent `oklch(56% 0.110 170)`, focus `oklch(63% 0.140 225)`.
Night Ops: canvas `oklch(17% 0.012 190)` → surfaces 20/24/28%, text
`oklch(92% 0.010 170)`, accent `oklch(70% 0.090 170)`. Dark depth comes from
surface lightness — not shadows or glow.

**Risk encoding — shape + text always, colour never alone:**

| State | Shape | Text | Rule |
|---|---|---|---|
| Critical | square | Critical | confirmed material breach |
| Warning | triangle | Attention | confirmed approaching/medium breach |
| Stable | circle | Stable | **decision-grade evidence only** |
| Unknown | dash | Insufficient data | missing required evidence |
| Provisional | diamond | Provisional | result exists, assurance gate fails |

Confidence uses neutral/accent styling — **never** risk colours:
`Confidence 82%, 27 of 33 material KPIs`. Provenance written in full in Decision
Mode: Reported · Calculated · External · Modeled.

**Type:** system stack (or Inter) for UI; JetBrains Mono for numeric/data;
tabular numerals. Desktop body 14/20 · mobile 16/24 · section 18/24 · page
24/30 · labels 12/16 · Expert minimum 11/14. **No 8–9px customer-facing text.**

**Spacing** `4 · 8 · 12 · 16 · 24 · 32 · 48`. Radius: control 6 · surface 8 ·
overlay 12. Targets: desktop ≥40×40, mobile ≥44×44. Shadows only for true
elevation.

**Motion:** instant 100ms · state 180ms · panel 240ms; exit ~25% faster; ease-out
`cubic-bezier(0.25, 1, 0.5, 1)`. Inspector uses opacity + ≤4px transform. Updated
values may use one 450–600ms soft flash. No bounce, no elastic, no permanent
decorative animation, never animate layout properties. `prefers-reduced-motion`
removes spatial movement while preserving feedback.

---

## 13. Copy

Precise · calm · human · non-dramatic. No jokes in error states. No unexplained
jargon.

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

---

## 14. i18n — EN / RU / AZ

No hardcoded customer-facing strings. One glossary for Risk, Confidence,
Coverage, As-of, Data through, Reconciliation. Identifiers are not translated —
labels are. `Intl` for dates/currency/numbers. Full sentences as complete
messages (never concatenated relative-time). ICU plurals. Allow ≥30% expansion.
Pseudo-locale testing. **Never mix EN/RU/AZ in one user block.** Keys live under
the `terminal.v2` namespace in all three bundles.

---

## 15. Responsive

- **≥1440px** — Today 64/36 list/inspector, persistent inspector, full nav,
  Expert 2×2.
- **1024–1439** — 58/42, collapsible secondary nav, secondary actions under
  `More`, inspector collapsible.
- **768–1023** — one primary column, inspector as side sheet, Company tabs
  scroll horizontally, Expert constrained/read-only path.
- **<768** — Today, Portfolio brief, Company Summary, Risks & Actions, Data
  Health; bottom nav (5); sticky primary action; state survives backgrounding;
  **Expert Matrix is not squeezed into the viewport** — show
  `Open Expert Mode on desktop`, not a generic warning banner.

---

## 16. Accessibility — WCAG 2.2 AA

Text ≥4.5:1 · controls/meaningful graphics ≥3:1 · visible 2px focus ring with
offset · colour always duplicated by shape and text · skip links + correct
heading hierarchy · proper tablist/tab/tabpanel · arrow/J/K in Inbox · Enter
opens inspector · Escape closes overlay and restores trigger focus · charts have
textual summary + data table · live regions only for progress/error/completion ·
virtualized matrix exposes row/column counts · VoiceOver + NVDA manual passes ·
200% zoom/reflow · hover is never the only path · `prefers-reduced-motion` ·
reversible actions expose Undo.

---

## 17. Acceptance

| Task | Target |
|---|---:|
| Find the largest decision-grade risk | ≤30s |
| Identify Risk, Confidence and As-of | ≤15s, no tooltip |
| Assign owner and due date | ≤60s |
| Open formula and source | ≤45s |
| Compare two periods | ≤60s |
| Run a simple scenario | ≤2min |
| Find cause of a data gap | ≤45s |
| Trace to original row | ≤60s |
| Mobile acknowledge/assign | ≤90s |

Global gates: ≥90% task success (trained), ≥80% (first-time), ≥85% first-click,
<3% error actions, SUS ≥80, SEQ ≥5.5/7, zero critical WCAG violations, no raw
technical error as primary copy, no dead-end empty states, and **no case where
Unknown or Stale reads as Stable/Green**.

---

## 18. Expert Mode — preserved

The 2×2 PanelGrid stays: Company Tree · full KPI HeatMap · KPI Detail ·
variance/analysis. Controlled improvements come **after** the modern shell is
stable: semantic Light/Night tokens, keep F1–F4/pop-outs/saved layouts, combine
search and filter where possible, rare toggles to `View options`, never show
Period Chips and Time Machine simultaneously, row density 28–32 (compact 20–24),
minimum 11px, separate Risk and Confidence, keep Unknown visible, virtualize,
support arrows/Home/End/PageUp/Down, provide an accessible semantic table
alternative.
