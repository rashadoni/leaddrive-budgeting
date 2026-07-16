# Risk Terminal 2.0 — implementation status

Living execution record for Phase 10. Updated after every slice.
Status vocabulary is the handoff's (§3.1): `implemented`, `tested`,
`visually verified`, `reconciled`, `methodology-approved`, `shadow-only`,
`provisional`, `not tested`, `blocked`.

**A task is never `completed` because code compiles.** If a check named below
was not actually run in the turn that claims it, the status is `not tested`.

---

## 1. Protected paths (git status at 2026-07-15, session start)

These are the user's own dirty/untracked files. **Do not stage, edit, revert or
stash them** (the README edit was stashed once during a deploy earlier today and
restored — that was a one-off, and it is not a precedent).

```text
 M .claude/settings.json
 M docs/risk-terminal-2.0/README.md          # user's own edit: RU summary link + typo
?? docs/risk-terminal-2.0/00-EXECUTIVE-SUMMARY-RU.md
?? docs/risk-terminal-2.0/05-TEST-UAT-ROLLOUT.md
?? docs/risk-terminal-2.0/CLAUDE-CODE-HANDOFF.md
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

### D-1 — Slice granularity: the task prompt and the handoff disagree ⛔

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

**Resolution taken:** proceed with **exactly one slice — Stage A per §11**, and
treat B-E as queued-not-started. This follows the documentation, which the
prompt itself names as the source of truth. Stage B remains blocked until Stage
A is reviewed (§5).

**Owner input:** Stage A approved by the owner 2026-07-15. B-E remain queued.

### D-2 — KPI methodology (expected, per handoff §9)

Not yet enumerated; will be filled from `03-DATA-KPI-TRUST-SPEC.md` while
building the KPI Registry (Stage B). Any KPI without an approved definition ships
as `provisional` with a recorded question — never with an invented formula.

---

## 3. Phase 10 queue (dependency-ordered, from handoff §5)

Derived strictly from Stages A-E. No invented scope.

### Stage A — documentation/ADR + protective mode  ← current
| # | Task | Status |
|---|---|---|
| A1 | Add Phase 10 section to `docs/ROADMAP.md` (only items actually started) | implemented — owner-reviewed 2026-07-16 |
| A2 | `DESIGN.md` from the approved UI/UX spec | implemented — owner-reviewed 2026-07-16, gaps recorded in §5 |
| A3 | ADRs: Trust Core, Experience Shell | implemented — owner-reviewed 2026-07-16, T-7 corrected, gaps recorded in §5 |
| A4 | Server-resolved operational feature flags (design + resolver) | implemented + tested (unit), not reviewed |
| A5 | Minimal Legacy/Provisional presentation — stale/untraced values must not read decision-grade; **no financial value changes** | implemented + tested + visually verified, not reviewed — surface badge only; per-cell demotion is an owner decision (§7) |
| A6 | Focused tests proving stale/untraced cannot look decision-grade | implemented + tested (27 unit tests), not reviewed |

*Gate: Stage A needs review before Stage B or any modern root UI (§5).*

### Stage B — trust core (blocked on Stage A review)
B1 canonical statement mart/service (pilot scope) · B2 PeriodContext + DataRevision ·
B3 exact M/Q/YTD/FY/LTM invalidation · B4 KPI Registry + first 25-35 approved KPIs ·
B5 immutable observation + lineage · B6 Risk × Confidence + abstention ·
B7 decision-grade event eligibility. *Each needs golden reconciliation + owner decisions.*

### Stage C — zero-visual-change UI extraction (blocked on B contracts)
C1 pure view-model builders · C2 `TerminalOverlayHost` · C3 `ExpertWorkspace` isolation ·
C4 preserve events/shortcuts/layout keys/visual output · C5 overview façade/provider.

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
without owner authorization.** Note §5.3's caveat: A5's `stale/untraced` rule
will not catch the EDEN per-ha observations, which are fresh and traceable and
withheld for unapproved methodology.

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

**Status: `implemented` + `tested` (16 unit + 8 handler + 4 matrix + 3 trigger +
6 gate; 36 live-DB). `reviewed` — by an independent adversarial subagent, which
found three real defects, all fixed below. Not owner-reviewed.
Lineage is now *recorded* on one import path. Provisional is NOT lifted.**

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
  is the closest real identity. Deliberately **not** the filename — two
  unrelated workbooks are both `budget.xlsx`, and a filename-keyed revision
  would hash two source states alike and hand the second import the first one's
  lineage.
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
| **3** | **Parent rollups over-stamped.** The trigger fans out to every level-1 company org-wide; one child's import would stamp every holding's rollup with a revision naming one child. | Only companies the caller named are traced. Rollups stay untraced until a revision can speak for an aggregate. |

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
- **Four import paths remain untraced** (apply-multi, apply-multi-entity,
  budget, multi-file-orchestrator). Widening is mechanical now the contract
  holds, but each needs its own revision scope; a wrong `companyIds` would be a
  false claim, not a gap.
- **A staging id is not a byte fingerprint.** Raw upload bytes are not retained
  (`xlsxTempPath` is a temp path the caller cleans up), so `contentHash` must
  **not** be described as a file-content hash. Exact artifact provenance needs a
  hash of the applied workbook bytes.
- **Two period vocabularies meet.** The revision's range is month keys
  (`2026-01`..`2026-12`); the observations it stamps carry the FY key `2026`.
  Both are valid; they do not compare as strings (`'2026' < '2026-01'`). Nothing
  queries that way today; anything that starts must go through `parsePeriodKey`.
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
