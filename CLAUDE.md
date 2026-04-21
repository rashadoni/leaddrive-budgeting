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
- **Current state:** AAC-specific prototype, not yet multi-tenant SaaS (see ROADMAP for path)

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
