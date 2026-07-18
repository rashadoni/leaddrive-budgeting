# Risk Terminal 2.0 — implementation status

Living execution record for Phase 10. Updated after every slice.
Status vocabulary is the handoff's (§3.1): `implemented`, `tested`,
`visually verified`, `reconciled`, `methodology-approved`, `shadow-only`,
`provisional`, `not tested`, `blocked`.

**A task is never `completed` because code compiles.** If a check named below
was not actually run in the turn that claims it, the status is `not tested`.

---

## 1. Protected paths (release checkpoint 2026-07-16)

These are the user's own dirty/untracked files. **Do not stage, edit, revert or
stash them.** The Risk Terminal documentation files previously listed here are
now deliberately part of the owner-authorized release candidate; the remaining
protected paths are:

```text
 M .claude/settings.json
?? output/                                   # unrelated artifact: logo vector PDF.
                                             # Owner-confirmed 2026-07-16 — never
                                             # stage into a Risk Terminal commit.
?? scripts/check-sales-parse-local.ts        # local FO-workbook harnesses
?? scripts/import-fo-workbook-local.ts
?? scripts/recompute-local-all.ts
```

`git status` is authoritative and drifts — re-check before every commit
(handoff §3.2). Stage only explicit paths; never `git add .` / `-A`.

---

## 2. Open decisions blocking scope

### D-1 — Slice granularity: resolution history and current boundary

The operator prompt asks to "полностью реализовать Risk Terminal 2.0 … Stages
A-E" autonomously. The handoff this repo ships says the opposite, twice:

- §10: "`<APPROVED_STAGE_OR_PR_SLICE>` is an intentional owner-controlled
  input. Replace it with exactly one approved slice from sections 11–13 …
  **never ask Claude Code to implement all three at once**."
- §2.8: "Stop if the requested slice would require a materially broader change
  than the documentation authorizes."
- §5 Stage A: "Do not start the modern root UI before this stage has review."

The handoff also gates each stage on human review and on owner decisions
(KPI methodology, tolerances, allowlist) that no agent may invent (§9).

**Resolution history:** the first implementation pass correctly stopped at one
Stage A slice. The owner subsequently authorized continued implementation and
A1-A3 were owner-reviewed on 2026-07-16. Additive, reversible trust-core slices
B2, the pure portion of B3 and B5 infrastructure were then implemented and
tested. This does **not** waive the remaining human gates: A4-A6 are not
owner-reviewed; B1 still needs T-1; B4 still needs T-5; no V2 view is enabled;
Stages C-E have not started. The current queue below is authoritative.

### D-2 — KPI methodology (expected, per handoff §9)

Not yet enumerated; will be filled from `03-DATA-KPI-TRUST-SPEC.md` while
building the KPI Registry (Stage B). Any KPI without an approved definition ships
as `provisional` with a recorded question — never with an invented formula.

---

## 3. Phase 10 queue (dependency-ordered, from handoff §5)

Derived strictly from Stages A-E. No invented scope.

### Stage A — documentation/ADR + protective mode (implemented; review partial)
| # | Task | Status |
|---|---|---|
| A1 | Add Phase 10 section to `docs/ROADMAP.md` (only items actually started) | implemented — owner-reviewed 2026-07-16 |
| A2 | `DESIGN.md` from the approved UI/UX spec | implemented — owner-reviewed 2026-07-16, gaps recorded in §5 |
| A3 | ADRs: Trust Core, Experience Shell | implemented — owner-reviewed 2026-07-16, T-7 corrected, gaps recorded in §5 |
| A4 | Server-resolved operational feature flags (design + resolver) | implemented + tested (unit), not reviewed |
| A5 | Minimal Legacy/Provisional presentation — stale/untraced values must not read decision-grade; **no financial value changes** | implemented + tested + visually verified, not reviewed — surface badge only; per-cell demotion is an owner decision (§7) |
| A6 | Focused tests proving stale/untraced cannot look decision-grade | implemented + tested (27 unit tests), not reviewed |

*Gate state: A1-A3 are owner-reviewed. A4-A6 are implemented/tested but still
await human review. No modern root UI or V2 enablement may proceed through that
open gate.*

### Stage B — trust core (additive slices in progress; financial cutover blocked)

- **B1 canonical statement mart/service:** blocked on owner decision T-1 and
  golden reconciliation controls.
- **B2 PeriodContext + DataRevision:** contracts, persistence, tenant-scoped
  canonical writer and UPDATE immutability are implemented and tested. A
  2026-07-18 technical review found DB-level retention/lifecycle/supersession
  and systemic RLS-bypass gaps (§21). The narrow migration candidate passed an
  isolated PostgreSQL 16 live gate but remains unapplied to every persistent,
  shared and production database (§22); B2 remains open and not owner-reviewed.
- **B3 exact M/Q/YTD/FY/LTM invalidation:** pure fan-out implemented and tested;
  runtime wiring remains blocked until the canonical mart/period mutation path
  can supply the exact changed month and downstream dependency set.
- **B4 KPI Registry + first 25-35 approved KPIs:** blocked on owner decision T-5.
- **B5 immutable observation + lineage:** storage, guards and import revision
  writers implemented and tested. Generic recompute must remain untraced until
  it can prove which indicators depend on the applied artifact; one workbook
  revision must never be stamped onto weather, commodity, booking or mixed-source
  observations merely because they recomputed in the same run.
- **B6 Risk × Confidence + abstention / B7 decision-grade event eligibility:**
  queued; neither is implemented.

*Every financial surface still needs golden reconciliation and the named owner
decisions before it can be described as decision-grade.*

### Stage C — zero-visual-change UI extraction (shell seam partial; certified view models remain blocked on B contracts)
C1 pure view-model builders ⬜ blocked · C2 `TerminalOverlayHost` ✅ production-verified ·
C3 `ExpertWorkspace` isolation ✅ production-verified · C4 event/shortcut/layout
compatibility 🟡 partial · C5 overview façade/provider ⬜ blocked. The legacy Expert
mobile P1 guard is ✅ production-verified: below 768 px the four-panel route tree
is not mounted and an EN/RU/AZ desktop recommendation is shown; the independent
overlay host remains available, while its company/matrix data stays cold until
an overlay opens. On
supported widths Expert remains mounted because alerts still originate in HeatMap.
No Decision shell or V2 view is enabled.

### Stage D — modern Decision shell (blocked on C provider contract)
D1 server-resolved view flags · D2 URL view state · D3 shell/header/nav ·
D4 Today/Inbox + Inspector · D5 Portfolio domains · D6 Company Workspace/KPI detail ·
D7 Data Health + Scenario Lab · D8 responsive + a11y + EN/RU/AZ.

### Stage E — shadow + cutover (blocked on D)
E1 old/new on the same revision · E2 classify every material difference ·
E3 silent V2 alerts · E4 perf/visual/a11y gates · E5 UAT + one real close cycle ·
E6 rollback rehearsal · E7 Today default for the approved allowlist only.

---

## 4. Slice log

_(one entry per slice: outcome, files, evidence, limits, commit SHA, next)_

### Slice A-PR1 — documentation and ADRs (2026-07-15)

**Status: `implemented` — awaiting review. NOT `tested` in any runtime sense,
because this slice has no runtime surface to test.**

1. **What was implemented.** The PR-1 deliverable from plan §8 / handoff §11:
   Phase 10 roadmap section, `DESIGN.md`, two ADRs, this status file. Zero
   runtime change — no code, no flags, no schema, no UI.
2. **Requirements closed.** A1, A2, A3 (drafted). Handoff §11 items 1-3.
3. **Files changed.**
   - `DESIGN.md` (new)
   - `docs/architecture/ADR-risk-terminal-trust-core.md` (new)
   - `docs/architecture/ADR-risk-terminal-experience-shell.md` (new)
   - `docs/ROADMAP.md` (Phase 10 section + dated changelog entry)
   - `docs/risk-terminal-2.0/IMPLEMENTATION-STATUS.md` (this file)
   - No migrations, no translation files, no snapshots.
4. **Verification commands run this turn.** `npx tsc --noEmit` → exit 0;
   `npx vitest run --reporter=dot` → 501 files / 6,384 passed, 19 skipped, 0
   failed. Both are regression evidence only: they prove the docs broke nothing.
   They prove nothing *about* the docs.
5. **Runtime scenario.** None — nothing to exercise. No E2E, no visual gate run:
   no file in this slice can affect layout (`PanelGrid`/`CompanyTree`/`HeatMap`/
   terminal CSS/`globals.css`/Tailwind all untouched), so the gate does not apply.
6. **Financial reconciliation.** Not applicable — no formula, aggregation,
   period or KPI logic changed. The ADR *records* the conventions; it does not
   yet enforce them.
7. **Visual verification.** Not applicable.
8. **What is NOT verified.**
   - The ADRs and DESIGN.md had **no human review** at the time of this slice —
     that review is the Stage A gate (handoff §5). *Closed 2026-07-16: see §5.*
   - Reading coverage was partial: `CLAUDE-CODE-HANDOFF.md`, `AGENTS.md`,
     `PRODUCT.md`, `00-EXECUTIVE-SUMMARY-RU.md`,
     `02-PRODUCT-AND-UI-UX-SPEC.md`, `03-DATA-KPI-TRUST-SPEC.md` and
     `04-TECHNICAL-IMPLEMENTATION-PLAN.md` were read in full. **Not read at the
     time:** `01-AUDIT-BASELINE.md`, `05-TEST-UAT-ROLLOUT.md`, `README.md` and
     `docs/ROADMAP.md` (only its structure and Phase 9 conventions).
     Handoff §2 asks for all of them before editing; this was a real deviation and
     is recorded rather than glossed. *Closed 2026-07-16 — and the deviation had a
     concrete cost: the unread roadmap changelog contained the direct refutation
     of this slice's T-7 claim. See §5.*
9. **Limitations.** Contracts only. Nothing prevents a stale value from looking
   decision-grade yet — that is A5, and it is the first slice with a runtime
   surface.
10. **Commit SHA.** `2b28c2af` — `docs(terminal): define Risk Terminal 2.0
    contracts`, 2026-07-15 23:28 (+0400). Path-scoped, 5 files, +915/−0, no
    protected file staged. The correction slice below is `A-PR1b`.
11. **Next task.** **A4** — server-resolved feature flags (design + resolver, no
    UI switch). Not started; owner has not authorized it as of 2026-07-16.

---

## 5. Owner Review of A1–A3 (2026-07-16)

**Outcome: Stage A gate passed for A1–A3 with one correction and a recorded gap
list.** The full package plus `docs/ROADMAP.md` were read in full, and each
artifact was cross-checked against its source. Zero runtime change in the review
or in the correction slice.

### 5.1 The correction — T-7

The T-7 row asserted that EDEN divides by 22 595 ha and returns −131.8 ₼/ha.
Read-only verification refuted both halves: the resolver reads only
`Company.settings.hectaresPlanted`, EDEN's value is **4 000** (the basis the
thresholds were calibrated on, and the value persisted in the calculation
inputs), 22 595 is the leased-land registry in `settings.landParcels` — a field
no code path reads — and no observation anywhere in the database is near −131.8.
The figure exists in one commit and in no code, data or log.

The row and its footnote are rewritten in `ADR-risk-terminal-trust-core.md`; the
claim is recorded as withdrawn. **The T-7 question itself stays open** — registry
vs planted area is a real CFO/Ops choice — but it is not live in the form first
described.

Verification also surfaced what *is* live in those KPIs: a quarterly-calibrated
threshold applied to annual-only observations, and an internally inconsistent
2026 input bundle (EBITDA from summed `pl_ebitda` facts vs revenue/net income
from the budgetLine path; EBITDA and net income differ by 15.3M with
`da_total = 0`). Both are recorded in the ADR's T-7 note.

**Interim posture, owner-approved:** the three EDEN per-ha KPIs stay
`provisional`, excluded from the decision-grade surface, confirmed alerts, the
composite score and the T-5 pilot set until financial reconciliation closes.
Formulas, thresholds, weights and source data unchanged. No production change.

### 5.2 Owner decisions as of 2026-07-16

| # | State | A4 | A5 / Stage B |
|---|---|---|---|
| E-1 | **Semantics decided** — empty allowlist = V2 off for every org; pilot list still open | unblocked | — |
| T-7 | **Interim posture decided** (provisional + excluded); methodology choice open | non-blocking | blocks B4 |
| T-1 · T-2 · T-3 · T-4 · T-5 · T-6 | deferred, non-blocking for A4 | non-blocking | block B1/B4/B6 |
| E-2 · E-3 | deferred, non-blocking for A4 | non-blocking | block Stage D |

Deferral is authorized by the documentation, not by convenience: both ADRs head
their tables "owner decisions — block **enforcement**, not this ADR", every
`Blocks` entry names a Stage B or Stage D surface, and handoff §5 lists Stage A
item 3 (server-resolved flags) with no owner-decision dependency. A4 touches no
financial logic, no colour token and no header copy.

### 5.3 Gaps found and left open (not defects in A1–A3 — recorded scope)

- **DESIGN.md** omits spec §15.1's `--risk-*` colour tokens, spec §12
  (Methodology Center), `--ease-in`, and spec §14.5 (feedback/focus).
- **Trust Core ADR** omits spec §11 (alert/risk-event rules) and 7 of the 9 KPI
  corrections in spec §8 — EBITDA (a P0 in the audit) has no ADR home and no
  decision number.
- **Neither ADR** carries spec §12's `TerminalOverviewResponse` contract, though
  plan §4.1 names the façade files.
- **05 §2.3 and §2.4** — repair the TodayBrief visual masking, and stop E2E from
  assuming a table at the terminal root — are named prerequisites in the NO-GO
  list and appear in no ADR and no Phase 10 task.
- **A5 scope caveat:** A5 covers `stale/untraced`. The EDEN per-ha observations
  are fresh and traceable, and are withheld for unapproved methodology. A5 will
  not catch them unless its rule is widened.
- **Unverified numbers elsewhere:** `IndicatorDefinition.weight` (1.5→0.7,
  shipped 2026-05-24) is live and unapproved — it is T-4's subject matter.

### 5.4 Slice A-PR1b — T-7 correction and owner decisions (2026-07-16)

**Status: `implemented`. No runtime surface; no tests apply.**

- **Files.** `docs/architecture/ADR-risk-terminal-trust-core.md` (T-7 row +
  verification note), `docs/architecture/ADR-risk-terminal-experience-shell.md`
  (E-1 row + §5 empty-allowlist rule), this file.
- **Not changed.** No formula, threshold, weight, seed, resolver or source datum.
  No schema, migration, flag, translation or snapshot. No production action. The
  `docs/ROADMAP.md` T-7 wording at line 600 still carries the withdrawn figure
  and is **not** corrected in this slice — the owner scoped it to the ADRs and
  this file.
- **Evidence.** Read-only SQL against the local dev database and `git log -S`
  over full history. Prod was not inspected: the original claim said "on prod",
  and prod inspection was not authorized.
- **Limits.** The refutation rests on the local dev database plus repository
  history. If prod's `hectaresPlanted` for EDEN differs from 4 000, the T-7 note
  needs revisiting — but no audit event records any change to that field, and the
  recompute that produced the current values ran 13 hours before the ADR was
  committed.

---

## 6. Slice A-PR2 — server-resolved rollout flags, A4 (2026-07-16)

**Status: `implemented` + `tested` (unit). Not reviewed. Not wired: the resolver
has no caller by design, so there is nothing to verify at runtime yet.**

### Outcome

- **Behavior changed for users: none.** The resolver is unreferenced — a pure
  module plus its tests. `TerminalPage` is untouched, there is no view switch,
  and no request resolves differently than it did yesterday.
- **Who benefits:** the operator/product owner, later. This is the mechanism the
  rollout (05 §12) and the emergency rollback (05 §13) both depend on. It exists
  now so that Stage D wires a reviewed contract instead of inventing one under
  cutover pressure.
- **Behind a flag:** it *is* the flag. Ships in the fully-disabled state.
- **Stage:** Stage A protective work. `provisional` in the sense that nothing
  consumes it; the contract itself is complete for its defined scope.

### Requirements closed

A4 (handoff §5 Stage A item 3 · plan §9 · ADR Experience Shell §5), including the
`terminal-experience-flag.test.ts` suite mandated by 05 §6 and that section's
behavioral requirement "feature flags resolve consistently in server and client
render". A5 and A6 remain **not started** — deliberately not begun in this slice.

### Files

- `src/features/terminal/lib/terminal-experience-flag.ts` (new, resolver)
- `src/features/terminal/lib/terminal-experience-flag.test.ts` (new, 50 tests)
- `.env.example`, `.env.production.example` (new documented vars, all default-off)
- `docs/DEPLOYMENT_READINESS.md` (4 rows in the env matrix)
- `docs/ROADMAP.md` (10.A4 status + dated changelog entry)
- this file
- **No migrations. No translation files. No snapshots. No schema. No UI.**

### Design

`resolveTerminalExperienceFlags(organizationId)` → `{v2Enabled, defaultView,
aiAutorun}`.

- **E-1 enforced literally.** V2 requires `RISK_TERMINAL_V2_ENABLED=true` **and**
  exact, case-sensitive membership in `RISK_TERMINAL_V2_ORG_ALLOWLIST`. An empty
  allowlist is a valid *disabled* state enabling **nobody**; `*` is not a
  wildcard. The failure this prevents is an unreviewed holding-wide cutover from
  a single env edit.
- **Everything fails closed.** Only the literal `true` enables — `1`, `yes`, `on`
  and junk are false. Unknown `DEFAULT_VIEW` → `expert`, the legacy view and
  rollback target. A disabled org always gets `expert`, whatever is configured.
- **`aiAutorun` is subordinate to `v2Enabled`**, so a non-piloted org can never
  be told paid AI may run on entry (05 §2.2, risk `AI prewarm spends money`).
- **SSR/hydration divergence** (plan risk `medium/high`) is addressed
  structurally, not by convention: env is read only inside the resolver, which is
  server-only by contract; the returned DTO is JSON primitives only and carries
  the *decision*, never the allowlist roster; the client receives it as props.
- **Env read per call**, per `src/lib/queue/feature-flag.ts`. A module-level
  constant would freeze at import time and turn the documented rollback (flip the
  flag, restart) into a redeploy.
- **Located in `features/terminal/lib/`, not `lib/risk/`** — this is UI rollout
  policy; `lib/risk/` is certified financial logic and the boundary should stay
  legible.

### Evidence — commands actually run this turn

| Command | Result |
|---|---|
| `npx vitest run …/terminal-experience-flag.test.ts` | 50/50 passed |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run --reporter=dot` | exit 0 — 502 files, 6,434 passed, 19 skipped, 0 failed |
| `npx prisma validate` | schema valid |
| `npm run build` | exit 0 |

Test coverage: all-off default · empty/whitespace-only/comma-only allowlist ·
org absent (plus case-sensitivity and no prefix/substring match) · org present
(multi-entry, padding, duplicates, all six canonical views) · malformed env
(parameterized) · SSR/client contract (JSON round trip; wiping every flag var
after serialization cannot change hydrated state; per-call env read).

**One flake observed and chased down, not waved away.** The first full sweep
reported `1 failed` in a centering assertion shared by
`VarianceExplainerPanel.test.tsx` / `IndicatorDetail.empty-states.test.tsx`. Both
pass in isolation and the re-run sweep was clean at exit 0 — this is the
happy-dom/React batching flake `vitest.config.ts` documents (hence its
`retry: 2`). A pure module with no importers cannot affect a DOM centering
assertion. Recorded because the first run's output said `failed`.

### Runtime scenario

**None exercised — and none exists.** The module has no caller, so there is no
route, no state and no rendered surface to drive. No E2E and no visual gate: no
file in this slice can affect layout (`PanelGrid` / `CompanyTree` / `HeatMap` /
terminal CSS / `globals.css` / Tailwind all untouched), so 05 §8.1 does not
apply. The unit suite is the whole of the behavioral evidence.

### Financial reconciliation

**Not applicable.** No formula, aggregation, period, threshold, weight, KPI or
source datum was touched. No production action of any kind.

### Limits — what is NOT done

- **Not reviewed.** A1–A3 passed the Stage A gate on 2026-07-16; A4 has not.
- **Not wired.** No UI switch, no `?view=` handling, no provider, no consumer.
  That is D1 and it is gated on Stage A review.
- **Client-import protection is by contract, not by build.** *Deviation from the
  architect's plan, recorded rather than glossed:* the `server-only` package
  marker was not adopted. It is absent from this repo, so it would mean a new
  dependency plus a one-file convention — outside A4's scope, and the sibling
  `queue/feature-flag.ts` sets the docblock precedent. Consequence: a future
  `"use client"` module importing this resolver fails at hydration, not at build.
  Worth revisiting when D1 adds the first real consumer.
- **The SSR test proves the resolver's transport contract, not a component's
  compliance** with it — no component exists yet. D1 owes a render/hydration
  regression test.
- **`RISK_TERMINAL_V2_AI_AUTORUN=true` is permission state only.** It grants
  nothing here; no AI endpoint is called anywhere in this slice.
- **Owner decision E-1 remains half-open.** The *semantics* were decided
  (2026-07-16, §5.2); the actual pilot org list is not chosen. The allowlist
  ships empty — which, by the rule this slice enforces, means off.
- **Case-sensitive org IDs** make a typo fail closed (org stays on Expert), but
  operators must paste canonical DB IDs. Documented in the env matrix.

### Rollback

Delete two new files and revert four documentation edits; nothing else observes
them. Once wired (D1), rollback is 05 §13's configuration triple:
`RISK_TERMINAL_V2_ENABLED=false`, `RISK_TERMINAL_V2_DEFAULT_VIEW=expert`,
`RISK_TERMINAL_V2_AI_AUTORUN=false`, then restart through the normal process.
The resolver's per-call env read is what keeps that a restart rather than a
redeploy.

### Commit SHA

`feat(terminal): add server-resolved rollout flags` — path-scoped, 7 files,
+609/−2, no protected file staged (all 8 protected paths verified still dirty
and untouched after commit). The SHA itself is backfilled by the next slice:
this entry ships *inside* the commit it describes, so the hash cannot exist
while it is being written — the same reason A-PR1's `2b28c2af` was recorded by
A-PR1b.

### Next task

**A5** — the minimal Legacy/Provisional presentation, the first slice in Phase 10
with a runtime surface. **Not started in this slice, and not to be started
without owner authorization.** Note §5.3's caveat: freshness and approved
methodology are independent gates. EDEN's per-ha methodology remains an owner
decision; no DataRevision lineage should be inferred from that historical note.

---

## 7. Slice A-PR3 — Legacy/Provisional presentation, A5 + A6 (2026-07-16)

**Status: `implemented` + `tested` + `visually verified`. Not reviewed.
NOT `reconciled` and NOT `methodology-approved` — no financial control was
exercised, because no financial value changed.**

### Outcome

- **Behavior changed:** the Expert HeatMap header now carries a
  `⚠ LEGACY · NOT DECISION-GRADE` badge whenever a coloured cell on the surface
  is not decision-grade — today, every one of them. Cell colours, cell values
  and layout are otherwise untouched.
- **Who benefits:** anyone reading a green cell as certified. The surface no
  longer *implicitly* claims these numbers are decision-grade. The audit's
  headline finding was data trust 4.5/10; this withdraws the claim, it does not
  restate a number.
- **Behind a flag:** no. It is a protective label and is on for everyone —
  which is the point of Stage A. It has no dependency on the A4 flags.
- **Stage:** Stage A protective work; `provisional` posture by construction.

### The measurement that drove the design

Read-only SQL, local dev DB, 2026-07-16:

| Fact | Value |
|---|---:|
| `IndicatorValue` rows | 1,269 |
| rows with `lastReconciledAt` | **0** |
| coloured cells (green/amber/red) | 498 |
| coloured **and** never reconciled | **498 (100%)** |
| coloured **and** >30 days old | 294 (59%) |

`lastReconciledAt` is written only by `scripts/audit-company.cjs`, which has
never run over this data. So the ADR's rule — no lineage → no decision-grade
colour — applied per cell today demotes **the entire coloured matrix**. That is
a cutover, not the "smallest protective presentation" of handoff §11, and it
collides with §4 "keep the current Expert Matrix available" and with the risk
register's "simplification frustrates power users".

**Decision taken (safe, reversible, recorded):** state the posture **once at the
surface**; leave cells alone. With 0 lineage, one badge says exactly what 498
markers would say, and costs no legibility. **Per-cell demotion is an owner
decision, not a preference** — the evidence is the 0/1269.

### Files

- `src/lib/risk/decision-grade.ts` (new — the gate)
- `src/lib/risk/decision-grade.test.ts` (new — 27 tests, A6)
- `src/features/terminal/components/use-heat-map-model.ts` (surface summary memo)
- `src/features/terminal/components/HeatMap.tsx` (badge + `flex-wrap`)
- `messages/en.json`, `messages/ru.json`, `messages/az.json` (3 keys × 3 locales)
- `e2e/smoke/visual-baseline.spec.ts-snapshots/terminal-heatmap-chromium-darwin.png`
  — **snapshot, listed separately as the handoff requires**
- `docs/ROADMAP.md`, this file
- **No migrations. No schema. No financial module touched.**

### Design notes

- The gate **can only withhold** decision-grade, never grant it, and never reads
  `value` — a test asserts the cell is byte-identical after classification.
- Fails closed on absent/unparseable `computedAt`: absence of evidence is not
  evidence of freshness.
- `requireLineage` defaults **false** in the gate, deliberately: with 0/1269
  rows carrying lineage, a default-on rule would grey the product the instant
  the module gained a caller. The HeatMap badge passes `true` explicitly —
  which is also what makes it deterministic (0 lineage ⇒ `allProvisional` is
  always true, independent of the clock and of which cells loaded).
- `DEFAULT_STALE_AFTER_MS` = 30 days is **not invented**: it is the window
  already shipped in `trust-status.ts` (Phase L6). It is a parameter, not a
  constant, so approving a different window is a call-site change.

### Evidence — commands actually run this turn

| Command | Result |
|---|---|
| `vitest run src/lib/risk/decision-grade.test.ts` | 27/27 passed |
| `vitest run HeatMap.test.tsx` | 5/5 passed (after the Tooltip fix below) |
| `npx tsc --noEmit` | exit 0 |
| `playwright test visual-baseline.spec.ts` | **exit 0** against the updated baseline |
| read-only `psql` over `indicator_values` | the table above |

### Two defects I introduced, found by looking rather than assuming

1. **The badge's Radix `Tooltip` sat outside the `TooltipProvider`** — it threw
   `Tooltip must be used within TooltipProvider` on every render and hung 5
   HeatMap tests at 90s each. The 90s timeouts looked like slowness; the stderr
   said otherwise. Fixed with a native `title`, matching the neighbouring
   scenario badge, which sits outside the provider for the same reason.
2. **The badge was clipped**: the visual diff showed it rendering
   `⚠ LEGACY · NOT` with `DECISION-GRADE` cut off at the panel edge. Every child
   of that header row is `shrink-0`, so it overflowed. A truncated trust warning
   is worse than none. Fixed with `flex-wrap` rather than a shorter label,
   because RU and AZ are longer than EN and would clip again.

### Visual verification

`BASELINE UPDATE: Phase 10 A5 — Legacy/Provisional badge added to the HeatMap
header; header row wraps so the badge is not clipped.`

Only `terminal-heatmap-chromium-darwin.png` was updated, after inspecting
expected/actual/diff. The new PNG was then inspected directly: the badge reads
`⚠ LEGACY · NOT DECISION-GRADE` in full, on its own wrapped line between the
HEATMAP row and the year chips; the counts, filters, masked freshness label and
matrix are unmoved.

**`visual-baseline-board-deck` also fails — and it is not this slice.** Proven,
not asserted: this slice's tracked files were stashed **path-scoped** (no
protected file touched) and the spec re-run on a clean tree, where it fails
identically. Its baseline was deliberately **not** updated — 05 §8.3 forbids
accepting unrelated snapshot changes. It matches the drift already recorded in
the roadmap for 2026-07-15 (local data change from the workbook import).

### Limits — what is NOT done

- **Not reviewed.** Stage A's gate.
- **Per-cell demotion not shipped.** The gate supports it; the surface does not
  use it. Owner decision, evidence above.
- **The 30-day window is inherited, not approved.** Recorded as an owner
  question. It currently affects nothing on screen: the badge uses lineage.
- **The badge is a claim-withdrawal, not a full protective treatment.** A reader
  who ignores the header still sees a confident green cell. Closing that is
  per-cell demotion, i.e. the owner decision above.
- **No component test asserts the badge renders** — `HeatMap.test.tsx` costs
  ~90s/test and the badge is covered by the visual baseline plus the gate's 27
  unit tests. A `data-testid="heatmap-provisional-badge"` is in place for a
  cheap E2E assertion when Stage C adds stable selectors.
- **The terminal-heatmap visual baseline is intermittently non-deterministic**
  against live local data: with identical code, one run diffed 1,598 px and the
  next exited 0. Pre-existing and independent of this slice, but it means the
  gate cannot yet be trusted as a hard blocker. Worth a dedicated fix (mask the
  live counts, or seed deterministic data) before Stage E leans on it.

### Rollback

Revert the six source/message files and restore the previous baseline PNG; the
gate module is then unimported and inert. No data, schema or configuration to
undo.

### Next task

Stage A's implementation items (A1–A6) are now all implemented; **A4, A5 and A6
have not been reviewed.** Handoff §5 gates Stage B and any modern root UI on
Stage A review. Per the ADRs, Stage B's first item (B1 canonical statement mart)
additionally needs owner decisions T-1/T-5 that remain open.

---

## 8. Stage A technical review + checkpoint (2026-07-16)

Written per the operator's autonomy override, which authorizes continuing past a
**technical** stage gate when the conditions below hold, and requires the review
be recorded rather than waited on. It does **not** substitute for the human
Stage A review that handoff §5 gates Stage B on.

### 8.1 Stage A gate conditions — measured, not asserted

| Condition | State |
|---|---|
| Required tests pass | ✅ tsc 0 · vitest 503 files / 6,461 passed / 0 failed · prisma validate ok · build 0 · visual-baseline exit 0 |
| No unexplained financial difference | ✅ no financial value, formula, threshold, weight or KPI was touched in A4/A5/A6 |
| No security / cross-org issue | ✅ A4 derives eligibility from a server-side org id and never echoes the allowlist to the client |
| Functionality behind a disabled flag | ⚠️ **partially.** A4 ships off. **A5's badge is NOT behind a flag** and is visible to every user now — deliberate: it withdraws an unearned claim, which is the entire point of Stage A, and it is the one change here that should not wait for a rollout ramp |
| No production side effects | ✅ nothing deployed, no migration, no production data touched |
| Rollback preserved | ✅ A4: delete two inert files. A5: revert six files + one PNG; the gate is then unimported |
| Open business decisions marked Provisional and excluded | ✅ E-1 pilot list, T-1…T-6, the 30-day window and per-cell demotion are all recorded and none is enforced |

### 8.2 Stage A state

A1–A3 `implemented` + owner-reviewed 2026-07-16. A4, A5, A6 `implemented` +
`tested`; A5 also `visually verified`. **A4–A6 have had no human review.**

Repeat technical review on 2026-07-18 confirmed the A4 fail-closed rollout
contract and the HeatMap's explicit lineage + reconciliation pairing. It found
one A5 boundary defect: a future `computedAt` was treated as fresh because its
age was negative. Future timestamps now fail closed as `stale` (exact `now`
remains valid), with a regression test. Focused evidence: 4 files / 97 tests,
`tsc --noEmit` and diff-check green. No financial or visual output changed.
This additional technical review does not replace the open human gate.

### 8.3 Why Stage B is not started here

Not fatigue, and not the override — the work itself is not ready:

1. **B1 (canonical statement mart) cannot pass its own gate.** 05 §4.1 requires
   golden reconciliation fixtures with *approved controls*, and T-1 (the
   reconciliation tolerance) is an open owner decision. Without it there is no
   pass/fail line, so any "reconciled" claim would be invented.
2. **B4 (KPI Registry) needs T-5**, the 25–35 pilot KPI list. Handoff §9 forbids
   an agent choosing KPI methodology.
3. **Stage B is the financial migration** — the one place where a wrong move
   silently changes money on screen, which is the documented reason Phase 10
   exists. It is the worst possible candidate for a low-context slice.
4. B2 (PeriodContext + DataRevision) is the most independent B item and needs no
   KPI decision, but it is an additive schema migration plus contract work —
   a full slice, not a tail-end one.

Per the override's own rule ("mark Provisional, record the question, switch to
the next independent task" — and its context rule, "checkpoint before context is
exhausted"), the honest action is this checkpoint.

### 8.4 Checkpoint

- **Last commits.** `66722a02` A4 flags · `a613c276` A5+A6 decision-grade gate.
  Both path-scoped; no protected file ever staged.
- **Uncommitted work from this session: none.** All 8 protected paths remain
  dirty and untouched, exactly as at session start (plus `output/`, owner-confirmed).
- **Checks run this turn.** tsc 0 · vitest 503/6,461 green · prisma validate ok ·
  build 0 · visual-baseline exit 0 (after an inspected, single-file BASELINE
  UPDATE).
- **Active task.** None in flight. Stage A implementation is complete.
- **Exact next step.** Human review of A4–A6 (the handoff §5 gate). Then either
  **B2** (PeriodContext + DataRevision — the most independent B item), or **B1**
  once T-1 is answered.
- **Blockers.** Human Stage A review · T-1 reconciliation tolerance (blocks B1) ·
  T-5 pilot KPI list (blocks B4) · E-1 pilot org list (blocks any V2 enablement).
- **Known debt this session surfaced, unfixed:** the terminal-heatmap visual
  baseline is intermittently non-deterministic against live local data
  (identical code → 1,598-px diff, then exit 0). It should be masked or seeded
  before Stage E treats that gate as a blocker.

**Resume command:**

```text
Continue Risk Terminal 2.0 from IMPLEMENTATION-STATUS.md §8.4. Stage A
(A1-A6) is implemented; A4-A6 await review. Implement exactly one slice:
Stage B2 — PeriodContext + DataRevision (additive schema only; no KPI
methodology, no financial formula change). Do not start B1 until owner
decision T-1 (reconciliation tolerance) is answered.
```

---

## 9. Slice B-PR1 — PeriodContext + DataRevision contracts, B2 (2026-07-16)

**Status: `implemented` + `tested`. Not reviewed. Not wired — both modules are
unimported by design, so there is nothing to verify at runtime yet.**

### Outcome

- **Behavior changed for users: none.** Two pure contract modules with no
  callers, no schema and no DB access.
- **Who benefits:** Stage B's remaining items. B3 (invalidation), B5 (lineage)
  and B6 (Risk × Confidence) all need a period contract and a revision identity
  to exist before they can be built. This is that floor.
- **Behind a flag:** not applicable — nothing executes.
- **Stage:** Stage B trust core; `provisional` in that nothing consumes it.

### Files

- `src/lib/risk/period-context.ts` + `.test.ts` (new — 38 tests) — commit `a6231ef3`
- `src/lib/risk/data-revision.ts` + `.test.ts` (new — 33 tests) — commit `0ccaa21e`
- `docs/ROADMAP.md`, this file
- **No migrations. No schema. No translation files. No snapshots. No UI.**

### Design decisions worth review

1. **Period key grammar.** MONTH/QUARTER/FY reuse the strings already stored on
   `IndicatorValue.period`, so the contract describes existing data with no
   migration. YTD/LTM had no stored representation and needed one:
   `YYYY-YTD-MM` / `YYYY-LTM-MM`, chosen so the existing `^\d{4}` year probe
   (`isPartialYear`) keeps working. **LTM is reported under its ending year** —
   an LTM ending May 2026 is a 2026 figure reaching back into 2025.
2. **`coverageMonths` vs `expectedCoverageMonths` is the whole point.** It is
   the structural form of the EDEN defect: ~4 booked months of a 12-month year
   previously read as a complete FY result at 169.8% "green".
3. **UTC math, Baku declaration.** `timeZone` declares the fiscal calendar's
   zone; it does not shift the timestamps. `periods.ts` established that split
   and conflating the two is what booked a month of revenue into the wrong year
   via a 24-second LMT drift.
4. **The content hash excludes lifecycle state.** If approving a revision
   changed its hash, the hash could not answer its only question — "is this the
   same source state?". Id lists hash as sets so a re-import in a different
   order is not a new revision (idempotency, ADR §4).
5. **No `DataRevision` table.** See limits.

### Evidence — commands actually run this turn

| Command | Result |
|---|---|
| `vitest run period-context.test.ts` | 38/38 passed |
| `vitest run data-revision.test.ts` | 33/33 passed |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run --reporter=dot` | **exit 0** — 505 files, 6,532 passed, 19 skipped |
| `npx prisma validate` | schema valid |
| `npx prisma migrate status` | "Database schema is up to date" — no drift |

No E2E and no visual gate: no file in this slice has a runtime surface or can
affect layout, so neither applies.

### Financial reconciliation

**Not applicable, and deliberately so.** Neither module computes money. A period
contract describes *when*; a revision describes *from what*. No formula,
aggregation, threshold, weight, KPI or value was touched.

### Limits — what is NOT done

- **Not reviewed**, and Stage A's own review (A4-A6) is still outstanding.
- **`DataRevision` is not persisted.** No Prisma model, no migration. This is a
  judgement call worth an explicit look: every sibling table in this database
  carries RLS policies, and adding one without them risks precisely the
  cross-org exposure 05 §13 names as an immediate rollback trigger. That is a
  security-shaped decision, not a mechanical `migrate dev`, so it gets its own
  slice. `prisma migrate status` reports no drift, so that slice starts clean.
- **Nothing produces a PeriodContext yet.** No writer stamps one onto an
  observation; `revisionId` has no source. Wiring is B5's job.
- **`hasFullCoverage()` is not §4.3 completeness** — coverage only. Named
  narrowly so no caller mistakes it for a decision-grade gate.
- **The YTD/LTM key grammar is my choice, not the spec's.** The spec defines the
  taxonomy but not the string form. If the owner or a later stage prefers a
  different encoding, it is a parser change in one file — but it is a decision
  that should be seen rather than inherited silently.

### Rollback

Delete four files. Nothing imports them.

### Next task

**B3** (exact M/Q/YTD/FY/LTM invalidation) is the natural next dependency-ready
item — it needs the period contract that now exists, and no owner decision.
**B1 remains blocked on T-1**; **B4 on T-5**. Stage A review (A4-A6) is still
the outstanding human gate.

**Resume command:**

```text
Continue Risk Terminal 2.0 from IMPLEMENTATION-STATUS.md §9. B2 contracts
are implemented (period-context.ts, data-revision.ts) but unwired.
Implement exactly one slice: either B3 (exact M/Q/YTD/FY/LTM invalidation,
pure, building on parsePeriodKey), or the deferred DataRevision persistence
slice (additive model + RLS policy, reviewed). Do not start B1 until T-1
is answered.
```

---

## 10. Slice B-PR2 — exact period invalidation, B3 (2026-07-16)

**Status: `implemented` + `tested`. Not reviewed. Not wired — pure module, no
caller, nothing to verify at runtime.**

### Outcome

- **Behavior changed for users: none.** `invalidatedPeriodKeys(changedMonth)` +
  `periodContainsMonth()`, both pure. Commit `82260568`.
- **Who benefits:** B5 (lineage) and the recompute pipeline. §4.4's requirement
  — a changed monthly fact invalidates its month, quarter, YTDs, FY and LTM
  windows — is now a decidable function instead of a paragraph.
- **Files.** `src/lib/risk/period-invalidation.ts` + `.test.ts` (44 tests).
  No migrations, no schema, no UI, no snapshots.

### Design decisions worth review

1. **Over-invalidation is treated as a defect, not a safe default.** `2026-YTD-04`
   is not invalidated by a May change. "Just recompute the year" would be
   simpler and wrong: §15 flags shadow compute doubling load.
2. **LTM crosses the fiscal year.** A change to `2026-05` reaches `2027-LTM-04`.
   Any invalidation scoped to the changed month's year silently misses it.
3. **Rollups/composites/alerts are out of scope** (§4.4's remaining bullets).
   They depend on org structure and are not derivable from a month string. The
   writer that consumes this list owns them — recorded so the gap is visible
   rather than assumed done.

### Evidence — run this turn

| Command | Result |
|---|---|
| `vitest run period-invalidation.test.ts` | 44/44 passed |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run --reporter=dot` | **exit 0** — 506 files, 6,576 passed, 19 skipped |

No E2E/visual gate: no runtime surface, no layout file.

### Limits

- Not reviewed; Stage A's own review (A4-A6) is still outstanding.
- **No caller.** Nothing in the recompute pipeline uses this yet; wiring it into
  `recompute-trigger.ts` is a separate slice with a real runtime surface and a
  real regression risk, and should not be bolted onto a contract commit.
- §4.4's queue-behaviour clauses (duplicate messages, failure/retry, superseded
  revision, partial completion) are only *addressable* now — the fan-out is
  deterministic and comparable. They are not *tested end-to-end*, because there
  is no queue integration in this slice.

---

## 11. Checkpoint (2026-07-16, session end)

### Commits this session, all path-scoped, no protected file ever staged

| SHA | Slice |
|---|---|
| `66722a02` | A4 — server-resolved rollout flags |
| `a613c276` | A5+A6 — decision-grade gate + Legacy badge (BASELINE UPDATE) |
| `7144256e` | Stage A review + checkpoint |
| `a6231ef3` | B2a — PeriodContext contract |
| `0ccaa21e` | B2b — DataRevision contract |
| `0b504a8f` | B2 roadmap/status |
| `82260568` | B3 — exact period invalidation |

- **Uncommitted work: none** beyond this entry. All 8 protected paths remain
  dirty and untouched, exactly as at session start.
- **Checks at session end.** tsc 0 · vitest 506 files / 6,576 passed / 0 failed ·
  prisma validate ok · build 0 · terminal visual-baseline exit 0.

### State

Stage A implemented (A1-A6); **A4-A6 not reviewed**. Stage B: B2 and B3
implemented as pure contracts, **both unwired by design**. Everything added this
session is inert unless imported — the sole exception is A5's badge, which is
live for every user by intent.

### Blockers

- **Human review of A4-A6** — handoff §5's gate.
- **T-1** (reconciliation tolerance) blocks B1: without it there is no pass/fail
  line and any `reconciled` claim would be invented.
- **T-5** (25-35 pilot KPI list) blocks B4. §9 forbids an agent choosing it.
- **E-1** (pilot org list) blocks any V2 enablement. Allowlist ships empty = off.

### Known debt surfaced, not fixed

- The terminal-heatmap visual baseline is intermittently non-deterministic
  against live local data (identical code → 1,598-px diff, then exit 0). Mask
  the live counts or seed deterministic data before Stage E treats it as a
  blocker.
- `visual-baseline-board-deck` fails on a clean tree (proven by path-scoped
  stash). Pre-existing, untouched, and still unexplained.
- The `DataRevision` table is unbuilt: sibling tables carry RLS policies and
  adding one without them is a security decision, not a mechanical migration.

**Resume command:**

```text
Continue Risk Terminal 2.0 from IMPLEMENTATION-STATUS.md §11. B2 and B3
contracts exist but are unwired. Implement exactly one slice, in this
preference order:
1. DataRevision persistence — additive Prisma model + RLS policy matching
   the sibling tables (migrate status is clean, no drift).
2. Wire invalidatedPeriodKeys() into the recompute trigger — real runtime
   surface, needs regression coverage.
Do not start B1 until owner decision T-1 is answered, or B4 until T-5 is.
```

---

## 12. Slice B-PR3 — DataRevision persistence, B2 (2026-07-16)

**Status: `implemented` + `tested` (23 live-DB tests). Not reviewed. Closes the
half of B2 that §9 deferred. Nothing reads the table yet.**

Commit `78bce9e0`.

### Outcome

- **Behavior changed for users: none.** A new table with no reader. Legacy
  read/serving paths untouched.
- **Who benefits:** B5 (immutable observation + lineage). The reason every
  coloured cell is `provisional` today is that 0/1269 rows can name their
  source. This is where that name will live.

### Files

- `prisma/schema.prisma` — `DataRevision` model + `RevisionReason` enum
- `prisma/migrations/20260716052925_data_revision/migration.sql` — **migration,
  listed separately as the handoff requires**
- `src/lib/risk/data-revision.rls.integration.test.ts` (new — 23 tests)
- `src/lib/risk/data-revision.ts` — corrected a comment that contradicted the
  new unique constraint
- `docs/ROADMAP.md`, this file

### Security review (the one the task asked for, item by item)

| Risk | Finding |
|---|---|
| **Cross-org leakage** | Not found. 4 tests: `findMany` with **no** org filter → 0; `findUnique` by explicit id → null; cross-org write rejected; absent context → 0. |
| **Missing RLS policy** | Not possible by construction — `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` are in the **same migration** as `CREATE TABLE`. Verified live in `pg_policies`: `cmd=ALL`, qual identical to the baseline. |
| **Mutable revision** | Not found. `BEFORE UPDATE` trigger verified in `pg_trigger`; 6 rejection tests. Lifecycle columns still move, by design. |
| **Race condition** | Tested, not reasoned about: 5 concurrent creates of one source state → **exactly 1 row**, 1 fulfilled, 4 × P2002. |
| **Duplicate revision** | `@@unique([organizationId, contentHash])`. Duplicate → P2002; repeated upsert returns the same id and leaves count 1. |
| **Orphan records** | Org delete cascades → 0 left. `createdById` SetNull tested. `supersedesId` SetNull. |
| **Rollback** | Migration is additive — every statement targets `data_revisions`; `indicator_values` = 1,269 before and after. Nothing reads the table, so revert = drop it. |

### Two findings worth naming

1. **The immutability trigger nearly broke user deletion.** `ON DELETE SET NULL`
   is an UPDATE under the hood, so a blanket "no column may change" ban would
   have made deleting a `User` fail. The rule is therefore narrower:
   `createdById`/`supersedesId` may transition **to NULL** (the cascade) but
   never to another value. Caught while writing the trigger, and covered by a
   test that deletes a real user.
2. **The isolation tests were vacuous at first, and said so.** `getPrismaApp()`
   deliberately returns the default client under vitest, and the dev
   `DATABASE_URL` is a superuser with BYPASSRLS — so my first run had ORG_B
   happily reading ORG_A's row. That failure **is** the negative control: the
   assertions only pass once routed through `budgetpro_app` (NOBYPASSRLS). The
   suite now passes its client explicitly (as `rls-leak.integration.test.ts`
   does) and **throws** if `DATABASE_URL_APP` is missing, rather than passing
   against a client that ignores every policy.

A third check was attempted and refused: temporarily `DISABLE ROW LEVEL
SECURITY` to prove the tests fail without it. The permission guard blocked
weakening a live isolation control, correctly — and the accidental
superuser run above already provides that evidence, so nothing is missing.

### Limits

- **Not reviewed.**
- **No writer.** Nothing constructs a `DataRevision` in any real code path;
  `IndicatorValue` has no `revisionId`. Wiring lineage is B5, and it is the
  slice that makes A5's provisional badge retractable.
- **Tests are opt-in** (`RLS_INTEGRATION=1`) and skipped in the default sweep,
  matching the existing RLS test. They are therefore **not** a CI gate — same
  status as the safety net they sit beside.
- **The trigger is new prior art.** No other table in this schema enforces
  immutability in the database. If that convention is unwanted, it is one
  migration to drop.

---

## 13. Blocker — wiring `invalidatedPeriodKeys()` into the recompute trigger (2026-07-16)

**Status: `blocked`. Not started, and deliberately not faked.**

The queued next task was to wire B3's fan-out into the recompute trigger. It is
not a safe drop-in, for two measured reasons rather than a judgement call.

### Evidence

| Fact | Source |
|---|---|
| `RecomputeAffected` is `{ companyId, year }` — **no month input exists** | `src/lib/risk/recompute-trigger.ts:39-42` |
| The trigger computes `const period = String(year)` — it only ever writes FY | `recompute-trigger.ts:347` |
| IVs carrying a **YTD or LTM** period: **0** | read-only SQL, local dev DB |
| Existing IV period shapes: FY 677 · MONTH 444 · QUARTER 148 | read-only SQL |
| Monthly/quarterly IVs come from `POST /api/indicators` recomputing **exactly the requested period** — there is no automatic fan-out anywhere | `src/app/api/indicators/route.ts:345`, `recompute.ts:501` |

### Why this is a stop, not a chore

`invalidatedPeriodKeys(changedMonth)` needs a changed **month**. The trigger
never receives one. Giving it one means:

1. **Changing the canonical financial path's input contract** (year → month) —
   handoff §4 has exactly one canonical aggregation path and §2.8 says stop when
   a slice needs a materially broader change than the documentation authorizes.
2. **Fabricating YTD and LTM observations that have never existed** in this
   product (0 rows). Those are not refreshes of stale aggregates; they are new
   financial figures appearing on screen, from a path with no golden
   reconciliation behind it.

Both are Stage B1/B5 work. **B1 is blocked on T-1** (the reconciliation
tolerance): without it there is no pass/fail line, so no such change could be
called `reconciled` without inventing the control. 05 §4.4's recompute
assertions likewise presume the mart that B1 builds.

Wiring it anyway would produce numbers I could not reconcile, on the one path
whose defects are the reason Phase 10 exists. The fan-out therefore stays a
tested pure function with no caller — which is what B3 claimed and all it
claimed.

### What would unblock it

Either owner decision **T-1** (making B1 startable, after which the mart owns
period fan-out), or an explicit owner decision that YTD/LTM become served
periods — a product decision, not a technical one.

---

## 14. Checkpoint (2026-07-16, session end)

### Commits this session — all path-scoped, no protected file ever staged

| SHA | Slice |
|---|---|
| `66722a02` | A4 — server-resolved rollout flags |
| `a613c276` | A5+A6 — decision-grade gate + Legacy badge (BASELINE UPDATE) |
| `7144256e` | Stage A review + checkpoint |
| `a6231ef3` | B2a — PeriodContext contract |
| `0ccaa21e` | B2b — DataRevision contract |
| `0b504a8f` | B2 roadmap/status |
| `82260568` | B3 — exact period invalidation |
| `538d7a20` | B3 roadmap/status + checkpoint |
| `78bce9e0` | B2 — DataRevision persistence (table + RLS + immutability trigger) |
| `c6caecae` | DataRevision status + security review |

- **Uncommitted work: none** beyond this entry. All 8 protected paths remain
  dirty and untouched, exactly as at session start.
- **Final checks.** tsc 0 · full vitest 506 files / 6,576 passed / 41 skipped /
  0 failed · prisma generate + validate ok · `migrate status` clean · RLS
  integration 23 passed · existing rls-leak + with-org-scope 21 passed.

### State

Stage A implemented (A1-A6), **unreviewed from A4 on**. Stage B: B2 complete
(contracts + persisted table with isolation and immutability); B3 implemented as
a pure function. Everything added this session is inert unless imported — the
sole exception remains A5's badge, live by intent. `data_revisions` has a
writer-shaped hole: nothing constructs a revision yet.

### Blockers

- **Human review of A4-A6** — handoff §5's gate.
- **T-1** blocks B1 *and* the B3 wiring (§13).
- **T-5** blocks B4.
- **E-1** blocks any V2 enablement; the allowlist ships empty, i.e. off.

### Known debt surfaced, not fixed

- terminal-heatmap visual baseline is intermittently non-deterministic against
  live local data (identical code → 1,598-px diff, then exit 0).
- `visual-baseline-board-deck` fails on a clean tree (proven by path-scoped
  stash). Pre-existing, untouched, unexplained.
- The RLS integration suites are opt-in (`RLS_INTEGRATION=1`) and therefore not
  a CI gate — same status as the safety net they sit beside.

**Resume command:**

```text
Continue Risk Terminal 2.0 from IMPLEMENTATION-STATUS.md §14. The next
dependency-ready slice is B5 (immutable observation + lineage): add
revisionId to IndicatorValue as an additive, nullable FK to data_revisions
and have one writer stamp it — that is what makes A5's provisional badge
retractable. Do NOT wire invalidatedPeriodKeys() into the recompute trigger
(§13 blocker: the trigger has no month input and YTD/LTM have never been
served). Do not start B1 until T-1 is answered, or B4 until T-5 is.
```

---

## 15. Slice B-PR4 — lineage on IndicatorValue, B5 (2026-07-16)

**Status: `implemented` + `tested` (12 live-DB + 29 gate tests). Not reviewed.
Lineage is now *recordable*; it is not yet *recorded* in production.**

Commit `a8c5b7fa`.

### Outcome

- **Behavior changed for users: none.** No row carries a `revisionId`, so the
  A5 badge still reads `LEGACY · NOT DECISION-GRADE`. **Provisional is NOT
  lifted** — deliberately.
- **What is now possible:** an observation can name the source state it came
  from. That is the missing half of why every coloured cell is provisional.

### Files

- `prisma/schema.prisma` — `IndicatorValue.revisionId` + relation
- `prisma/migrations/20260716055905_indicator_value_revision/` — **migration**
- `src/lib/risk/data-revision-writer.ts` (new) — `ensureDataRevision`
- `src/lib/risk/lineage.integration.test.ts` (new — 12 tests)
- `recompute-types.ts` / `recompute-data-source.ts` / `recompute.ts` — the
  writer + its guard (pure insertions)
- `heatmap-matrix.ts` — `HeatMapCell.revisionId`
- `decision-grade.ts` + `.test.ts` — lineage now means `revisionId`

### Review (the one the task asked for)

| Risk | Finding |
|---|---|
| **Cross-org leakage** | Guarded in the single writer and tested. Foreign and missing ids return an **identical** error, so ids are not probeable. |
| **Wrong writer** | Exactly one DB write site (`recompute-data-source.ts:641/665`), verified by grep. `recompute.ts` is pass-through. |
| **Orphan records** | `onDelete: Restrict` — deleting a referenced revision throws (tested). A failed write leaves no row (tested). |
| **Race conditions** | `ensureDataRevision` recovers from P2002 by re-reading the winner. The unique index arbitrates. |
| **Accidental financial change** | Both engine diffs are **pure insertions**, 54 added / 0 removed; no `value`/`status`/`formula`/`threshold` line touched. 1,269 IVs before and after, all still null. Full suite green. |
| **Premature un-provisioning** | Not possible today: nothing stamps a revisionId, and `requireLineage` still defaults to false. A traced-but-stale cell stays provisional (tested). |
| **Rollback** | Drop the column. Nothing reads it; every row is null. |
| **API serialization exposing another org** | Covered on three independent layers, none of them new: the matrix handler already scopes its IndicatorValue query by `organizationId` (asserted at `src/app/api/indicators/matrix/handler.test.ts:116`); `indicator_values` carries the `tenant_isolation` RLS policy at the DB layer; and `revisionId` is not emitted on the wire at all yet. |

### The one design correction worth review

A5's gate treated `lastReconciledAt` as lineage. It is not: that field says "was
this checked against source?", while lineage says "where did it come from?".
Now that a real lineage column exists, `no_lineage` keys off `revisionId`, and a
reconciliation stamp can no longer masquerade as provenance (tested explicitly).
Behaviour is identical — both are absent on 100% of rows — but the *reasons* are
now honest, which is what §10.7 asks for.

### Limits — what is NOT done

- **Not reviewed.** Stage A's review (A4-A6) is still outstanding too.
- **No production writer stamps a revisionId.** Every real path still calls the
  writer without one. Choosing which import/recompute path constructs a
  revision — and what its `sourceArtifactIds`/`mappingVersionIds` are — is a
  real modelling decision about the import pipeline, not a mechanical wiring,
  and it deserves its own slice. **This is the honest gap: lineage is
  recordable, not recorded.**
- **The matrix API does not select `revisionId`**, so `HeatMapCell.revisionId`
  is always undefined on the wire. Emitting a column that is null for 100% of
  rows adds payload for zero information; wire it when a writer produces one.
  The gate already consumes it the moment it appears.
- **`requireLineage` still defaults to false**, and must, until a writer
  populates lineage — otherwise the first caller greys the product.
- Tests are opt-in (`RLS_INTEGRATION=1`) and therefore not a CI gate.

---

## 16. Checkpoint (2026-07-16)

### Commits this session — all path-scoped, no protected file ever staged

`66722a02` A4 flags · `a613c276` A5+A6 gate + badge (BASELINE UPDATE) ·
`7144256e` Stage A review · `a6231ef3` B2a PeriodContext · `0ccaa21e` B2b
DataRevision · `0b504a8f` B2 docs · `82260568` B3 invalidation · `538d7a20` B3
docs · `78bce9e0` DataRevision persistence (RLS + immutability) · `c6caecae`
security review · `907bdbde` B3 wiring blocker · `a8c5b7fa` B5 lineage.

- **Uncommitted: none** beyond this entry. All 8 protected paths untouched.
- **Final checks.** tsc 0 · full vitest 506 files / 6,578 passed / 54 skipped /
  0 failed · prisma generate + validate ok · live-DB suites 35 passed
  (23 DataRevision + 12 lineage) · existing RLS 21 passed.

### Blockers

- **Human review** of A4-A6 and all of Stage B.
- **T-1** blocks B1 *and* the B3 wiring (§13).
- **T-5** blocks B4.
- **E-1** blocks V2 enablement; allowlist ships empty = off.

**Resume command:**

```text
Continue Risk Terminal 2.0 from IMPLEMENTATION-STATUS.md §16. Next
dependency-ready slice: give lineage a production writer — pick ONE import
path (e.g. the staging apply route), have it ensureDataRevision() inside its
existing transaction with real sourceArtifactIds/mappingVersionIds, and pass
the revisionId to recomputeIndicator. That is what makes A5's provisional
badge retractable. Then wire revisionId into the matrix API select so the
gate can see it. Do NOT wire invalidatedPeriodKeys (§13). B1 needs T-1; B4
needs T-5; do not enable V2.
```

## 17. Slice B-PR5 — the first production lineage writer, B5 (2026-07-16)

> **Current correction (2026-07-16):** the import-side `DataRevision` producer
> remains, but blanket observation stamping was withdrawn after a release review
> proved that one workbook revision cannot explain every formula in the batch
> recompute. The historical slice account below is retained for audit context;
> every claim that an import currently stamps `IndicatorValue.revisionId` is
> superseded by §20.

**Status: `implemented` + `tested` (16 unit + 8 handler + 4 matrix + 3 trigger +
6 gate; 36 live-DB). `reviewed` — by an independent adversarial subagent, which
found three real defects, all fixed below. Not owner-reviewed.
The import revision is recorded on one path; observation lineage is not.
Provisional is NOT lifted.**

### 17.1 The writer choice, and the evidence behind it

The task named the staging apply route "if code evidence confirms it is the real
canonical, org-scoped, transaction-safe apply boundary". It is the first two.
It is **not** a boundary that spans recompute — and no path in this codebase is:

| Path | Source write | Recompute |
|---|---|---|
| `staging/[id]/apply` | `$transaction` | **after** commit (`:687`) |
| `staging/[id]/apply-multi` | `$transaction` | **after** commit (`:878`) |
| `staging/[id]/apply-multi-entity` | `$transaction` | **after** commit (`:655`) |
| `onboarding/import/budget` | `$transaction` | **after** commit (`:323`) |

Each carries its own comment saying why ("would extend tx beyond 60s on big
sheets"), and `recompute-trigger.ts:16-18` states the matching failure policy:
per-pair errors are never re-thrown, because "a single bad indicator formula
must not hide a successful import".

So the task's requirement 9 — *an error at any step rolls back apply,
DataRevision and IndicatorValue together* — is **not achievable** without
restructuring the canonical financial import path (handoff §2.8: stop when a
slice needs a materially broader change than the documentation authorizes).

It is also **not what the spec asks for.** `03-DATA-KPI-TRUST-SPEC` §6.1: "Every
source mutation emits `SourceChangeEvent { revisionId, affectedPeriodKeys, … }`"
— the revision is raised at the *source mutation*, and recompute is downstream.
§6.4's observation states (`pending → computing → ready`) and its rule that a
pending value may be shown "only with stale/provisional treatment" describe an
eventually-consistent recompute explicitly. The two-phase shape is the design,
not a defect in it.

**Therefore the boundary implemented is:** the revision is created inside the
apply transaction, because a revision pins SOURCE state and that transaction is
where source state becomes real. `apply ↔ revision` is atomic. `revision ↔
IndicatorValue` is not, and is not claimed to be.

### 17.2 The ids — real, and what they are not

- `sourceArtifactIds: ['import-staging:<cuid>']`. No `SourceArtifact` model
  exists (§9 names one); the staging row is 1:1 with an uploaded file+sheet and
  is the closest real identity. The retained proposal now also contains a
  server-written SHA-256 of the analyzed workbook, and Apply verifies that the
  replacement upload matches it byte-for-byte before parsing. The revision's
  own `contentHash` remains a scope hash, not a file hash.
- `mappingVersionIds: ['effective-mapping:<sha256>']` over the mapping actually
  applied (proposal ⊕ reviewer overrides): column `role`, `currencyCode`,
  account-type overrides. Excludes `confidence`/`reasoning` prose — commentary
  about a decision is not the decision. **Not** the approved-template version:
  that is saved post-commit, best-effort, so reading it at apply time would name
  a version this import did not necessarily use.

### 17.3 The review (independent subagent) — three real defects, all fixed

| # | Defect | Fix |
|---|---|---|
| **1** | **Provisional was lifted.** `use-heat-map-model.ts:314` passes `requireLineage: true`; its comment justified this from `lastReconciledAt`, but `a8c5b7fa` had re-pointed the lineage rule at `revisionId`. B5 fills `revisionId` → a fresh import would be certified decision-grade, never reconciled. | `decision-grade.ts` gained `no_reconciliation` — the rule its own comment already claimed ("both are required"). Surface requires it. 0/1,269 reconciled ⇒ badge unchanged. |
| **2** | **Lineage would lie.** `upsertIndicatorValue` preserved `revisionId` on `undefined` (modelled on sparkline). The cron threads no revision → it would overwrite value/status/computedAt and leave the import's revision on a number it never produced. | Lineage written on **every** update. Presence now means "this revision produced this number". The live-DB test asserting the old rule is inverted, reasoning kept. |
| **3** | **Parent rollups over-stamped.** The trigger fans out to every level-1 company org-wide; one child's import would stamp every holding's rollup with a revision naming one child. | The release review tightened this further: the batch trigger stamps no observations at all until a per-indicator dependency manifest can prove the complete source set. |

Also closed: `currencyCode` added to the mapping hash (it selects which amount
column wins and tags `BudgetLine.currencyCode` — it changes the money).

Verdicts returned CLEAN: atomicity claim accurate · cross-org leakage · duplicate
revision · orphan records · accidental financial change.

### 17.4 Financial reconciliation — measured

Identical before and after: **1,269** IVs · **0** traced · **0** reconciled ·
**0** revisions · **498** coloured · ΣIV **413,796,007.3851349** ·
ΣBudgetLine **1,062,640,716.182965**. No backfill. The writer is inert until a
real import runs.

### 17.5 Evidence — commands actually run this turn

- `npx tsc --noEmit` → 0
- `npx prisma validate` → ok
- `npx vitest run --reporter=dot` → **507 files / 6,616 passed / 55 skipped / 0 failed**
- `RLS_INTEGRATION=1` live-DB → **36 passed**
- Read-only SQL reconciliation (above)
- No visual gate: no file from the mandated list in scope, and the badge verdict
  is provably unmoved (0 traced ∧ 0 reconciled ⇒ `allProvisional` either way).

### 17.6 Limits — what is NOT done

- **Provisional is NOT lifted**, and must not be until reconciliation, coverage
  and methodology gates exist. B5 proves *where a number came from*, never
  *whether it is right*.
- **All batch-recomputed observations remain untraced.** Three import paths
  create immutable source revisions, but none passes a workbook-only revision
  into the generic KPI fan-out. This is a deliberate fail-closed boundary, not
  an invitation to copy the option to more routes.
- **A staging id is not itself a byte fingerprint.** The retained proposal now
  stores the analyzed workbook SHA-256 and all three staged Apply routes verify
  the same bytes before parsing. `DataRevision.contentHash` must still not be
  described as a file-content hash; it fingerprints the canonical revision
  scope.
- **Two period vocabularies meet.** Import revisions use month-key ranges
  (`2026-01`..`2026-12`), while generic batch observations use the FY key
  `2026`. They are deliberately not linked today. A future dependency-aware
  linker must compare them through `parsePeriodKey`, never as raw strings
  (`'2026' < '2026-01'`).
- **New blast radius, for owner sign-off:** a DataRevision write failure now
  rolls back a financial import that would previously have committed (e.g. a
  `createdById` FK for a deleted user). Deliberate — an import that cannot say
  where it came from should not land — but it is new.
- **`requireLineage` still defaults false** in the gate; only the HeatMap
  surface opts in, alongside `requireReconciliation`.
- Live-DB tests are opt-in (`RLS_INTEGRATION=1`), so not a CI gate.

### 17.7 Rollback

Revert the commit. `revisionId` stays a nullable column that no writer fills;
every row is null; the gate reads null as `no_lineage` exactly as before.

### 17.8 Next task

Widen the contract to `apply-multi` / `apply-multi-entity` / `budget`, each with
a revision scope naming the companies it actually wrote. Do **not** wire
`invalidatedPeriodKeys` (§13). B1 needs T-1; B4 needs T-5; do not enable V2.

### 17.9 Unrelated observation, not touched

`.claude/settings.json` is dirty in this worktree (pre-existing, protected, never
staged). It widens Bash permissions to include `ssh root@<redacted-host> *` and
drops `"hooks": {}`. Flagged for the owner because an unrestricted-shell
allowlist entry is worth a deliberate decision; **not** modified by this slice.

---

## 18. Slice B-PR6 — lineage on the deterministic import, B5 cont'd (2026-07-16)

**Status: `implemented` + `tested` (28 unit + 7 handler). Not owner-reviewed.
Two import paths create source revisions; neither currently stamps observation
lineage. Provisional still NOT lifted.**

Widens §17's contract to `POST /api/onboarding/import/budget` — the
deterministic per-company import — on the same boundary: `ensureDataRevision()`
inside the route's existing `$transaction` (`:247`). The revision is returned
for audit diagnostics but is intentionally not threaded into the generic
post-commit recompute.

### 18.1 Why this path's lineage is stronger, and where it is weaker

It is not a copy of §17. The two paths hold different evidence, and each is
honest about a different half:

| | staging `/apply` | `/import/budget` |
|---|---|---|
| **Artifact** | `import-staging:<cuid>` — names the import *event*; bytes are not retained | `workbook-sha256:<digest>#<sheet>` — **byte-exact**, fingerprints what was read |
| **Mapping** | `effective-mapping:<sha256>` of the proposal ⊕ overrides actually applied | `parser:sopl` / `parser:rollup#<column>` — names the parser, **not its code version** |

So §17.6's "a staging id is not a byte fingerprint" is **closed on this path**:
it holds the upload while it works, so it hashes it. In exchange its mapping id
is the weaker one — editing `parseSoplSheet` does not move `parser:sopl`, so two
revisions with the same mapping id could span a parser change across a deploy.
Closing that needs a real adapter/parser version, which does not exist.

This also makes idempotent **reuse** real rather than theoretical for the first
time: the budget route permits re-upload (delete-then-insert converges), so
re-importing byte-identical input hits the same content hash and reuses one
revision. On the staging path the status claim 409s a repeat before it can.

### 18.2 Evidence — commands actually run this turn

- `npx tsc --noEmit` → 0
- `npx vitest run --reporter=dot` → **507 files / 6,632 passed / 55 skipped / 0 failed**
- live-DB (`RLS_INTEGRATION=1`) → **36 passed**
- Reconciliation, read-only SQL: **1,269** IVs · **0** traced · **0** revisions ·
  ΣIV **413,796,007.3851349** · ΣBudgetLine **1,062,640,716.182965** — unchanged.

### 18.3 Limits

- **All observations remain untraced** until complete per-indicator dependencies
  can be represented. Import-side source revisions are useful audit records but
  are not sufficient observation lineage by themselves.
- The parser mapping id does not version parser code (above).
- Everything in §17.6 that is not listed as closed still stands.

---

## 19. Slice B-PR7 — multi-company lineage from committed writes, B5 cont'd (2026-07-16)

**Status: `implemented` + `tested` (43 unit + 32 handler + 15 live-DB).
`reviewed` — independent adversarial subagent, no defects in the import-revision
scope itself. Not owner-reviewed. Three import paths create source revisions;
zero stamp observation lineage. Provisional still NOT lifted.**

Wires `POST /api/onboarding/import/staging/[id]/apply-multi-entity` under the
owner's approved multi-company contract, and blocks `apply-multi` with proof.

### 19.1 Why `apply-multi-entity` is buildable and `apply-multi` is not

The owner's rule #2 is the whole game: `companyIds` must be provable from
**committed writes**, never from the request, the entity map or a declared plan.
The two routes differ exactly on whether that proof exists.

| | `apply-multi-entity` | `apply-multi` |
|---|---|---|
| Writes | one `$transaction` (`route.ts:542`) | budget-line tx covers **one** company (`staging.companyId`); KPI + BS dispatchers write **other** companies in **separate** transactions (`apply-multi-dispatchers.ts:100,349`), failures non-fatal |
| Write proof | `applyParsedLinesToCompany` returns `{inserted, deleted}` per entity, collected in-tx (`route.ts:591`) | `kpiTouchedCompanyIds.add(id)` fires **before** the write and can precede a `continue` that writes nothing (`apply-multi-dispatchers.ts:104-108`) — a *potential* set, not a *committed* one |
| One source event? | yes — one sheet, split by its entity column | no — budget sheet + KPI families + BS sheets, different mappings |

So `apply-multi-entity` satisfies all six of the owner's conditions for one
shared revision, and `apply-multi` satisfies none. Wiring `apply-multi` would
require either a per-source `RevisionBatch` (schema work, not yet justified) or
folding three separate transactions into one (a broader change than authorized).
**It stays a recorded blocker, per rule #6.**

### 19.2 How the scope is proven

`committedCompanyIds(writes)` (`import-lineage.ts`) filters
`inserted > 0 || deleted > 0`, de-dupes and sorts. A deletion-only entity counts
— a clean-slate is a committed change to that company's data and moves its
indicators. `buildMultiEntityImportRevisionScope` then fails closed:
`empty_committed_scope` when nothing was written, `cross_org_company` when a
committed id escapes the org set. Both throw **inside** the transaction, so the
import rolls back with them — the approved fail-closed policy. The error carries
a reason code only, never a company id or source datum.

The revision names only companies actually written. The recompute does not
receive `tracedCompanyIds` or any blanket `revisionId`: even for a written
company, a formula may merge workbook, feed, manual and rollup inputs. Every
batch-recomputed observation stays untraced until that complete dependency set
can be proven.

### 19.3 Deleted-author FK race (owner rule #5)

`ensureDataRevision` now resolves the actor before insert: an author who still
exists is recorded, one who was deleted mid-request is recorded as `null` — the
schema's own `createdById String?` / `onDelete: SetNull` contract. Without this,
a revision inside the import tx would P2003 and roll back a financial import
because the person who started it was removed. Residual race (delete between the
check and the insert) is one statement inside a tx and degrades to the
pre-existing P2003 → rollback, not corruption. This is shared code, so all three
wired routes get the behaviour; consistent and desirable, and noted because it is
broader than this one route.

### 19.4 Evidence — commands actually run this turn

- `npx tsc --noEmit` → 0
- `npx prisma validate` → ok
- `npx vitest run --reporter=dot` → **507 files / 6,669 passed / 57 skipped / 0 failed**
- live-DB (`RLS_INTEGRATION=1`) lineage + RLS → **36 passed** (incl. 2 new actor-resolution)
- Reconciliation, read-only SQL: **1,269** IVs · **0** traced · **0** reconciled ·
  **0** revisions · **498** coloured · ΣIV **413,796,007.3851349** ·
  ΣBudgetLine **1,062,640,716.182965** — unchanged.
- Independent adversarial review: CLEAN on all 10 risks (false scope, cross-org,
  over-stamped rollups, partial tx, duplicate revision, mixed mapping/artifact,
  financial change, premature decision-grade, actor race, empty-scope fail-closed).

### 19.5 Limits

- **`apply-multi` blocked** (§19.1) and **`multi-file-orchestrator` untouched**
  — different files, mappings, companies and periods; needs its own scope proof
  and probably a `RevisionBatch`. Separate checkpoint, per rule.
- Everything in §17.6 / §18.3 not marked closed still stands.
- Provisional NOT lifted — the gate still requires reconciliation, 0/1,269 have it.

---

## 20. Release safety correction — exact staged bytes and honest observation lineage (2026-07-16)

**Current state:** `implemented` + focused-tested; full release gates are tracked
in `docs/ROADMAP.md`. This section supersedes the runtime-lineage claims in
§17-§19 without erasing their audit history.

1. Both Analyze routes persist SHA-256 over the exact workbook buffer they parse.
   `apply`, `apply-multi` and `apply-multi-entity` read the replacement once,
   reject a missing or mismatched fingerprint with `409` before XLSX parsing and
   before any transaction, then parse that same verified buffer. A changed file
   must go through a fresh Analyze and preview.
2. Three import paths still create immutable `DataRevision` rows inside the
   transaction that commits their source writes. That is an import audit record;
   it is not automatically the complete provenance of every derived KPI.
3. `runRecomputeForCompanies` has no batch `revisionId` option. One fan-out can
   evaluate workbook-only, external-feed, booking, manual, rollup and mixed-input
   formulas, so stamping the initiating workbook revision onto all of them would
   be false evidence. Recomputed observations remain `revisionId=null` and
   Provisional.
4. The lower-level writer keeps explicit future plumbing, but accepts a non-null
   revision only after proving the target company belongs to the organization,
   and then requiring either that revision's immutable `companyIds` contains
   the company or that the list is empty (the documented org-wide scope).
   Missing, foreign and sibling-company revisions fail before the
   IndicatorValue write with one opaque error.
5. Observation lineage can advance only after the KPI registry exposes a
   complete per-indicator dependency manifest and the orchestrator can construct
   the revision that explains that one value. Changing the LLM cannot replace
   this deterministic contract.

---

## 21. B2 technical security review and writer hardening (2026-07-18)

**Status: code boundary `implemented` + focused-tested; DB hardening `open`;
not owner-reviewed. No migration, live DB, production or paid provider action.**

The canonical writer now stores the same set semantics it hashes: company,
artifact and mapping ids are sorted and de-duplicated before both lookup and
create. Non-empty company scope is validated against `scope.organizationId` at
the writer boundary, including callers using an administrative/BYPASSRLS
client. `createdById` is likewise accepted only for a user in that organization;
a missing or foreign actor records null under the existing nullable/SetNull
contract. Dedupe queries match every canonical identity field in addition to
the hash, so a directly inserted row cannot be reused merely by copying a valid
`contentHash`.

Observation lineage now handles both documented scope forms without opening a
tenant gap: it first proves `companyId` belongs to `organizationId`, then accepts
either an explicit company membership or an empty `companyIds` org-wide
revision. The live-lineage fixture uses real in-org sibling/foreign companies,
ready for the existing opt-in RLS suite when an isolated target is available.

### 21.1 Evidence run in this slice

- `npx vitest run` over PeriodContext, DataRevision, the canonical writer,
  import-lineage, observation-lineage and all three wired import handlers →
  **8 files / 190 passed / 0 failed**.
- Full `npx vitest run --reporter=dot` → **520 files / 6,784 passed /
  58 skipped / 0 failed**.
- `npx tsc --noEmit` → 0.
- Live RLS/integration tests were not run: the available connection target was
  not proven isolated, and this slice was not authorized to mutate production
  or shared data.

### 21.2 Open findings — B2 must not be marked complete

1. The deployed DB trigger blocks immutable-field **UPDATE**, but unreferenced
   `DataRevision` rows can still be directly **DELETE**d. §22's unapplied
   candidate removes DELETE from the request role while preserving native-admin
   Organization cascade/tenant erasure; whether evidence must outlive deleting
   an organization remains an owner retention decision.
2. `lockedAt`, `reconciledAt` and `approvedAt` can currently be cleared,
   backdated or reordered. The owner must approve allowed transitions and actor
   semantics before a DB constraint/transition API is designed.
3. `supersedesId` is an id-only self-FK in the deployed DB, so it does not prove
   predecessor ownership. §22's unapplied trigger candidate rejects cross-org
   and self links without complicating Prisma/SetNull with a composite FK.
4. The shared tenant policy trusts `app.bypass_rls`, a custom GUC that an app
   role may be able to set. Dedicated administrative roles already have native
   `BYPASSRLS`; removing the GUC escape hatch is systemic RLS work, not a
   DataRevision-only patch, and needs a separately reviewed migration/role test.
5. Concurrent identical creates inside an interactive transaction remain
   integrity-safe via the unique constraint but one transaction may roll back
   on P2002; caller-level retry policy is deferred until real contention is
   observed.

These findings do not change financial formulas or values and do not justify a
production migration without explicit approval.

---

## 22. Isolated-validated DataRevision DB-hardening candidate (2026-07-18)

**Status: candidate `implemented` + hermetic-tested + isolated-live-tested;
not applied to any persistent/shared/production database; not owner-reviewed.**

### 22.1 Migration boundary

`prisma/migrations/20260718070000_data_revision_scope_guards/migration.sql`
contains only DataRevision-specific hardening:

1. Explicit `BEGIN`/`COMMIT` boundaries make the preflight, trigger and policy
   replacement one atomic change rather than a partially deployable DDL chain.
2. A preflight aborts if any existing child/predecessor link crosses
   organizations. It never silently blesses legacy false provenance.
3. A `BEFORE INSERT OR UPDATE` trigger rejects self-supersession and requires
   the predecessor to share `organizationId`. The id-only FK and one-to-one
   unique index remain unchanged.
4. The old `FOR ALL tenant_isolation` policy is replaced by explicit
   SELECT/INSERT/UPDATE policies. They use only `app.organization_id`, carry
   explicit write `WITH CHECK`, ignore `app.bypass_rls`, and intentionally
   provide no request-role DELETE policy.
5. `scripts/sql/create-app-role.sql` re-applies an explicit DELETE revoke after
   its broad CRUD grants. The revoke stays in the superuser provisioning script,
   not the Prisma migration: the migration role may have DDL/BYPASSRLS without
   owning the original grant, and a grantor mismatch must not abort deploy.
6. Native `budgetpro_admin BYPASSRLS` remains the sole documented escape hatch
   for Organization cascade/tenant erasure and break-glass operations.

### 22.2 Deliberately excluded

- Lifecycle timestamps remain mutable exactly as deployed. The specification
  names the fields but does not approve transition order, actor, reason,
  clearing or backdating semantics. Independent review recommended either
  temporary fail-closed timestamps or append-only lifecycle events; choosing
  between them is an owner decision.
- Other tenant tables still trust `app.bypass_rls`. Runtime has no production
  `{bypass:true}` caller (helper/tests only), and native admin already exists,
  but removing the clause from the 68 active production policies is a
  separate systemic migration that must preserve special global-row policies.
- The candidate does not change formulas, financial values, observation
  lineage, authentication or feature flags.

### 22.3 Isolated evidence and remaining production gate

- A disposable `postgres:16` container used loopback-only port binding, no host
  or named volume, and tmpfs for the data directory. All **18 migrations**
  replayed cleanly from zero; a separate predecessor database upgraded from 17
  to 18 with valid existing revisions; both ended `migrate status` up to date.
- A negative predecessor database contained an intentional cross-org chain.
  The candidate failed closed, was not marked finished, left the legacy `FOR
  ALL` policy intact and installed **0** candidate triggers.
- Project provisioning created real-shape roles: `budgetpro_app` was non-super,
  `NOBYPASSRLS` and lacked table DELETE; `budgetpro_admin` was non-super with
  native `BYPASSRLS` and retained DELETE for tenant erasure/cascade.
- Complete opt-in live gate: **3 files / 53 passed / 0 failed**, covering
  DataRevision, lineage and the shared RLS leak suite. The first run exposed and
  fixed two testability defects: Prisma hid the trigger message under SQLSTATE
  `foreign_key_violation`, and the multi-org fixture depended on seeded
  `Industry`; the trigger now uses `restrict_violation` and the level-1 fixture
  is seed-independent.
- Full default Vitest: **521 files / 6,788 passed / 62 skipped / 0 failed**.
- RLS coverage scanner: **179 routes / 70 org-scoped delegates / 0 unwrapped**.
- `npx tsc --noEmit` and `npx prisma validate` → 0.
- The exact disposable container and tmpfs data are removed after this gate;
  no shared/production DB, production credential, authentication setting,
  paid provider, push or deploy is involved.

Before production application: obtain explicit owner authorization, perform a
read-only preflight for invalid legacy chains, take the approved backup, apply
with the production migration role, re-run role/catalog/live-RLS checks, and
record the deployed SHA and migration count. Lifecycle semantics and the
remaining systemic `app.bypass_rls` policies are separate open decisions.

---

## 23. DataRevision production hardening rollout (2026-07-18)

**Status: owner-authorized, deployed and production-catalog-verified; B2 stays
in progress because lifecycle semantics and the systemic GUC-policy migration
remain separate decisions.**

- Release `54f0b24375b03edeba34daa70706ee41fc34d697` passed the complete
  GitHub Actions `CI` run `29643432036`. Production `HEAD` and
  `.deploy-revision` matched that exact SHA after rollout.
- The read-only preflight found zero invalid cross-organization supersession
  links and zero existing DataRevision rows. The deploy created backup
  `/opt/budgetpro/backups/pre-deploy-2026-07-18T124926Z-54f0b24375b0.sql.gz`
  before applying migration `20260718070000_data_revision_scope_guards`.
- Production reports 18 completed migrations and three DataRevision policies:
  SELECT `tenant_isolation`, INSERT `tenant_insert`, and UPDATE
  `tenant_update`. There is no DELETE/FOR ALL policy and none references
  `app.bypass_rls`.
- Both `data_revisions_immutable` and
  `data_revisions_supersedes_org_guard` are enabled. `budgetpro_app` is a
  non-superuser with `NOBYPASSRLS`; `budgetpro_admin` is a non-superuser with
  native `BYPASSRLS`.
- The old broad table grant had left `budgetpro_app` with DELETE even though
  RLS denied it. Production explicitly revoked that grant and the follow-up
  privilege check returned false. `scripts/sql/create-app-role.sql` already
  makes this revoke idempotent after its broad CRUD/default grants.
- App, PostgreSQL and nginx remained healthy; both runtime app/admin DB URLs
  were present. The public unauthenticated smoke passed 8/8, including 401 for
  companies, analytics and SSE data routes.
- Docker builder-cache cleanup reclaimed 53.22 GB without removing images,
  running containers or volumes. Disk use was 22% after the rebuilt image was
  exported.
- No password/passwordHash, authentication setting, financial record, paid
  provider, or Risk Terminal V2 feature flag changed in this rollout.

The next B2 slice is not another deployment of this migration. It is the owner
decision on lifecycle transition/actor semantics; the 68 remaining production
tenant policies that trust the user-settable GUC are a separate systemic RLS
migration with their own rollback and special global-row review.

---

## 24. Native-bypass audit + global catalog candidate (2026-07-18)

**Status: audit complete; runtime prevention and global-catalog candidate
implemented, hermetic-tested and isolated-live-tested; not applied to
production and not owner-reviewed.**

Production read-only catalog evidence corrected the approximation: 70 tables
have RLS, exactly 68 active policies trust the user-settable
`app.bypass_rls` GUC, DataRevision is already native-bypass-only, and
`industries` uses `FOR ALL USING (true)`. The last two global shapes were
more urgent than a mechanical 68-table rewrite: all 110 indicator definitions
are global and the app role can currently CRUD them; the 14-row industries
catalog is also app-role CRUD despite having no tenant column.

The first candidate is therefore deliberately narrow:

- `withOrgScope` no longer accepts or sets a custom-GUC bypass; stale untyped
  callers fail closed and the live leak suite now proves cross-org admin reads
  through the native admin client.
- The unsafe historical RLS generator is retired.
- Migration `20260718133000_global_catalog_rls_guards` splits global-definition
  SELECT from tenant-only DML and makes industries request-role SELECT-only.
- `create-app-role.sql` re-applies an industries DML revoke after its broad
  grants.
- A new opt-in live suite proves global+own visibility, foreign override
  hiding even after `SET LOCAL app.bypass_rls=true`, global write denial,
  own-override CRUD, and industries read-only privileges.

Evidence: focused default **3 files passed + 1 skipped / 16 passed / 6 skipped**;
full Vitest **522 files passed / 6,790 tests passed / 68 skipped / 0 failed**;
`tsc --noEmit`, Prisma validate and the **158-page** Next.js production build
clean. Disposable PostgreSQL 16 proved all **19 migrations** from zero, valid
18→19 upgrade, and intentional predecessor catalog drift failing closed with
an unchanged policy fingerprint. Live RLS gate: **4 files / 59 passed**. The
container/tmpfs was removed.

The systemic work is not complete: production still has 68 GUC policies; the
candidate would reduce that to 67. The audit also found 22 scanner opt-outs,
26 API routes importing `prismaAdmin`, production client fallbacks that only
log, append-only tables hidden behind generic FOR ALL policies, FK-derived
tenant-child tables without direct RLS, and an auth ambiguity where email is
org-unique but login searches globally without an org selector. Authentication
was not changed; the duplicate-email contract is an owner decision before the
users cohort. Full findings and cohort gates are in
`docs/RLS_NATIVE_BYPASS_AUDIT.md`.

---

## 25. Evidence-core RLS candidate (2026-07-18)

**Status: operation audit complete; minimal audit/snapshot candidate implemented,
hermetic-tested and isolated-live-tested; not applied to production and not
owner-reviewed.**

The independent operation inventory rejected a mechanical evidence-table
rewrite. Request traffic only reads and inserts `audit_events` and
`period_snapshots`, so those two form the smallest safe slice. Audit retention
and tenant erasure remain native-admin operations; deleting a User must still
null `actorUserId` through the existing FK. A PeriodSnapshot is a signed
fingerprint: UPDATE is invalid, while unlock/edit/relock intentionally inserts a
second historical row.

Migration `20260718143000_evidence_core_rls_guards` therefore:

- preflights the exact single `FOR ALL`/GUC predecessor on both tables and
  aborts before change on catalog drift;
- exposes only tenant SELECT and INSERT policies, with no custom-GUC bypass;
- preserves `audit_events_notify_trg`;
- rejects every PeriodSnapshot UPDATE at the DB layer;
- pairs with idempotent request-role UPDATE/DELETE revokes in
  `create-app-role.sql`; native admin keeps retention/cascade DELETE.

Trade ledger is deliberately not in this slice. Its legitimate one-time void
UPDATE needs a transition trigger, and the schema currently has no Organization
FK or same-organization spend-type constraint. Production is clean
(8 rows, 0 partial voids, 0 orphan organizations and 0 cross-org spend types),
but those constraints require a standalone migration and schema review.
`ai_token_usage` is also separate: it is mutable native-admin upsert accounting,
not append-only evidence, and admin-client fail-fast must precede tightening it.

Read-only production evidence for the current two tables: 161 audit rows,
0 cross-organization actors, 0 PeriodSnapshots. The predecessor policy/grant
fingerprint exactly matches the candidate assumptions; the audit NOTIFY trigger
is present.

Evidence:

- focused default: **6 passed / 8 live skipped**;
- disposable PostgreSQL 16: all **20 migrations** from zero, valid 19→20
  upgrade, intentional predecessor-policy drift rejected with the policy
  fingerprint unchanged, and expected post-stack **65** GUC policies;
- real-shaped `budgetpro_app`/native-admin live gate:
  **5 files / 67 passed**;
- full Vitest: **523 files passed / 6,796 tests passed / 76 skipped / 0 failed**;
- TypeScript and Prisma validate clean; RLS scanner
  **179 routes / 70 org-scoped delegates / 0 unwrapped**;
- Next.js production build generated **158/158** static pages;
- disposable containers and tmpfs data were removed.

The two stacked candidates are not deployed. Production remains on
`ded040c2`, 18 migrations and 68 GUC-trusting policies. No password,
passwordHash, authentication flow, financial record, paid provider or feature
flag changed.

---

## 26. Trade spend-ledger RLS candidate (2026-07-18)

**Status: standalone candidate implemented, hermetic-tested and
isolated-live-tested; not applied to production and not owner-reviewed.**

The ledger cannot use a generic append-only evidence policy because the request
path legitimately performs one UPDATE: a one-time void. The standalone slice
also closes two pre-existing integrity gaps that application checks alone could
not guarantee.

Migration `20260718153000_trade_spend_ledger_guards`:

- adds `TradeSpendLedger.organizationId → Organization.id` with tenant-erasure
  cascade and organization-id update restriction;
- rejects a missing or cross-organization spend type in a fixed-search-path
  `SECURITY DEFINER` write trigger;
- permits inserts only when both void fields are null and permits UPDATE only
  when every non-void value is byte-equivalent and both void fields move
  together from null to non-null exactly once;
- replaces the broad GUC policy with tenant SELECT, unvoided INSERT and
  one-time void UPDATE, with no request DELETE policy;
- pairs with idempotent provisioning that revokes request-role DELETE and
  table-wide UPDATE, then grants UPDATE only on `voidedAt`/`voidedBy`.

Evidence:

- Prisma validate/generate and the 6-test hermetic migration contract pass;
- disposable PostgreSQL 16 replayed all 21 migrations from zero;
- a valid predecessor upgraded 20 → 21 with its existing ledger row preserved;
- an intentional cross-org spend-type row stopped the migration atomically,
  leaving the legacy policy, row and absence of the candidate FK/trigger intact;
- real-shaped app/admin roles passed 6 live RLS files / 74 tests;
- post-stack catalog: 79 policies, 64 still trusting the legacy GUC; app Trade
  DELETE=false, void-column UPDATE=true, amount UPDATE=false;
- full Vitest: 524 files passed + 7 skipped, 6,802 tests passed + 83 skipped;
- TypeScript, Prisma, RLS coverage (179 routes / 0 unwrapped) and the 158-page
  production build are clean;
- the temporary container, tmpfs and predecessor migration copy were removed.

Deferred Trade integrity is explicit: `createdBy`/`voidedBy` and optional
campaign/dimension IDs remain scalar references until their same-org and delete
semantics are owner-approved.

The three stacked candidates are not deployed. Production remains on
`ded040c2`, 18 migrations and 68 GUC-bypass policies. No credential,
passwordHash, authentication flow, financial row, paid provider or production
setting changed. The next systemic slice is `ai_token_usage`, gated on
native-admin fail-fast and explicit correction/monotonicity semantics.

---

## 27. AI token-accounting RLS candidate (2026-07-18)

**Status: operation audit complete; candidate implemented, hermetic-tested and
isolated-live-tested; not applied to production and not owner-reviewed.**

Request traffic only reads `ai_token_usage`; every runtime writer is the atomic
native-admin upsert in `recordUsage`. The selected contract therefore exposes
tenant SELECT only to the request role. It does not impose strict monotonicity:
native admin may correct over-counting downward, but no stored counter may be
negative.

Migration `20260718163000_ai_token_usage_guards` removes the user-settable GUC
bypass, adds the validated non-negative constraint, and pairs with idempotent
app-role INSERT/UPDATE/DELETE revokes. Runtime budget checks now fail before a
paid provider call when RLS is active without `DATABASE_URL_ADMIN`; usage
increments must be non-negative safe integers.

Production read-only evidence is 7 daily rows, 36 calls, 840,507 input tokens,
61,859 output tokens, zero negative rows and zero orphan organizations. The
production app role still has CRUD because this candidate is not deployed.

Evidence: 29 focused tests; 22 migrations fresh; valid 21→22 upgrade preserving
the existing usage total; intentional negative predecessor rejected atomically;
7 live RLS files / 80 tests; catalog 79 policies / 63 remaining GUC policies;
full default 525 files passed + 8 skipped / 6,814 tests passed + 89 skipped;
clean TypeScript, Prisma, 179-route RLS scanner and 158-page production build.
The disposable database/tmpfs was removed.

All four stacked candidates remain unapplied. Production remains on
`ded040c2`, migration 18 and 68 GUC-bypass policies. Identity/config is next;
the `users` table remains blocked on choosing globally unique versus
organization-qualified login.

---

## 28. User layout-preference RLS candidate (2026-07-18)

**Status: auth-neutral identity/config slice implemented, hermetic-tested and
isolated-live-tested; not applied to production and not owner-reviewed.**

The login-sensitive `users` policy remains unchanged. This slice only hardens
`user_layout_preferences`: exact tenant CRUD policies replace the legacy
custom-GUC bypass, while paired fixed-search-path triggers enforce same-org
user ownership and reject moving a user who still owns layouts. Shared
transaction advisory locking closes the concurrent layout-insert/user-move
race; migration table locks keep its preflight stable.

The DB boundary is intentionally tenant-level. Because every request uses one
shared `budgetpro_app` role, there is no trusted DB identity for the current
human user. Existing layout routes continue to filter every read/upsert/delete
by `session.userId`; user-level RLS needs a separate actor-context design.

Evidence:

- hermetic migration contract: 5/5;
- disposable PostgreSQL 16: all 23 migrations fresh;
- valid 22→23 upgrade preserved the predecessor layout;
- cross-org data drift and unexpected policy drift both failed atomically with
  the predecessor policy/data and absence of candidate guards intact;
- concurrency regression proved the user move waits and is rejected after the
  layout insert commits;
- real-shaped app/admin gate: 8 live RLS files / 88 tests;
- catalog: 82 policies, 62 remaining GUC policies, four layout policies, two
  enabled SECURITY DEFINER guards, app NOBYPASSRLS and no direct guard EXECUTE;
- full default: 526 files passed + 9 skipped / 6,819 tests passed + 97 skipped;
- Prisma validate, TypeScript, 179-route RLS scanner and 158-page production
  build clean;
- disposable container/tmpfs and temporary migration copy removed.

All five candidates remain unapplied. Production was not deployed or migrated
and remains on the last verified `ded040c2`, migration 18 and 68 GUC policies;
remote-dev currently lacks direct production SSH authorization. No password,
passwordHash, login/JWT behavior, role, financial row or paid provider changed.
`budget_departments` is next after its FK-consumer audit. `users` remains
blocked on the global-email versus organization-qualified login decision.

---

## 29. Budget department RLS candidate (2026-07-18)

**Status: auth-neutral configuration slice implemented, hermetic-tested and
isolated-live-tested; not applied to production and not owner-reviewed.**

The operation audit found no physical department delete in request traffic:
the API retires a department with `isActive=false`. The candidate therefore
exposes tenant SELECT/INSERT/UPDATE only and revokes request-role DELETE. It
does not change the existing four SET NULL and three CASCADE FK actions used by
native-admin tenant erasure.

The seven department consumers previously accepted an ID from another
organization because every FK referenced only `departmentId`. Nine
fixed-search-path guards now enforce same-org department references, same-org
department-owner users, and both parent reassignment sides. Matching transaction
advisory locks close both directions of the insert/reassignment race. No users
policy, login lookup, email uniqueness, passwordHash, JWT or role behavior
changed.

Evidence:

- hermetic migration contract: 5/5;
- disposable PostgreSQL 16: all 24 migrations fresh;
- valid 23→24 upgrade preserved the department plus all seven consumer types;
- cross-org predecessor data and unexpected policy drift failed atomically;
- concurrency regression passed in both consumer-insert/department-move
  directions;
- real-shaped app/admin gate: 8 live RLS files / 78 tests;
- catalog: 84 policies, 61 remaining GUC policies, three department policies
  and nine enabled SECURITY DEFINER guards;
- full default: 527 files passed + 10 skipped / 6,824 tests passed + 103
  skipped;
- Prisma validate, TypeScript, 179-route RLS scanner and 158-page production
  build clean;
- disposable containers/tmpfs and temporary migration copies removed.

All six stacked candidates remain unapplied. Production remains on the last
verified `ded040c2`, migration 18 and 68 GUC policies; direct SSH verification
from remote-dev is unavailable. No production data, financial row,
authentication setting, password or paid provider changed. The broad app-role
DELETE grant on `Organization` is recorded as a separate physical-erasure
boundary. `budget_cost_types` is next after an equivalent FK-consumer audit;
`users` remains blocked on the global-email versus organization-qualified
login decision.

---

## 30. Budget cost-type RLS candidate (2026-07-18)

**Status: auth-neutral configuration slice implemented, hermetic-tested and
isolated-live-tested; not applied to production and not owner-reviewed.**

Request traffic never physically deletes a cost type: the endpoint retires it
with `isActive=false`. The candidate exposes tenant SELECT/INSERT/UPDATE only,
revokes request-role DELETE and leaves the four SET NULL plus one CASCADE FK
actions unchanged for native-admin erasure.

Five consumer tables previously accepted a cost-type ID from another
organization because their FKs referenced only `costTypeId`. Five
fixed-search-path write guards now enforce same-org references, and a paired
parent guard rejects moving a referenced cost type across organizations.
Matching namespaced advisory locks close both insert/reassignment race
directions. No auth, user policy or financial row is changed.

Evidence:

- hermetic migration contract: 5/5;
- disposable PostgreSQL 16: all 25 migrations fresh;
- valid 24→25 upgrade preserved the parent plus all five consumer types;
- cross-org predecessor data and unexpected policy drift failed atomically;
- both consumer-insert/cost-type-move concurrency directions passed;
- real-shaped app/admin gate: 9 live RLS files / 84 tests;
- catalog: 86 policies, 60 remaining GUC policies, three cost-type policies and
  six enabled SECURITY DEFINER guards;
- full default: 528 files passed + 11 skipped / 6,829 tests passed + 109
  skipped;
- Prisma validate, TypeScript, 179-route RLS scanner and 158-page production
  build clean;
- disposable containers/tmpfs and temporary migration copies removed.

All seven stacked candidates remain unapplied. Production remains on the last
verified `ded040c2`, migration 18 and 68 GUC policies; direct SSH verification
from remote-dev is unavailable. No production data, financial row,
authentication setting, password or paid provider changed. Broad app-role
DELETE on `Organization` remains a separate owner-reviewed boundary. The next
auth-neutral target requires a fresh operation/FK audit; `users` remains
blocked on the global-email versus organization-qualified login decision.

---

## 31. Budget direction-template RLS candidate (2026-07-18)

**Status: auth-neutral configuration slice implemented, hermetic-tested and
isolated-live-tested; not applied to production and not owner-reviewed.**

The direction-template runtime requires full CRUD, including physical DELETE.
The candidate therefore replaces the legacy FOR ALL/custom-GUC policy with
exact tenant SELECT/INSERT/UPDATE/DELETE. It also closes the model gap by
adding the missing Organization relation/FK with CASCADE tenant-erasure
semantics.

Department and cost-type references keep their existing SET NULL behavior.
Their two same-organization SECURITY DEFINER guards were already installed by
the preceding department and cost-type candidates; this migration verifies
their exact fixed-search-path catalog shape and refuses to proceed without
them. No auth, user policy, role, password or financial row is changed.

Evidence:

- hermetic migration contract: 5/5;
- focused template runtime + migration gate: 4 files / 27 passed;
- disposable PostgreSQL 16: all 26 migrations fresh;
- valid 25->26 upgrade preserved the predecessor template and both references;
- intentional orphan-data and unexpected-policy drift failed atomically with
  the predecessor policy and absence of candidate FK/policies intact;
- real-shaped app/admin gate: 9 live RLS files / 62 passed;
- catalog: 89 policies, 59 remaining GUC policies, four template policies, one
  validated Organization FK and two enabled fixed-path predecessor guards;
- full default: 529 files passed + 12 skipped / 6,834 tests passed + 114
  skipped;
- Prisma validate/generate, TypeScript, 179-route RLS scanner and 158-page
  production build clean;
- disposable container/tmpfs and temporary migration copy removed.

All eight stacked candidates remain unapplied. Production remains on the last
verified ded040c2, migration 18 and 68 GUC policies; direct SSH verification
from remote-dev is unavailable. No production data, authentication setting,
password, paid provider, migration or deployment changed. Existing template
mutations are authenticated but have no manager-role gate; reviewing that
authorization is a separate auth-sensitive decision. budget_sections is the
next auth-neutral candidate after a plan-reference/race audit; users and
budget_department_owners remain auth-sensitive.

---

## 32. Budget section RLS rollout (2026-07-18)

**Status: auth-neutral configuration slice implemented, hermetic-tested,
isolated-live-tested, owner-authorized and production-verified.**

Budget-section reads remain available to authenticated viewers; physical
create/update/delete remains manager+ and period-lock protected in the existing
API transactions. The candidate replaces the legacy FOR ALL/custom-GUC policy
with exact tenant CRUD, adds the missing Organization relation/FK, and keeps the
existing plan CASCADE semantics.

Paired fixed-search-path guards now enforce that every section and plan belong
to the same organization and reject moving a referenced plan. Matching advisory
locks close both section-write/plan-move race orderings. Organization and plan
DELETE cascades remain valid. Organization primary-key rename is intentionally
blocked while sections exist; IDs are runtime immutable and this is the
fail-closed boundary.

Evidence:

- hermetic migration contract: 6/6;
- existing RBAC/period-lock handlers plus migration: 3 passed files + 1 skipped,
  21 passed tests + 7 skipped;
- disposable PostgreSQL 16: all 27 migrations fresh;
- valid 26->27 upgrade preserved the predecessor plan/section;
- cross-org/orphan predecessor data and unexpected-policy drift failed
  atomically with no candidate FK/policies/guards left behind;
- both concurrency directions, direct CRUD, plan cascade and Organization
  cascade passed under real-shaped admin/app roles;
- full live RLS: 10 files / 69 passed;
- catalog: 92 policies, 58 remaining GUC policies, four section policies, one
  validated Organization FK and two enabled fixed-path guards;
- the full parallel live gate also hardened expected-rejection observation in
  the older department/cost-type race tests, eliminating a false unhandled
  Promise window without changing their outcomes;
- full default: 530 files passed + 13 skipped / 6,840 tests passed + 121
  skipped;
- Prisma validate/generate, TypeScript, 179-route RLS scanner and 158-page
  production build clean;
- disposable container/tmpfs and temporary migration copy removed.

Release f1bce29e9524e2e73a8a6d4566f06cc5f25c11e1 passed exact-SHA GitHub
Actions CI run 29658383468 and was deployed after verified root-only backup
backups/pre-deploy-2026-07-18T200132Z-f1bce29e9524.sql.gz. Production HEAD and
.deploy-revision match; app/db/nginx are healthy; all 27 migrations are
applied. Read-only catalog verification confirms 92 policies, 58 remaining GUC
policies, four exact budget_sections CRUD policies, two enabled same-org
plan/section guards, both CASCADE FKs, budgetpro_app NOBYPASSRLS and
budgetpro_admin BYPASSRLS. External unauthenticated smoke passed 8/8. No
financial data, auth setting, password/passwordHash, paid provider or feature
flag changed. The next auth-neutral target needs a fresh operation/FK audit;
users and budget_department_owners remain auth-sensitive.

---

## 33. Risk Terminal Stage C shell seam — C2/C3 (2026-07-18)

**Status: C2/C3 implemented, tested, visually inspected and production-verified.
C4 remains partial because only one representative CustomEvent was browser-driven.
No Decision shell or V2 view is enabled.**

The route now owns a continuously mounted `TerminalOverlayHost`. It contains
the same 16 event-driven modal/export mounts that previously lived inside
`PanelGrid`, preserving their existing `terminal:*` CustomEvent contracts.
The host retains the old SSR/client hydration gate, so server rendering and first-paint
hydration do not start browser-only listeners earlier than before.

The unchanged 2×2 legacy terminal is exported explicitly as
`ExpertWorkspace`; `PanelGrid` remains a compatibility alias for existing
callers and SSR tests. Mobile viewport guidance, first-run Expert help, all
splitter keys, keyboard handling, market/audit tickers and the four financial
panels remain owned by Expert. The route mounts the overlay host before Expert,
creating the C2/C3 seam without adding view routing or reading the dormant V2
flags.

Evidence:

- TypeScript `tsc --noEmit`: clean;
- focused `TerminalOverlayHost` + `PanelGrid` SSR: 2 files / 5 tests passed;
- full Vitest: 531 files passed + 13 skipped / 6,843 tests passed + 121 skipped;
- Next.js production build: 158 routes generated successfully;
- source contract proves all 16 global mounts occur exactly once in the host,
  no longer inside Expert, and the route mounts host before Expert;
- SSR contract proves the host emits no pre-mount markup and the legacy grid
  keeps its hydration placeholder;
- no formula, KPI, threshold, value, database, migration, password,
  authentication setting, paid provider or production feature flag changed.

The local visual command could not target BudgetPro because port 3000 belongs to
an unrelated IT-audit application; that foreign process was not stopped. After
deployment, the production visual suite authenticated and rendered all three
surfaces. Linux baselines were absent from Git (the documented cross-platform
gap), so the first run created temporary actuals rather than comparing pixels.
The terminal actual was inspected at 1280×720: Company Tree occupied the upper
left (x257–614, y168–441), HeatMap the upper right (x620–1279, y168–441),
Indicator Detail the lower left (x257–764, y447–668), and Company Snapshot the
lower right (x770–1279, y447–668); no panel was missing or displaced. A second
run against those temporary Linux snapshots passed 3/3, proving deterministic
production rendering; the uncommitted temporary baselines were then removed.

Release `a7b6602a003eeaab3e35ccc0d15757e47b1d5514` passed exact-SHA GitHub
Actions CI run `29660763787` (secret scan, Prisma, TypeScript, RLS gate, M7,
full Vitest and build). Backup
`/opt/budgetpro/backups/pre-deploy-2026-07-18T211057Z-a7b6602a003e.sql.gz`
is gzip-valid, 982,137 bytes and mode 0600. Production HEAD and
`.deploy-revision` match; app/db are healthy, all 27 migrations are current,
and runtime reports `budgetpro_app` with no bypass. External unauthenticated
smoke passed 8/8. Authenticated smoke returned 200 for the terminal, companies,
matrix and audit endpoints; found all four panel headers; opened the route-owned
Help overlay via `terminal:open-help`; and recorded zero console, page or 5xx
errors on desktop/mobile. The 390px screenshot also confirms the pre-existing
mobile P1 remains: the global sidebar consumes most width and Expert panels are
crushed into narrow strips. C1/C5 and modern Decision UI remain blocked on the
certified Stage B/provider contracts; alerts still originate in HeatMap, so
Expert must not yet unmount.

---

## 34. Risk Terminal Expert mobile P1 guard (2026-07-18)

**Status: implemented, unit/SSR/build-tested, visually verified and
production-verified.**

The old mobile behavior rendered the 256 px dashboard sidebar and then squeezed
the four Expert panels into the remaining phone width. The dismissible
`MobileViewportBanner` warned about that failure but did not prevent it.
`ExpertViewportGate` now implements the approved responsive contract:

- below 768 px, the route shows the EN/RU/AZ desktop recommendation and a
  keyboard/touch-accessible 44 px `Back to Budgeting` action;
- the terminal sidebar is hidden only on that mobile route;
- Expert panels, deep-link handling and terminal toolbars are not mounted on
  mobile; the route-owned overlay host remains mounted independently, but its
  company/matrix data is now loaded only when an overlay event needs it;
- at 768 px and above, the same route children and `ExpertWorkspace` are
  mounted, with the existing splitter keys, shortcuts and four panels intact.

Evidence before release:

- targeted viewport/layout/host/SSR suite: 4 files / 13 tests passed;
- TypeScript `tsc --noEmit`: clean;
- full Vitest: 531 files passed + 13 skipped / 6,839 tests passed + 121 skipped;
- Next.js production build: 158 routes generated successfully;
- JSON parsing passed for all three message bundles;
- `git diff --check`: clean.

The required local visual gate was attempted against a separate port so the
unrelated process on port 3000 was not disturbed. The production-mode local app
could render the login page, but authentication failed before terminal
navigation because the configured local `budgetpro_admin` database credential
is stale. No database credential, password/passwordHash or authentication
setting was changed to work around that boundary.

Exact release `f313876179aac5e837fe98cb4082647a5c0eb1c4` passed GitHub Actions
CI run `29662572676` and was deployed after gzip-valid root-only backup
`/opt/budgetpro/backups/pre-deploy-2026-07-18T220952Z-f313876179aa.sql.gz`
(983,692 bytes, mode 0600). Production HEAD and `.deploy-revision` match; app
and DB are healthy, all 27 migrations are current, and runtime uses
`budgetpro_app` with no bypass. External unauthenticated smoke passed 8/8;
authenticated terminal, companies, matrix and audit checks returned 200.

The production browser gate verified both target contexts with zero console,
page or 5xx errors. At 390×844 the fallback occupies x0–390/y40–844, the title
is fully visible at x24–366/y318–382, the sidebar is hidden and no F1–F4 panel
exists. At that release the independent overlay host still kept its pre-existing
shared company/matrix subscriptions; the follow-up slice below removes that
mobile startup cost without unmounting the event listeners. At
1280×720 all four panels render in the preserved 2×2 geometry: F1
x256–612/y169–440, F2 x618–1280/y169–440, F3 x256–765/y446–668 and F4
x771–1280/y446–668. The mobile fallback is hidden on desktop. Because Git has no
Linux baseline, the exact production image was written temporarily; the repeat
visual run passed 1/1 and the temporary file was removed from the worktree.

No financial logic, formula, KPI, threshold, value, database row, migration,
paid provider, Anthropic/Google call, Decision UI or V2 feature flag changed.
C1/C5 and the modern responsive Decision shell remain blocked on their certified
provider/trust contracts.


---

## 35. Risk Terminal mobile overlay data deferral (2026-07-18)

**Status: implemented, code/browser-tested and production-verified.**

The route-owned overlay host remains continuously mounted, so all existing
`terminal:*` CustomEvents stay registered. Closed event-driven panels now pass
an `enabled` gate to the shared company/matrix hooks. PDF and XLSX listeners
load the selected-period matrix and company snapshot only after the export
event. Desktop AI subscriptions retain their session-wide background matcher;
on the mobile Expert fallback they stay cold until their manager is opened.

Measured production baseline before the change at 390×844: the route rendered
zero Expert panels but still downloaded `/api/indicators/matrix` (86,185 body
bytes, 267 ms) and `/api/companies` (36,486 body bytes, 126 ms), about 122.7 KB
combined. The new runtime contract test proves neither endpoint is called when
the mobile overlay host mounts, then proves the existing compare and alerts
events activate the required matrix/company request.

Evidence before release: targeted overlay/export/hooks suites 12 files / 114
tests passed; new disabled-to-enabled hook tests passed; full Vitest 532 files
passed + 13 skipped / 6,842 tests passed + 121 skipped; TypeScript is clean;
the Next.js production build generated 158 routes. No visual/CSS geometry,
financial logic, formula, KPI, threshold, value, database, migration,
password/passwordHash, authentication setting, paid provider or V2 flag changed.


Exact release `db220a1fd8a4dee316193f2a6e770afdfdf57062` passed GitHub
Actions CI run `29664428834` (secret scan, Prisma, TypeScript, RLS, M7,
full Vitest and build). It deployed after gzip-valid root-only backup
`/opt/budgetpro/backups/pre-deploy-2026-07-18T231047Z-db220a1fd8a4.sql.gz`
(983,759 bytes, mode 0600). Production HEAD and `.deploy-revision` match; app
and DB are healthy, all 27 migrations are current, and runtime uses
`budgetpro_app` with no bypass. External unauthenticated smoke passed 8/8.

The authenticated 390×844 browser check recorded **zero** initial company or
matrix resources, zero Expert panels, the visible mobile fallback and no
sidebar. That removes the measured 122,671 body bytes (100% of the two target
payloads) before user action. Dispatching `terminal:open-compare` and
`terminal:open-alerts` opened one dialog each and then loaded the matrix
(86,185 bytes) and companies (36,486 bytes), proving listener compatibility.
At 1280×720 all four F-key panels remain present in their previous geometry:
F1 x256/y169/w356.30/h270.88, F2 x618.30/y169/w661.70/h270.88, F3
x256/y445.88/w509/h221.63 and F4 x771/y445.88/w509/h221.63. The desktop
fallback is hidden; console, page and 5xx error lists were empty.
