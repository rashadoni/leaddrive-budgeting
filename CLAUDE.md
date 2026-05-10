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

Two roles operate on this codebase by default; subagents are available
on-demand only.

| Role | Identity | Tools | Does | Does NOT |
|---|---|---|---|---|
| **User** | Human (Rashad) | N/A | Strategic scope, ship/cut decisions, real-world context (Excel data, business rules), approves deferrals | Write code |
| **Developer** | Main Claude in the session | Full (Read/Write/Edit/Bash/...) | Writes code, runs tests/tsc/migrations, makes tactical architecture calls autonomously, announces next step, never votes | Decide ship/cut unilaterally; silently defer promised work |

**Subagents (on-demand only — Phase 7.G Turn LXXXVII per user «убери всех агентов»):**
- `architect` / `Explore` / `Plan` / `general-purpose` are NOT invoked in default turn flow
- Invoke ONLY when user explicitly requests OR when the work falls in a
  high-risk class (see `memory/feedback_no_agents.md`):
  - Phase 5.2 RLS rollout (cross-tenant leak silent killer)
  - Phase 4.x security additions (auth bypass)
  - Schema migrations (especially destructive)
  - New API routes (Zod / auth gate / rate limit consistency)
  - LLM integration (prompt drift / token budgets)
  - `.claude/hooks/**` edits (recursion-style risk)
- Hook files (`architect-gate.sh`, `mark-dirty.sh`, `auto-bootstrap.sh`)
  remain on disk but are UNWIRED from `settings.json`. Re-wire to
  re-enable for a work block.

### Turn flow

1. User gives direction OR developer continues per agreed plan.
2. Developer executes the work directly. No mandatory TurnGoal declaration
   for routine work; declare for novel/multi-day work or when scope is
   ambiguous.
3. Developer runs `npx tsc --noEmit` + `npx vitest run` mid-turn as needed.
   `test-gate.sh` Stop hook still runs `vitest` pre-Stop as safety net.
4. Pre-commit hook runs M7 status-band scanner + secret scanner.
5. Developer commits with descriptive message.
6. **CARRYOVER (`docs/CARRYOVER.md`) is a manual tracker** — file 🔄 rows
   when useful (deferred work, user-action blockers, dev-owned follow-ups).
   No automatic freshness enforcement. Counter-bump (`npm run carryover:bump`)
   is OPTIONAL.
7. Turn ends with developer announcing the next step as a fact, not a
   question (`feedback_decide_next_step.md`).

### How developer invokes subagents (on demand)

```
Agent(subagent_type="architect", description="...", prompt="...")
Agent(subagent_type="Explore", description="...", prompt="...")
Agent(subagent_type="Plan", description="...", prompt="...")
```

Use cases:
- `architect` — security review on Phase 5.2 RLS / Phase 4.x security work, schema migration audit, LLM cost review
- `Explore` — cross-file audit ("where is X used", "find all consumers of Y")
- `Plan` — multi-day feature plan needing architectural design

Default is NO subagent invocation. tsc + vitest + pre-commit M7 +
test-gate are the active safety net.

### Durable protocol files

Persisted in `memory/` and auto-loaded at session start. `memory/MEMORY.md`
is the index — each line is a markdown link pointing at a feedback/project/
reference memory file. A new Claude traverses those links when the topic
comes up (not up-front). If any are missing on a new machine, the developer
must re-read them before continuing Phase 7.

Core protocol files today:

- `feedback_no_agents.md` — **Phase 7.G Turn LXXXVII current default**: subagents not invoked in default flow; risk-class re-enable list
- `feedback_fix_before_build.md` — close review findings before new work (LXXXVII: applies to dev self-review + user feedback; architect-FAIL gate removed)
- `feedback_decide_next_step.md` — don't ask, announce
- `feedback_session_speedup.md` — pacing rules #1-26
- ~~`feedback_architect_scope_audit.md`~~ — DEPRECATED Turn LXXXVII (no auto-architect)
- ~~`feedback_100_percent_closure.md`~~ — DEPRECATED Turn LXXXVII (no Completion Audit)
- ~~`feedback_carryover_enforcement.md`~~ — DEPRECATED Turn LXXXVII (CARRYOVER now manual; check #5 disabled)
- ~~`feedback_single_round_architect.md`~~ — DEPRECATED Turn LXXXVII (architect not invoked at all; rule moot)
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
- **Layout-touching commits MUST run the visual gate:** any change to `src/features/terminal/components/HeatMap.tsx`, `CompanyTree.tsx`, `PanelGrid.tsx`, any `*.module.css` inside `src/features/terminal/`, `src/app/globals.css`, or `tailwind.config.ts` requires `npm run test:e2e -- visual-baseline` before commit. Snapshot drift = baseline regenerate (`npm run test:e2e -- --update-snapshots`) **+** include diff'd PNGs in the commit **+** commit-message line `BASELINE UPDATE: <reason>`. Closes 19-turn architect ⚠️ from CARRYOVER L132. See `.claude/memory/feedback_visual_verification_gate.md` for rationale + tolerance values + cross-machine plan.
