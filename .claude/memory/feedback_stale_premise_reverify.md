---
name: Re-verify premise on 30+turn-old ⚠️ rows before counter-bump
description: A ⚠️ or 🔄 row that has rolled forward 30+ turns may rest on a premise that's no longer true. Don't auto-counter-bump — grep the cited code/file/symbol first; close-with-explanation if the premise is wrong.
type: feedback
---

When processing CARRYOVER OPEN at turn start, any ⚠️ or 🔄 row whose `turns-open` is ≥ 30 must be **premise-verified** before counter-bumping.

**Why:** Phase 7.G Turn IX surfaced two ⚠️ rows (66-turn + 71-turn) that had been carry-bumped through 60+ turns. Investigation took ~15 min and revealed both were non-actionable as filed: ⚠️ #1 cited a "drilldown bug" against models that lack the column needed (`SalesBudgetLine` has no `companyId`; UI doesn't consume the param; routes don't read it); ⚠️ #2 was a historical commit-granularity decision the user never asked to undo. Both lived as live ⚠️ for over 60 turns despite being unactionable. The previous Postgres-myth incident (Turn III/IV/V "P1001 blocker" carry) showed the same pattern for **temporal** state; this rule covers **structural** state.

**How to apply:**
- Threshold is `turns-open ≥ 30` (matches `audit-stale-carryover.ts` "critical" tier). Below 30, default carry-forward is fine.
- Re-verification is cheap: grep cited file/line/symbol/function name from the row text. If the cited artifact:
  - Still exists + matches description → premise valid; counter-bump and continue.
  - Doesn't exist OR has been refactored away → row is stale; investigate further before bumping.
  - Has been done in a different shape (the work landed but wasn't migrated) → migrate OPEN→CLOSED with the shipped commit hash.
  - Premise was wrong (e.g. data-model assumption that doesn't match schema) → migrate OPEN→CLOSED with developer-written reason explaining the misfile.
- Cost target: ~30s per row × 10-30 such rows per turn = ~5-15 min. Cheaper than letting a misfile rot another 60 turns.
- Don't try to close more than the surface yields — most stale rows ARE valid deferred work with concrete blockers (Phase 7.A.0 foundation work, multi-week features awaiting design calls, etc.). Re-verification surfaces the exceptions; routine carry-forward is correct for the rest.

**Hook integration (future):** `audit-stale-carryover.ts` could grow a `--reverify` mode that for each ≥30-turn row tries the trivial grep against `src/`, surfaces matches as evidence the premise still applies, and flags rows whose first-mentioned identifier returns 0 hits. Filed as a future enhancement, not a blocker for this rule.

**Counter-example (the ⚠️ rows this rule was born from):**
- 66-turn ⚠️ "7 tabs missing companyId filter" — verified `SalesBudgetLine`/`COGSBudgetLine`/etc. have no `companyId` column (`schema.prisma:725,772`); UI hooks at `src/lib/budgeting/hooks.ts` don't pass the param; routes don't read it. Closure: misfiled, no code action.
- 71-turn ⚠️ "Per-turn vs per-subsystem commit-split deviation" — historical, user didn't request rebase. Closure: historical record.
