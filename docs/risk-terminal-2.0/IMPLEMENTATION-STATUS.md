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
