# No agents — single-developer workflow (Phase 7.G Turn LXXXVII)

**Trigger:** user «убери всех агентов» on 2026-05-10, after honest pace
analysis showing architect caught ~5-6 real bugs in 90 rounds at ~5 min/round
overhead = 27 min wall-clock per real bug found. tsc + vitest catch >10x
more issues at 0 added cost.

## Rule

**Subagents (architect / Explore / Plan / general-purpose) are NOT invoked
in default turn flow.** Only when:
- User explicitly requests («проверь архитектора», «найди где X», «составь plan»)
- AND the request is non-routine (security review, multi-day plan, novel architecture)

## What was disabled

`.claude/settings.json` (Turn LXXXVII):
- `architect-gate.sh` Stop hook — REMOVED (no auto-architect invocation enforcement)
- `mark-dirty.sh` PostToolUse hook — REMOVED (was tracking state for architect-gate)
- `auto-bootstrap.sh` PostToolUse hook — REMOVED (was syncing memory mirror for architect's protocol files)
- `bootstrap.sh` SessionStart hook — RETAINED (memory mirror sync once on startup; harmless)
- `test-gate.sh` Stop hook — RETAINED (runs vitest, real safety net, not architect-related)

Files remain on disk (`.claude/hooks/architect-gate.sh` etc.) for git
history + revert option. Just unwired from `settings.json`.

## What's still enforced

- `tsc --noEmit` — type safety, run mid-turn manually
- `vitest run` — functional regression catch, run mid-turn manually
- `test-gate.sh` Stop hook — runs vitest pre-Stop (currently 162 files / 2379 tests)
- Pre-commit M7 scanner — status-band shape regression
- Pre-commit secret scanner

## Risk classes — CONSIDER re-enabling architect

The cost-benefit was specifically for routine turns (Phase 3.1 extraction
pattern, dead-code purges, hygiene). For these classes, **re-enable architect
for the duration of the work block:**

| Risk class | Why architect adds signal |
|---|---|
| Phase 5.2 Postgres RLS rollout | Cross-tenant leak silent killer; tsc can't catch SQL semantics |
| Phase 4.x security additions | Auth bypass / org-isolation regressions |
| Schema migrations (especially destructive) | Data integrity + rollback safety |
| New API routes | Zod / auth gate / rate limit / audit trail consistency |
| LLM integration | Prompt drift / token budgets / cost regression |
| `.claude/hooks/**` edits | Affects future enforcement (recursion-style risk) |
| First-of-pattern (new module establishing convention) | Architectural shape |

**How to re-enable for a work block:**
1. Edit `.claude/settings.json` Stop hooks → add `.claude/hooks/architect-gate.sh` back
2. Run that work
3. Edit settings.json again → remove

OR (lighter): manually invoke architect via Agent tool per turn for the
duration without re-enabling the gate. Developer-driven, not enforced.

## What does NOT need architect

| Class | Why |
|---|---|
| Pure tab extraction (Phase 3.1) | Mechanical move; tsc enforces ref integrity, vitest enforces semantic equivalence |
| Dead-code purge | Only deletions; tsc enforces no broken refs |
| Hygiene commits (CARRYOVER, counter-bump) | No logic |
| Translation files (messages/*.json) | i18n string changes |
| Memory rules / CLAUDE.md docs | No runtime impact |
| Doc-block / comment edits | No runtime impact |

## CARRYOVER

CARRYOVER becomes a **plain manual tracker** — developer files 🔄 rows when
useful, no automatic freshness enforcement (check #5 disabled with the
hook). Update on the cadence that's actually useful, not as ritual.

Counter-bump (`npm run carryover:bump`) is OPTIONAL — turns-open counters
were primarily for stale-row detection by architect, which is gone.

## Estimated impact

- Routine extraction turn: 12-15 min → ~3-5 min (~70% reduction)
- New API route turn: 15-20 min → ~12-15 min (architect reintroduced for class)
- Q&A turn: ~5 min → ~1 min (no architect, no CARRYOVER ritual)
- Average across mixed work: ~50-60% overhead reduction

Combined with prior LXXVIII carve-out + LXXIX Q&A exemption (now moot),
total per-turn floor for the common case (routine extraction, hygiene)
drops from ~12-15 min to ~3-5 min.

## Honest tradeoffs

**Lost:**
- Silent scope drop catch (~5-7 turns of 90 caught silent drops)
- Cross-file consistency drift catch (tsc gets ~50%, vitest gets some, ~50% relies on architect-style cross-cutting review)
- Stale memory rule / spec drift nudges
- Test design false-green class warnings

**Mitigations:**
- Re-enable for risk classes above
- Monthly self-audit (developer reads recent diffs)
- User catches drift in code review when reading commits
- `feedback_session_speedup.md` rules #1-26 still apply (developer self-discipline)

## Sunset criteria

Re-enable architect-gate by default if:
- 2+ silent scope drop bugs found in production
- Phase 5.2 RLS rollout starts (re-enable for that phase block)
- Phase 7.E AI suite work starts (LLM cost / prompt drift discipline)
- Developer notices quality drop in commits (subjective signal)

Otherwise, no-agents mode is the default going forward.
