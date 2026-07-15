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
| A1 | Add Phase 10 section to `docs/ROADMAP.md` (only items actually started) | implemented, not reviewed |
| A2 | `DESIGN.md` from the approved UI/UX spec | implemented, not reviewed |
| A3 | ADRs: Trust Core, Experience Shell | implemented, not reviewed |
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
   - The ADRs and DESIGN.md are a faithful reading of the package, but they have
     had **no human review** — that review is the Stage A gate (handoff §5).
   - Reading coverage is partial: `CLAUDE-CODE-HANDOFF.md`, `AGENTS.md`,
     `PRODUCT.md`, `00-EXECUTIVE-SUMMARY-RU.md`,
     `02-PRODUCT-AND-UI-UX-SPEC.md`, `03-DATA-KPI-TRUST-SPEC.md` and
     `04-TECHNICAL-IMPLEMENTATION-PLAN.md` were read in full. **Not yet read:**
     `01-AUDIT-BASELINE.md`, `05-TEST-UAT-ROLLOUT.md`, `README.md` and the
     1,795-line `docs/ROADMAP.md` (only its structure and Phase 9 conventions).
     Handoff §2 asks for all of them before editing; this is a real deviation and
     is recorded rather than glossed. Consequence: A5/A6 must not start until
     `05-TEST-UAT-ROLLOUT.md` (Definition of Done) and `01-AUDIT-BASELINE.md`
     (the defect list the protective layer must cover) are read.
9. **Limitations.** Contracts only. Nothing prevents a stale value from looking
   decision-grade yet — that is A5, and it is the first slice with a runtime
   surface.
10. **Commit SHA.** See below (path-scoped; no protected file staged).
11. **Next task.** **A4** — server-resolved feature flags (design + resolver, no
    UI switch), after reading `05-TEST-UAT-ROLLOUT.md` and `01-AUDIT-BASELINE.md`.
