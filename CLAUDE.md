# BudgetPro — Claude Context

## Roadmap (ALWAYS READ FIRST)

**Before starting any refactoring, feature, or architectural work — read `docs/ROADMAP.md`.**

It contains:
- All phases (0-6) from Security → Scale
- Current status per task (⬜ Todo / 🟡 In progress / ✅ Done)
- Completion changelog
- Rationale for each phase based on 2026-04-21 audit

When completing a task:
1. Update its status in `docs/ROADMAP.md`
2. Append to the Changelog section at the bottom with date + brief note
3. If the change reveals new issues, add them to the appropriate phase

## Project Overview

- **Stack:** Next.js 16 + Prisma + PostgreSQL, port 3000
- **Dev server:** runs via LaunchAgent (`~/Library/LaunchAgents/com.budgetpro.dev.plist`)
  - Restart: `launchctl kickstart -k gui/501/com.budgetpro.dev`
  - Logs: `~/Library/Logs/budgetpro.log`
- **Current state:** Transforming from AAC-specific prototype into Enterprise Holding Risk Terminal. Not yet multi-tenant SaaS — org isolation is enforced at the application layer, no RLS.

## Roles & workflow (read before acting)

Four roles operate on this codebase; a new Claude session MUST understand
them before writing code. This replaces an earlier, inaccurate description
that claimed "Antigravity" was the architect — there is no external model,
both developer and architect are Claude instances in the same Claude Code
environment.

| Role | Identity | Tools | Does | Does NOT |
|---|---|---|---|---|
| **User** | Human (Rashad) | N/A | Strategic scope, ship/cut decisions, real-world context (Excel data, business rules), approves deferrals | Write code |
| **Developer** | Main Claude in the session | Full (Read/Write/Edit/Bash/...) | Writes code, runs tests/tsc/migrations, makes tactical architecture calls autonomously, announces next step, never votes | Decide ship/cut unilaterally; silently defer promised work |
| **Architect subagent** | Claude via `Agent` tool with `subagent_type: "architect"` | Read-only (Read/Grep/Glob/Bash) | Reviews changes: scope audit vs declared TurnGoal + quality review (Проблемы/Предложения). Finds drift, silent deferrals, security regressions, architectural gaps | Write or edit files |
| **Explore subagent** | Claude via `Agent` tool with `subagent_type: "Explore"` | Read-only | On-demand codebase searches, honest audits spanning many files | Write or edit files |

### Turn flow

1. User gives direction OR developer continues per agreed plan.
2. Developer declares **TurnGoal** at start of any substantive turn
   (substantive = produces git diff OR writes to `memory/`; TodoWrite alone
   doesn't count). Pure Q&A / planning turns are exempt.
2.5. **Process `docs/CARRYOVER.md`** BEFORE TurnGoal is final. For every
    OPEN row:
    - `owner=developer` → either add to TurnGoal (close this turn) or
      re-escalate to user with a specific new blocker; vague blockers
      ("time", "complex") rejected by architect.
    - `owner=user` → bump `turns-open` counter; if ≥14 add inline re-ping
      to user in final message.
    - Closed items: move OPEN → CLOSED with date + resolution note.
    File MUST be touched this turn (hook check #5 blocks Stop if mtime <
    dirty-marker mtime while OPEN items exist). See
    `memory/feedback_carryover_enforcement.md`.
2.6. **Session-handoff convention:** at session start, scan
    `docs/CARRYOVER.md` for a `## ⚡ SESSION HANDOFF` section
    BETWEEN the invariants block and `## OPEN`. If present, it
    contains the previous session's pickup-point (deferred task,
    state-of-the-world snapshot, specific instructions). Read it
    BEFORE declaring TurnGoal — it overrides the default "pick from
    OPEN" flow. Last step in the handoff block tells you to delete
    the section after acting on it; honor that so handoffs don't
    accumulate. The section is OPTIONAL — most sessions won't have one.
3. Developer executes, runs `npx tsc --noEmit` + `npx vitest run` as it goes.
4. **Stop hook** (`.claude/hooks/architect-gate.sh`) blocks turn close and
   forces the developer to invoke the architect subagent.
5. Architect prompt has **three** required sections (extended 2026-04-24):
   - **Scope check:** TurnGoal verbatim → architect verifies each goal landed
     in diff, flags silent drops / undeclared deferrals / retro-scope-creep.
   - **Quality review:** Проблемы / Предложения on what was built.
   - **Completion Audit (per-deliverable, vs RAW user message):** developer
     MUST paste the user's verbatim request into the architect prompt (not a
     summary). Architect tables every user-implied deliverable with status
     ✅ / ⚠️ / ❌ / 🔄. TurnGoal that narrows user's ask is flagged as drift
     — architect audits against user's words, NOT developer's reframe. See
     `memory/feedback_100_percent_closure.md`.
6. Architect's reply — **all three** sections — is quoted **verbatim** in
   the final user-facing message (pass-through identical whether scope is
   clean or not; user always sees the audit happened).
7. Any Problem from Scope or Quality, OR any ⚠️/❌ from Completion Audit
   without valid 🔄 escalation, triggers **fix-before-build** (memory
   `feedback_fix_before_build.md`) — turn cannot close until the issue is
   resolved or developer adds an inline escalation to the final user
   message (not in a ROADMAP comment). Valid escalation format:
   `🔄 Not closed: <item>. Blocker: <specific reason>. Proposed resolution:
   <user action / next-turn plan / explicit cut>.`
8. Turn ends with developer announcing the next step as a fact, not a
   question (memory `feedback_decide_next_step.md`).

### How developer invokes subagents

```
Agent(subagent_type="architect", description="...", prompt="...")
Agent(subagent_type="Explore", description="...", prompt="...")
```

Architect is expected to run after every substantive turn. Explore is
on-demand for cross-file audits. Neither can write files.

### Durable protocol files

Persisted in `memory/` and auto-loaded at session start. `memory/MEMORY.md`
is the index — each line is a markdown link pointing at a feedback/project/
reference memory file. A new Claude traverses those links when the topic
comes up (not up-front). If any are missing on a new machine, the developer
must re-read them before continuing Phase 7.

Core protocol files today:

- `feedback_fix_before_build.md` — close review findings before new work
- `feedback_decide_next_step.md` — don't ask, announce
- `feedback_architect_scope_audit.md` — TurnGoal + **triple-audit protocol** (Scope + Quality + Completion)
- `feedback_100_percent_closure.md` — Completion Audit vs RAW user message; ⚠️/❌ without valid 🔄 escalation blocks turn-close; protocol kills silent reframe / scope narrowing
- `feedback_carryover_enforcement.md` — `docs/CARRYOVER.md` is cross-turn tracker of open 🔄 items; developer must process every turn; architect + hook enforce freshness
- plus product / UX / user-preference memories — enumerated in `MEMORY.md`

### Multi-machine bootstrap

The protocol files live in TWO places:

- **In-repo** (git-tracked, clones with project):
  - `.claude/agents/architect.md`
  - `.claude/hooks/architect-gate.sh` + `mark-dirty.sh` + `bootstrap.sh`
  - `.claude/hooks/tests/architect-gate.test.sh`
  - `.claude/settings.json`
  - `.claude/memory/` — mirror of protocol memory files (source of truth)
  - `docs/CARRYOVER.md`
  - `docs/ROADMAP.md`
  - `CLAUDE.md`

- **User-home** (per-machine, Claude Code auto-loads at session start):
  - `~/.claude/projects/-Users-<user>-Documents-leaddrive-budgeting/memory/*.md`

**On a fresh clone** (new machine or first-time setup), the user-home memory is missing, so protocol auto-memory degrades. To fix:

1. **Automatic** (Claude Code ≥ version supporting `SessionStart` hook): `.claude/hooks/bootstrap.sh` runs on session start, syncs `.claude/memory/` → `~/.claude/projects/<slug>/memory/`. Idempotent.
2. **Manual fallback**: `bash .claude/hooks/bootstrap.sh` once after clone. Takes < 1 second.

Verify the bootstrap succeeded: `ls ~/.claude/projects/*leaddrive-budgeting/memory/` should show all `feedback_*.md` + `project_*.md` + `user_*.md` files listed in `MEMORY.md`.

## Phase 7: Enterprise Holding Risk Terminal (ACTIVE)

Phase 7 scope, progress, and per-task status live in `docs/ROADMAP.md` —
read that for the current picture, not this file. High-level snapshot:

- **Foundation (7.A) — done:** Prisma schema, core API routes, migrations applied.
- **Formula engine + recompute pipeline (7.A.0) — foundation landed +
  budgetLine/currencyRate resolvers live, real matrix populated.** Engine,
  periods, resolver registry, matrix API, HeatMap + CompanyTree components
  all built and unit-tested. 5 resolvers registered: `booking`,
  `company.settings`, `operationalFact`, `currencyRate`, `budgetLine`.
  Parent-rollup dedup + reconciliation guard on xlsx ingest (196 tests).
  **Remaining 7.A.0 gaps (source of truth = ROADMAP):** `fact()` / `rollup()`
  not wired as formula functions (blocks cross-period composites);
  `sparkline` field never computed; no background scheduler — `POST
  /api/indicators` runs sync with a 500-pair cap.
- **Onboarding (7.B) — partial.** Done: Excel bulk-import for companies
  (secured), 10 CoA templates, CLI importer for AZMADE budgets with
  transactional replace + auto-recompute. Missing: per-company
  budget/actual import as an API route (onboarding wizard depends on it),
  onboarding wizard UI, AI Data Mapper (Phase 7.B NEW, blocks
  60-company scale — every new xlsx shape currently requires code),
  ~60-company wire-up (13 seeded, 8 operational today).
- **Phase 7.E NEW AI suite — 0% started.** AI Web Crawler, AI Variance
  Explainer, Predictive Analytics, Board Deck Generator all exist only
  in ROADMAP text — no source files yet. Explicit in the audit.

### Key files

- `prisma/schema.prisma` — full DB schema (1100+ lines)
- `src/lib/risk/` — formula engine, recompute pipeline, threshold classifier
- `src/lib/onboarding/` — companies-import pure helpers, CoA templates
- `src/features/terminal/` — terminal page, store, CompanyTree, HeatMap, CommandBar
- `src/app/api/companies/`, `src/app/api/indicators/`, `src/app/api/scenarios/`,
  `src/app/api/indicators/matrix/`, `src/app/api/onboarding/import/companies/`
- `scripts/seed-industries.ts`, `scripts/seed-indicators.ts`

### Important Notes

- `expr-eval`, `vitest`, `xlsx`, `zustand`, `lucide-react` all installed as of
  2026-04-23 (earlier CLAUDE.md note about "npm network issues" is resolved).
- `terminalStore.ts` uses a hand-rolled reactive mock (module-level actions
  singleton for referential stability). A swap to real zustand is an option
  once Phase 7 polish begins — not scheduled in ROADMAP.
- Terminal page URL: `/budgeting/terminal`. Page is auth-gated.
- The `(dashboard)` is a route group in App Router.

## Key architectural debts (short version — full list in ROADMAP)

1. `BudgetLine.category` / `department` have fuzzy semantics — mix of codes and names. Analytics/pnl use `looksLikeSapCode()` fallbacks to disambiguate. **Fix:** Phase 2.1 — FK to ChartOfAccount.
2. `budgeting/page.tsx` is 5000+ lines. **Fix:** Phase 3.1.
3. Import has hardcoded Azerbaijani strings + AAC product codes. **Fix:** Phases 2.2, 2.3.
4. No audit log, no soft-delete, no period locking. **Fix:** Phase 4.
5. Pre-existing TypeScript errors ignored (`department-access.ts` missing module). **Fix:** Phase 1.3.

## Safe operations

- Dev server is managed by LaunchAgent — do NOT `npm run dev` manually, it conflicts with port 3000.
- Re-import of Excel requires Reset first (there's no incremental re-import yet — Phase 2.4 goal).
- Prisma migrations: `npx prisma migrate dev --name <name> --skip-seed` works reliably.
- Type checking: `npx tsc --noEmit` — there are pre-existing errors (see Phase 1.3), don't panic.
- **Pre-commit hook (M7 regression gate):** `.githooks/pre-commit` runs the M7 status-band-shape scanner (~150ms) and aborts commits that would regress color-blind-safe shape coding. Activate once per clone with `git config core.hooksPath .githooks`. Bypass in emergencies with `git commit --no-verify`. The scanner also runs in the Stop-hook test gate, so missing pre-commit activation only affects mid-turn commits.
