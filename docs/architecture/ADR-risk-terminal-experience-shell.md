# ADR: Risk Terminal 2.0 Experience Shell

- **Status:** Accepted (contract only — no implementation yet)
- **Date:** 2026-07-15
- **Phase:** 10, Stage A (PR 1, documentation/ADR only)
- **Sources:** `docs/risk-terminal-2.0/02-PRODUCT-AND-UI-UX-SPEC.md`,
  `04-TECHNICAL-IMPLEMENTATION-PLAN.md` §3–§5, §9–§10, §13
- **Pairs with:** `ADR-risk-terminal-trust-core.md`
- **Supersedes:** nothing. **Superseded by:** nothing.

## Context

The current route stacks `TerminalDeepLinkHandler`,
`TerminalLockedPeriodBanner`, `HotkeyToolbar`, `CommandBar`, `SignalsStrip` and
`PanelGrid`, applies JetBrains Mono and a dark background to the whole route,
and makes `PanelGrid` the owner of far more than a layout: global overlay and
export mounts, keyboard shortcuts, compact/watchlist hydration and the persisted
resizable layouts all live there.

Three couplings block any modern default view:

1. **Alerts depend on HeatMap** — alert matches are evaluated and published in
   HeatMap logic, so unmounting Expert leaves consumers with `null` alerts.
2. **Overlays depend on PanelGrid** — Audit, Alerts, Scenarios, What-if, Help,
   Compare, Peer, Exports, Comments, Chat, Subscriptions, Intel and Breach
   Forecast are all mounted inside it.
3. **Today auto-runs AI** — `TodayBrief` can trigger a variance explanation on
   mount, which is a paid call on screen entry.

The audit's own scoring is UI 6/10, UX 5/10, data trust 4.5/10, confusion
8.5/10. The dense matrix is not the failure — it is a genuine strength for
analysts. It is the wrong *first* screen for a CFO with 10 minutes.

## Decision

Adopt the shell in `04-TECHNICAL-IMPLEMENTATION-PLAN.md` §4 via a strangler
migration, with these binding consequences.

### 1. Expert Mode is preserved, not replaced

The 2×2 PanelGrid (Company Tree · HeatMap · KPI Detail · variance) stays, keeps
F1–F4, pop-outs, saved layouts and its dense character, and remains one click
and one URL parameter (`?view=expert`) away. It becomes a **mode**, not the only
entry. These persisted layout keys stay compatible:

```text
terminal-layout-v1-outer · terminal-layout-v1-top · terminal-layout-v1-bottom
```

### 2. Extraction precedes construction, in a fixed order

1. Extract **pure** view-model builders (`build-risk-inbox`,
   `build-company-summary`, `build-portfolio-domains`) out of `TodayBrief`,
   `ActionCenterPanel`, `CompanySnapshot` and `use-heat-map-model`, and make the
   current components consume them **with identical output**.
2. Extract `TerminalOverlayHost`, always mounted by the route, preserving every
   `CustomEvent` name.
3. Centralize alert/freshness data in a provider or server overview **before**
   Expert can be unmounted.
4. Wrap the existing four components in `ExpertWorkspace`, behaviour-identical.
5. Only then add the modern shell behind a flag.

Steps 1–4 are zero-visual-change and are validated by the visual baseline gate.

### 3. The store is not replaced during the shell migration

`terminalStore` (hand-rolled reactive singleton) keeps its invariants. New
Inbox/Portfolio interactions call existing actions — `selectCompany`,
`setActiveIndicatorValue`, `setPendingMissingCell`, `setPendingRollupCell` —
rather than writing partial state. A store migration is a separate decision.

### 4. No financial or KPI logic in React components

View models are pure functions over certified contracts. The shell renders
Risk, Confidence, Coverage, `Data through` and reconciliation state; it never
derives them. This is the UI half of the Trust Core ADR's single-path rule.

### 5. Flags resolve on the server

```text
RISK_TERMINAL_V2_ENABLED=false
RISK_TERMINAL_V2_ORG_ALLOWLIST=
RISK_TERMINAL_V2_DEFAULT_VIEW=expert
RISK_TERMINAL_V2_AI_AUTORUN=false
```

Operational rollout flags — not commercial entitlements. Resolved server-side
and passed to the client as initial state; no client-only env read that diverges
between SSR and hydration.

**An empty `RISK_TERMINAL_V2_ORG_ALLOWLIST` means V2 is off for every
organization** — never "no filter, therefore everyone". Empty is the valid safe
default state, and the resolver carries a test asserting exactly that. (Owner
decision, 2026-07-16 — E-1.)

### 6. URL is the view state

```text
today | portfolio | company | scenarios | data-health | expert
```

`view` is read/written while preserving `company`, `indicator`, `period`, `from`
and `alertId`. Every view/scope/period/risk/KPI selection is shareable and a
refresh restores the same context.

### 7. No automatic AI on entry

The modern default never triggers a paid or slow AI call before an explicit user
action. A regression test asserts this, because the current `TodayBrief`
behaviour proves a comment is not enough.

### 8. Visual direction: Calm Control Room

Light operational default with a deep graphite context header; Night Ops as a
supported theme, not the identity; Decision/Expert and Light/Night are
independent settings. JetBrains Mono is scoped to Expert and numeric surfaces —
not the whole modern route. No glassmorphism, neon, gradient text, particles or
endless equal card grids. Grouping via alignment, spacing, bands and dividers
before containers.

Information hierarchy: **material risk → Confidence/Coverage → As-of →
evidence → action.**

### 9. Colour is never the only carrier of status

Every state carries shape **and** text: Critical (square) · Warning (triangle) ·
Stable (circle) · Unknown (dash, "Insufficient data") · Provisional (diamond).
`R77` alone is not acceptable output; `High risk, Confidence 42%` is. Unknown is
visible by default and filterable — never silently hidden.

### 10. Accessibility and i18n are acceptance criteria, not polish

WCAG 2.2 AA: 4.5:1 text, 3:1 controls, 2px focus ring with offset, full keyboard
flow, Escape restores trigger focus, charts carry a textual summary and data
table, virtualized grids expose row/column counts, `prefers-reduced-motion`
honoured. EN/RU/AZ under a `terminal.v2` namespace, ICU plurals, `Intl` for
dates/currency/numbers, ≥30% text expansion, no EN/RU/AZ mixing in one block —
a defect this product has shipped before.

## Consequences

**Accepted cost.** More files and one indirection layer (provider + view models)
before any visible gain; PRs 2–4 deliver *zero* user-visible change by design
and must still pass the visual gate; Expert and modern shell coexist through at
least one close cycle and two stable releases.

**Rejected alternative — redesign the root route directly.** Rejected: with
alerts inside HeatMap and overlays inside PanelGrid, unmounting Expert silently
breaks alerting. The handoff forbids the modern root UI before Stage A review.

**Rejected alternative — replace `terminalStore` while migrating the shell.**
Rejected: two risky migrations at once, with no rollback story for either.

**Rollback.** Flags default off; Expert stays the default view; the legacy path
is untouched. Cutover is a flag flip for an allowlist, reversible without a
deploy.

## Open questions (owner decisions)

| # | Question | Owner | Blocks |
|---|---|---|---|
| E-1 | Pilot org allowlist for `RISK_TERMINAL_V2_ENABLED` | Product owner | PR 5+ rollout. **Semantics decided 2026-07-16:** empty allowlist is a valid safe state and means V2 off for every organization (§5). The pilot org list itself stays open and is not needed until there is a shell to enable. |
| E-2 | Final colour tokens after contrast verification (spec §15 is a target, not verified) | Design + a11y | Token freeze |
| E-3 | Is `Risk Center` the confirmed product label in the header? | Product owner | Header copy / i18n keys |
