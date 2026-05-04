---
name: Re-verify environmental blockers each turn
description: Don't carry "Postgres P1001" / "Redis down" / similar env claims forward across turns without re-checking; the underlying state can change silently between turns and the carried-forward myth blocks unrelated work.
type: feedback
---

Re-verify any environmental-blocker claim before propagating it into a new turn's narrative.

**Why:** Phase 7.G Turns III/IV/V all carried "Postgres P1001 blocker" through CARRYOVER preamble + commit messages + architect-review prompts. Turn III hit P1001 once (real); Turns IV/V repeated the claim without rechecking. By Turn VI a user-reported bug forced a DB query, revealing Postgres was UP for hours — possibly all 3 prior turns. The carried-forward myth meant:
- Pending Turn-III migration sat unapplied for 3 turns when 1 command would have applied it.
- AlertEvent wire-in (Turn IV v3.1) had no integration test against real DB despite DB being available.
- `seed-demo-companies.ts --recompute` (script committed Turn 42 sub-27 specifically to populate HeatMap) was never run because "DB down" → user saw "no visible difference" between sessions even though infra had landed.

**How to apply:**
- At each turn's start, if a prior CARRYOVER row claims an env blocker (P1001, Redis-down, kafka-unreachable, vendor-API-rate-limited, etc.), run a 1-command re-check FIRST: `pg_isready` / `redis-cli ping` / `curl <vendor>/health` / etc. Cost: ~1 second per check, much cheaper than the user-trust hit when they discover a 3-turn-old myth.
- When a re-check shows the blocker resolved, IMMEDIATELY: (a) run any pending migrations / seed scripts that the blocker was gating; (b) update the CARRYOVER row from blocker → CLOSED with the resolution timestamp; (c) acknowledge the carried-forward error in the current turn's narrative (don't quietly fix; users see the prior 3 turns of misleading commit messages).
- When a re-check shows the blocker still active, ONE recheck per turn is sufficient — don't loop on it. Document the recheck in narrative ("re-verified P1001 still active at TURN_START") so the next turn's developer doesn't question whether it was checked.
- Do NOT propagate "X blocked because env Y down" claims to architect-review prompts without including the recheck timestamp; architect should flag stale env claims as ⚠️ if missing.

**Counter-example (anti-pattern carried 3 turns):**
- Turn III narrative: "Postgres P1001 — migration committed but unapplied; idempotent SQL applies cleanly when DB comes up." (real at the time)
- Turn IV narrative: "Postgres P1001 (Turn III pre-existing blocker)" — copied without re-check
- Turn V narrative: "Postgres P1001 (3rd consecutive turn)" — copied without re-check
- Turn VI: user reports bug → developer queries DB → discovers DB up + applies migration in 1 command
