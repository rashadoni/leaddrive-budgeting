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

**Hook obligations** (see `.claude/hooks/architect-gate.sh`):

- Check #5: if CARRYOVER.md has any 🔄 rows AND the file's mtime is older than the dirty marker's mtime (i.e. file wasn't touched this turn), block turn-close with message "CARRYOVER has N open items, not updated this turn; process each."

**Why this rule exists:**

User observed 2026-04-24 that across ~15 turns the developer repeatedly treated each turn as fresh — partial items from prior turns evaporated unless user explicitly asked "что осталось?". Developer would announce "next priority: X" without processing the accumulated pile. User: "а кто будет частичные закрытые задачи закрывать?" — exactly right; the answer should be automatic, not user-driven. This rule makes CARRYOVER.md the mechanical tie between turns.

**Failure mode this prevents:** developer jumps to high-profile new feature (e.g. AI Data Mapper) while 10+ partial items sit open. Under this rule, hook blocks any Stop where CARRYOVER wasn't updated, so partial items get addressed in SOME form every turn — either closed, heartbeated, or formally re-escalated with a real blocker.
