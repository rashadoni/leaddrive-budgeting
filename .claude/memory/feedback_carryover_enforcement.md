---
name: Carryover enforcement — open items tracked across turns, not in developer's head
description: docs/CARRYOVER.md is single source of truth for open 🔄 items; developer must process it every substantive turn; architect + hook enforce
type: feedback
originSessionId: cc752d7f-fcd5-4aa3-bd07-4a3cd4aa06f1
---
Every substantive turn MUST process `docs/CARRYOVER.md` — the cross-turn tracker of open `🔄` escalations and partial items. Without this, "что осталось" audits depend on user vigilance instead of mechanical enforcement.

**Required developer actions every substantive turn:**

1. **Read `docs/CARRYOVER.md`** BEFORE declaring TurnGoal. Turn goals must include: at least one `owner=developer` OPEN item (or a formal re-escalation with new blocker), plus any user-requested work.

2. **Touch the file this turn** (even for heartbeat-only). Bumping `turns-open` counters by 1 for each still-open item OR moving a closed item to CLOSED counts as "touched". Pure no-op (file unchanged) blocks turn-close — hook enforces via mtime check.

3. **Close what you can.** If a `developer`-owned item has no genuine blocker, it MUST close this turn OR justify in-line to user why not. "Priority" is not a valid reason — use fix-before-build discipline.

4. **Re-escalate with SPECIFIC blocker.** If a developer-owned item cannot close, switch owner to `user` with a specific actionable blocker ("need file X", "need decision on A vs B"). Vague blockers ("time", "complex") are rejected.

5. **User-owned items get heartbeat.** Bump `turns-open`. If counter reaches ≥ 14 without user contact, add an inline note to user: "this is the 14th turn since escalated on Y — ping user to re-confirm still relevant or cut".

6. **Move closures to CLOSED section** with resolution note. Never delete OPEN rows silently — they either close with evidence or stay with a reason.

**Architect obligations** (see `.claude/agents/architect.md` step 2 + Completion Audit block):

- Reads CARRYOVER.md at start of every review.
- For each OPEN item: verify developer either closed it, heartbeated it, or re-escalated. Missing action = Проблема.
- In Completion Audit, generates a "Next-turn carryover" section listing every ⚠️/❌/🔄 from THIS turn + every still-open pre-existing item. Developer copies this verbatim into CARRYOVER.md before closing turn.

**Hook obligations** (see `.claude/hooks/architect-gate.sh:215-251`):

- Check #5: if CARRYOVER.md has any 🔄 rows AND **no `Edit` / `Write` / `MultiEdit` tool_use entry after `LAST_USER_IDX` modified `docs/CARRYOVER.md`**, block turn-close with message "CARRYOVER has N open items, not updated this turn; process each."

**Important — the check is transcript-based, NOT mtime-based.** The hook scans the conversation transcript for tool_use events and counts only `Edit`, `Write`, and `MultiEdit` calls whose `file_path` ends with `/docs/CARRYOVER.md`. Bash-tool writes (e.g. `python3 bumper.py` that does `CARRYOVER.write_text(...)`) are INVISIBLE to this check — see "Edit-tool requirement" rule below.

## Edit-tool requirement for CARRYOVER updates (codified Turn K' / Phase 7.G)

**Rule:** every CARRYOVER update this turn MUST land via the **Edit** (or Write / MultiEdit) tool. Bash-based file writes (e.g. Python helper scripts that do `CARRYOVER.write_text(...)`) are INVISIBLE to the architect-gate hook check #5 and trigger false-positive Stop-hook complaints.

**Why this rule exists:** observed empirically across Phase 7.G Turns H' / J' / K' (3 occurrences in one session). Hook check #5 (`.claude/hooks/architect-gate.sh:215-251`) is transcript-based — it scans for `Edit` / `Write` / `MultiEdit` tool_use entries after `LAST_USER_IDX` whose `file_path` ends with `/docs/CARRYOVER.md`. A Python helper that bumps 90+ counters via `Bash` shows up in the transcript as a `Bash` tool_use, not `Edit` — so the hook sees zero CARRYOVER edits and blocks turn-close, even though the file was actually modified.

**Workflow** for substantive turns that need bulk CARRYOVER changes:

1. Run the Python bumper helper (e.g. `python3 /tmp/claude/bump_carryover_turnX.py`) for the multi-row counter-bump + OPEN→CLOSED migration. This is fast (~50ms vs 90+ sequential Edits) and is the right tool for the bulk operation.

2. Follow up with **at least one direct Edit-tool call** on `docs/CARRYOVER.md`. Acceptable patterns:
   - Refine narrative wording (e.g., add a post-architect addendum after the Round-1 verdict)
   - Fix a typo or counting drift
   - Insert a 1-line summary clarification
   - Append a new 🔄 row inline (preferable when filing architect-flagged carry-forwards)

3. Do this BEFORE invoking the architect — preemptive heartbeat eliminates the post-architect Stop-hook race entirely.

4. The architect's Round-1 review is read-only and does NOT register as a CARRYOVER edit, so don't rely on it.

**Tradeoff:** the Edit-tool follow-up is a small extra step (~30s) but eliminates the recurring Stop-hook complaint pattern that has cost ~10 min total across 3 occurrences in Phase 7.G. Net positive.

**Hook fix alternative:** the architect-gate.sh check #5 could be extended to also count `Bash` tool_use entries whose command modifies CARRYOVER (e.g. via heuristic regex for `CARRYOVER.write_text` or `> docs/CARRYOVER.md` patterns). Deferred — convention fix is sub-2-min, hook refactor sub-15-min with broader test surface.

**Hook edge cases worth knowing** (per architect Turn-L Round-1 💡):

- **`cwd` field absent in Stop event input** (`architect-gate.sh:208-211`): the check silently skips when Claude Code doesn't supply `cwd` (non-Claude-Code runners, headless invocations). The hook is best-effort, not authoritative — manual CARRYOVER discipline is still expected even when the hook can't enforce.
- **Hook trigger counts `🔄` only** (`architect-gate.sh:215` uses `grep -c "^| 🔄 |"`), NOT `⚠️` rows: a CARRYOVER section with only `⚠️` rows would silently bypass check #5 even though the file has unaddressed items. Narratives should specify "X total (Y 🔄 + Z ⚠️)" per Turn-I counting-convention so the hook trigger ≠ narrative total mismatch is visible.

**Why this rule exists:**

User observed 2026-04-24 that across ~15 turns the developer repeatedly treated each turn as fresh — partial items from prior turns evaporated unless user explicitly asked "что осталось?". Developer would announce "next priority: X" without processing the accumulated pile. User: "а кто будет частичные закрытые задачи закрывать?" — exactly right; the answer should be automatic, not user-driven. This rule makes CARRYOVER.md the mechanical tie between turns.

**Failure mode this prevents:** developer jumps to high-profile new feature (e.g. AI Data Mapper) while 10+ partial items sit open. Under this rule, hook blocks any Stop where CARRYOVER wasn't updated, so partial items get addressed in SOME form every turn — either closed, heartbeated, or formally re-escalated with a real blocker.

## Sub-turn counter-bump policy (codified Turn 38 sub-13)

A "substantive sub-turn" inside a longer Turn N (multiple commits, +200 docs lines, etc.) **does NOT** require bumping all OPEN-row `turns-open` counters. Bumps happen ONCE per Turn N at its FINAL sub-turn close.

**Why:** During Turn 38 (12+ sub-turns shipping demo prep), bumping +1 across all 30+ OPEN rows after every sub-turn would inflate counters from "8 turns open" to "20+ turns open" across a single calendar day's work — distorting the stale-tracker signal that exists to surface forgotten escalations.

**What still applies per sub-turn:**
- The CARRYOVER file MUST be touched (preamble row added OR item closure OR new 🔄). Hook check #5 enforces mtime > dirty-marker.
- Architect Round-1 still required.
- Closing items still moves OPEN→CLOSED with resolution note.
- New 🔄 escalations get added immediately, not deferred.

**What deferrals to final sub-turn close:**
- `turns-open` counter increments across all pre-existing OPEN rows.
- "Bumps: N reverse-numeric" preamble note.

If a Turn never reaches a "final sub-turn close" (e.g. session ends mid-Turn), the next session's first substantive turn picks up the bump pass as part of its own sweep — net effect is one bump per calendar-Turn boundary, not per micro-action. This honors the original "every substantive turn touches the file" rule while preventing counter-inflation under burst-shipping cadence.

### When a "final sub-turn close" is actually final (codified Turn 38 sub-15)

The sub-13 policy left "final" undefinable: a sub-turn can be claimed-final, then the user opens a new prompt and another sub-turn ships under the same Turn N. The architect flagged this in sub-15 ("'final' undefinable when user keeps shipping new prompts").

**Rule:** a **new user-prompt theme** opens **Turn N+1 automatically**, regardless of how many sub-turns Turn N has already shipped. The first sub-turn under Turn N+1 inherits the responsibility for the deferred counter-bump from Turn N's last sub-turn (if Turn N never reached an explicit final close before the new prompt arrived).

**What counts as "new theme":**
- User opens an unrelated topic (new feature ask, new bug, new question on a different surface).
- User explicitly says "next" / "новая задача" / "switch to" / "теперь" / "продолжай" *after a session boundary*.

**What is NOT a new theme** (= still Turn N continuation):
- "продолжай" / "сделай" / "go" within the same conversational beat (architect ⚠️ closures, follow-up clarifications, user reacting to just-shipped diff).
- Pure questions about what just shipped.
- Re-prompts of the same task ("сделай ещё раз правильно").

**What this means in practice for the developer:**
- At the start of any sub-turn, check: is this a continuation of the same theme, or did the user open something new? If new → declare "Turn N+1 sub-turn 1" and absorb Turn N's pending counter-bump pass into this turn's bookkeeping.
- "Final" is now: either (a) explicit "session-end" / "I'm done" cue from user, OR (b) next user prompt opens new theme. Whichever comes first determines when the bump pass fires.

**Why:** Under the old policy, a developer could perpetually claim "this isn't final yet" while burning through 10+ sub-turns — counters never bumped, stale-tracker signal lost. Under the new rule, the bump pass is guaranteed to fire at every theme-boundary, making counter-inflation impossible AND making "Turn N final" a fact established by the conversation, not by developer judgment.
