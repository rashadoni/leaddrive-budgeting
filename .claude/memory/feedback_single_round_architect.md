# Single-round architect — ⚠️ items become 🔄 rows, no spiral

**Trigger:** Phase 7.G Turn LXXXI (user «B» on the «такими темпами проверок мы проект за год не закончим» retrospective).

**Source:** Turn LXXX cost-benefit analysis. 5 commits in one turn (LXXX → f/u 4⚠️ → f/u² test gap → f/u³ false-green → CARRYOVER heartbeat) for marginal value. Real bugs caught across 90 architect rounds: ~5-6. Most ⚠️ are stylistic / test-design / hygiene — valid 🔄 escalation, not runtime regressions.

## Rule

**After ONE architect round per turn, the turn closes regardless of verdict.** PASS or FAIL, single round only.

- `architect-gate.sh` (Stop hook) requires architect invocation + RAW marker, but no longer blocks on FAIL.
- All ⚠️ items from architect's "Next-turn carryover" table → paste into `docs/CARRYOVER.md` OPEN section as 🔄 rows (developer-owned by default; user-owned if explicitly so).
- Re-iterating to PASS within the same turn is **prohibited** — that's the spiral that burned 8-25 min/turn.

## Exceptions (developer MAY iterate within turn)

Iterate only when ⚠️ falls in one of these classes:

1. **Security regression** — auth bypass, org-isolation leak, PII exposure. Cannot file as 🔄.
2. **Runtime broken** — `tsc` exit ≠ 0, `vitest run` failure, or production endpoint returns 500 on happy-path. Cannot file as 🔄.
3. **Pre-existing test fails** — gate must catch this, not the architect spiral.
4. **CARRYOVER freshness gap** (check #5 violation) — single Edit closes it, not a real iteration.

For everything else (test design, false-green, hook-internal, code style, doc/typo, unused import, naming, missing edge case, refactor opportunity) → 🔄 row, turn closes.

## Why this works

- `tsc --noEmit` + `vitest run` (already in turn flow) catch real regressions.
- Pre-commit M7 scanner catches status-band shape regressions.
- Architect spiral was not catching these — it was catching its own taste preferences.
- Periodic audit (every 10 turns or user-requested) catches drift better than per-turn nitpicks.
- 🔄 rows in CARRYOVER are tracked across turns — nothing rots, just deferred.

## How to file ⚠️ → 🔄

Architect's "Next-turn carryover" table at end of review is already shaped as `| 🔄 | date | turns-open | owner | blocker | item |` rows. Paste verbatim into `## OPEN` table in `docs/CARRYOVER.md` (above existing rows, freshest first). Update count in heartbeat paragraph (e.g. "11 → 13 OPEN (+2 from architect ⚠️ converted to 🔄)").

If architect did not provide the table (e.g. PASS verdict with 💡 only), no action needed.

## Counter-examples (where Old protocol over-fired)

| Turn | Architect ⚠️ | Old protocol | Option B (this rule) |
|---|---|---|---|
| LXXX f/u² | "test re-implements to_slug locally → false-green class" | spiral round 3 (refactor + new tests + new architect) | 🔄 row "bootstrap.sh helpers untested in production form" |
| LXXX f/u³ | "CARRYOVER not touched while .claude/hooks/ edited" | another commit with 3-LOC heartbeat | included in same commit OR 🔄 row |
| LXXIX | "Q&A turn hit check #5 with no edits" | artificial heartbeat-touch | Q&A exemption (already shipped) |

In all 3 cases, real value of the iteration was 0 — `tsc`/`vitest` would have caught any actual regression.

## Cost saved per turn (estimated)

- Per turn with architect-FAIL chain: ~10-20 min (multiple rounds × 5 min each)
- Per turn without chain (PASS first round): 0 min change
- Average across 90-turn window: ~3-5 min/turn savings
- Over 100 turns: ~5-8 hours saved

Combined with the carve-out (Turn LXXVIII) + Q&A exemption (LXXIX) + auto-bootstrap (LXXX) refinements, total per-turn overhead drops from ~15-20 min to ~5-8 min in the common case.
