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
| A4 | Server-resolved operational feature flags (design + resolver) | not started |
| A5 | Minimal Legacy/Provisional presentation — stale/untraced values must not read decision-grade; **no financial value changes** | not started |
| A6 | Focused tests proving stale/untraced cannot look decision-grade | not started |

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
