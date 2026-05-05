---
name: Architect does scope audit, not just quality review
description: Workflow protocol — architect subagent must verify turn-scope completeness against a declared TurnGoal, not only review code quality
type: feedback
originSessionId: cc752d7f-fcd5-4aa3-bd07-4a3cd4aa06f1
---
Architect subagent reviews must include a **scope audit** in addition to the usual code-quality review. The current pattern (showing architect only what I built + asking for review) lets silently-dropped items slip through — they surfaced only months later when the user asked for an honest audit.

**Why:** User observed 2026-04-24 after the Phase 7 audit revealed ~15 items marked "deferred" or "partial" that architect never flagged during their respective turns, because I had never told architect they were in scope. User: "если архитектор после каждой задачи сам запрашивал бы отчет и при не соответствии мог бы девелоперу давать команды — более чистая работа была бы."

**How to apply:**

1. **TurnGoal at turn start.** Open every **substantive** turn with an explicit "Goal this turn: A, B, C" list. Use TodoWrite so the list is visible in both transcript and architect prompt.

   **Hard test for "substantive":** a turn is substantive if it either (a) produces any git diff in the project tree, or (b) writes to `memory/`. TodoWrite changes alone don't count — neither does pure planning / Q&A / review-reading. When in doubt, declare a TurnGoal; over-declaring is cheap, under-declaring is the loophole that killed the last attempt at discipline.

2. **Triple audit in every architect invocation.** Extended 2026-04-24 to three required sections (see `feedback_100_percent_closure.md` for the third):
   - **Scope check:** attach the TurnGoal verbatim; ask architect to verify each goal item landed in the diff — flag silently dropped items, flag "deferred" items that weren't agreed with user, flag items half-done without comment.
   - **Quality review:** the usual Проблемы / Предложения over what was built.
   - **Completion Audit (per-deliverable, vs RAW user message — see `feedback_100_percent_closure.md`):** attach the user's verbatim request; architect audits each user-implied deliverable with status ✅ / ⚠️ / ❌ / 🔄. TurnGoal narrowing that hides user-deliverables behind reframes is flagged as ⚠️ by architect.

3. **Scope gap = Проблема.** Any gap architect finds under the scope check is mandatory-fix under `feedback_fix_before_build.md` — same rules. Cannot close the turn until the gap is either closed, or I've explicitly raised it to the user and gotten a cut/defer approval.

4. **No silent deferral.** If I decide to punt something during execution, I must call it out **in the final assistant message of that turn** — visible inline to the user. Putting it only in a ROADMAP comment, TodoWrite entry, or architect prompt doesn't count. The user must see the deferral in the message they read, not in a file they might open.

5. **Scope-check result travels verbatim — pass or fail.** Architect's scope section goes to the user in the final message regardless of outcome. If it's clean ("all goals met, no silent deferrals"), quote that verbatim too — otherwise the user has no visible signal that an audit happened at all. Pass-through identical to Проблемы, no softening.

6. **TurnGoal is immutable mid-turn.** Once stated at turn start, goals can't be retro-added to match what was actually built. If scope grows during execution (new blocker surfaces, user redirects), I can append G_n+1 only with an explicit inline note ("Adding [Gk] mid-turn because X — user, ack?").

   **If the user doesn't ack before the turn ends:** default is **do not add** — push the new item to the next turn. No silent absorption. Architect's scope check treats unackowledged additions as silent scope creep and flags them as Проблема.

## Speedup conventions (Phase 7.G Turn XXII codification)

When applying `feedback_session_speedup.md` techniques, the architect protocol stays the same shape but takes faster compute paths:

7. **Sonnet/Haiku model for routine reviews.** When the turn matches an established closure pattern (closure-shaped — single 🔄 row migrated, premise verified, verification table standard), specify `model: "sonnet"` per architect call. Reserve Opus for novel architecture / multi-file refactors / cross-cutting concerns. **3-5× faster, same protocol shape.**

8. **Compact prompt + capped output.** For routine reviews, prompt ≤80 lines (TurnGoal verbatim + 1-line shipped + verification table + ≤3 quick-scrutiny questions); request `"≤150 words; only Проблемы + Completion Audit; skip Хорошо/Предложения if 🟢"`. Architect responds 3-5× faster on shorter context. Full 200-500-word reviews reserved for novel patterns.

9. **Skip Round-1 for trivial single-line fixes.** Single-line edits (typo / comment update / import order / docstring tweak) with diff <5 LOC and fixed-shape don't need architect Round-1. Commit straight. Per `feedback_fix_before_build.md` the architect's job is catching scope drift + silent deferrals; trivial fixes have neither shape.

10. **Batch 2-3 closures per architect call.** When 2-3 closures share a theme (companion ⚠️ items, related sub-tasks, mirror patterns), batch into one turn with one consolidated architect review. Halves architect-overhead per closure.

11. **Skip premise re-verify for fresh rows.** `feedback_stale_premise_reverify.md` mandates re-verify on ≥30-turn-old rows specifically. Fresh rows (≤14t) trust the original filing — skip the grep-for-cited-symbol step.

These are speedup conventions, not protocol relaxations. Architect's three blocks (Scope / Quality / Completion Audit) still required. RAW USER MESSAGE marker still required. FAIL still blocks Stop.
