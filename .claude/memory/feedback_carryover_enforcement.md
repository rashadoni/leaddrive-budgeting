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

## CLOSED-section retroactive-annotation policy (codified Turn T, closes Turn-15 architect ⚠️)

When a finding from a later turn invalidates or qualifies one or more *already-CLOSED* rows in `docs/CARRYOVER.md`, the developer has two annotation shapes available — pick the one that matches the **scope** of the finding. Don't mix shapes for the same finding, and don't invent a third.

### Shape A — block-level `> **ℹ️ RETROACTIVE NOTE (...)** ...`

Use when the finding is **systemic** and applies to MANY closed rows simultaneously (or to a class of claims that's hard to enumerate row-by-row).

- **Placement:** as a markdown blockquote (`>` prefix) immediately after the `## CLOSED (last 30 days)` heading and the section preamble, BEFORE the table header.
- **Format:** `> **ℹ️ RETROACTIVE NOTE (Turn N finding, applies to <scope>):** <invalidation detail>. <what still stands>. <where resolution is tracked>.`
- **Required content:** (1) Turn number that surfaced the finding, (2) explicit scope ("all CLOSED rows below claiming X"), (3) what still stands vs what's invalidated, (4) pointer to the OPEN row tracking the resolution if any.
- **Existing example:** `docs/CARRYOVER.md` block-level note after `## CLOSED` heading — Turn 14 finding that all browser-smoke verifications from Turn 9+ rendered Demo data, not AZMADE.

### Shape B — per-row `**⚠️ CORRECTION YYYY-MM-DD (Turn N <context>):** ...`

Use when the finding **invalidates a specific narrative claim** in ONE closed row's resolution column (typo, wrong root cause, premature claim, etc.).

- **Placement:** inline inside the row's `resolution` cell, between the original closure narrative and the trailing `|` cell separator. Do NOT create a new row, do NOT modify the original status emoji.
- **Format:** `**⚠️ CORRECTION YYYY-MM-DD (Turn N <context>):** <what was wrong>. <what the structural fix is, or where it's tracked>. Closure status remains ✅ for <list of OTHER deliverables that DID land>; only <bullet> was wrong.`
- **Required content:** (1) ISO date of the correction, (2) Turn number + brief context ("re-audit", "post-test", etc.), (3) explicit "remains ✅ for X / wrong on Y" framing so the closure isn't entirely invalidated.
- **Existing example:** `docs/CARRYOVER.md` ✅ row for "Phase 7.D — browser smoke test (drag-resize + named-layout save/load + cmd bar + F-keys + /-search end-to-end)" — Turn 12 sub-turn re-audit corrected the hydration-fix claim from "kickstart resolved" to "structural mounted-gate fix"; other deliverables in the row stood.

### Decision rubric

| If the finding... | Shape | Why |
|---|---|---|
| affects 3+ closed rows OR a hard-to-enumerate class of claims | A (block-level) | scope > row-level; per-row stamping would be repetitive and hard to keep in sync |
| affects exactly 1 closed row's resolution narrative | B (per-row) | local invalidation; localizing the correction keeps reader-eye attention at the right row |
| affects 2 closed rows | B (per-row, applied twice) | still local-enough that 2 stamps are cheaper than a block-level note pointing at "those 2 rows below" |
| would FULLY invalidate a row (closure was wrong, item is actually still open) | NEITHER — re-open instead | move the row from CLOSED back to OPEN with a 🔄 status, document why in a new "Last processed" preamble paragraph; CLOSED-section annotations are for partial / qualifying corrections only |

### Anti-patterns

- ❌ Editing the original closure narrative directly (silently rewriting history).
- ❌ Mixing shapes for the same finding (block-level note + per-row stamp on each affected row).
- ❌ Re-opening a row by adding a 🔄 alongside the ✅ in the status column (corrupts the table shape and breaks the architect-gate hook's row-counting regex).
- ❌ Using `⚠️ CORRECTION` for OPEN-section narratives — the rule is CLOSED-section-only. OPEN-section "Last processed" paragraphs use `ARCHITECT ROUND-N CORRECTION` or similar inline notes per existing convention.

### Why this rule exists

Turn-15 architect ⚠️ flagged drift: Turn 12 used per-row inline `⚠️ CORRECTION` stamps, Turn 15 used a block-level note immediately after `## CLOSED`. Both shapes were locally reasonable but the absence of policy meant a future Claude would guess — and a guess might land on a third shape, fragmenting the convention. This rule pins the choice on scope, not on developer preference, so the same finding always lands in the same shape regardless of who's writing.

## Pre-TurnGoal verification — cross-grep CLOSED before declaring (codified Turn HH, closes architect Turn-GG Round-1 💡)

For any CARRYOVER row with `turns-open ≥ 30` being picked as a TurnGoal closure target, run a quick CLOSED-section grep against the row's distinguishing tokens BEFORE declaring TurnGoal — surfaces the "already-shipped duplicate" drift class instantly without the 3-redeclare cycle that Turn GG hit.

**Workflow:**
```bash
# Before declaring "Turn N: close <row at L<N>>" — run:
grep -i "<2-3 distinctive tokens from row's item-text>" docs/CARRYOVER.md
# Look for ✅ rows. If any match, the closure may already be shipped —
# pivot to pure CARRYOVER hygiene migration OR pick a different row.
```

**Empirical justification:** during Phase 7.G autonomy block (Turns R-GG = 16 turns), the audit-stale-carryover.ts script + manual re-audits surfaced 8 un-migrated duplicates. Most originated from Turn 33.5's multi-closure batch (4 of 8) plus the Turn-26 vague-blocker cohort (3 of 8). The ratio suggests ~12.5% drift rate among `turns-open ≥ 30` developer-owned rows. Pre-TurnGoal grep cost: ~30s. Saved: ~3-15min per duplicate (the redeclare + pivot + narrative work). Net: positive after the first catch.

**When NOT to apply:** rows opened in the last 5-10 turns (low duplication risk) + rows with very generic item-text where grep produces too much noise (defer to architect Round-1 to catch). Pure-hygiene "drift-class sweep" turns (e.g. Turn EE Round-1 sweep) are exempt — they're explicitly closing duplicates.

**Future enhancement (Turn-HH filed 🔄):** `audit-stale-carryover.ts` v3 with marker-extraction matcher (anchored on `Bug #N` / `Turn N` / `Phase X` regex patterns) would automate this check. Until v3 ships, the manual grep is the reliable safety net.


## Q&A heartbeat-only convention (Phase 7.G Turn XXII codification)

For pure Q&A / information-only turns where user asks a question (e.g. "сколько ещё осталось" / "предложи как ускорить") and answer is delivered inline without source delta, the protocol allows **heartbeat-only CARRYOVER touch**:

1. **No counter-bump on Q&A turns.** Bumping `turns-open` for zero-work would inflate counters wrongly (exactly the bloat that drove backlog-bankruptcy concern in Turn XVII). Counter-bump fires ONLY when actual closure or substantive scope-shift happened.

2. **Heartbeat = 1-line preamble add.** Add a short `**Last processed:**` preamble at top of OPEN section noting the Q&A turn + topic. mtime touched, hook satisfied, no row-counter inflation.

3. **Skip ROADMAP §Changelog for Q&A turns.** Changelog is for shipped work. Q&A turn = no shipped work = no changelog entry.

4. **Skip architect Round-1 if hook permits** — currently architect-gate.sh fires regardless. Defer to `feedback_session_speedup.md` infra item #16.

## Compact CARRYOVER CLOSED narrative template

500-word essays per closure are bloat that adds little signal. Use ≤200-word template (saves 1-2min/turn writing):

```
| ✅ | YYYY-MM-DD | Phase 7.G Turn <N> closure (commit `<hash>`) — closes <Nt>-turn 🔄 (CARRYOVER L<NNN>). Per user "<RAW msg verbatim>". Premise: <verified yes/no, 1 line — "grep'd cited code, still present" or "premise re-checked, scope corrected from X→Y">. **Shipped — <X NEW / Y EDITS / Z schema>:** (1) <file:LOC change>, (2) <file:LOC change>. **Verification:** tsc <0/N>; vitest <pre→post>/<total> across <N> files; visual gate <2/2 GREEN / N/A>; <hook tests if any>. **CARRYOVER:** <pre> → <post> (<delta> net). Counter-bump <N> rows via /tmp/claude/bump_carryover_turnN.py OR `npm run carryover:bump`. <Streak metric line — Nth consecutive feature-shaped commit / 0 ⚠️ across N turns>. | <one-line item summary> |
```

Drop these from default (only add when load-bearing):
- Detailed line-by-line implementation prose (commit message body has it)
- Architect-narrative-style "Хорошо/Проблемы/Предложения" recap (already in Round-1 reply)
- Multi-paragraph rationale (architect prompt has it)
- Cross-references to OTHER closure narratives (reader can git log)

Keep these (always):
- Premise re-verify result (yes/no/scope-correction)
- Verification line (tsc/vitest/visual gate)
- CARRYOVER delta (`pre → post (delta net)`)
- Streak metric (architect-readable signal of momentum)

## Single-canonical-narrative — kill triple duplication

Pre-XXII convention wrote same closure narrative 3×:
- CARRYOVER CLOSED row (~500 words)
- commit message body (~300 words)
- ROADMAP §Changelog entry (~150 words)

**Canonical**: CARRYOVER CLOSED row (compact ≤200 words per template above).
**Pointer**: commit message body — 5-10 lines, last line `See CARRYOVER L<NNN> for full closure narrative.`
**Summary**: ROADMAP §Changelog — 1-line `Phase 7.G Turn <N> — <one-line>; CARRYOVER <pre>→<post> (<delta> net); see CARRYOVER L<NNN>.`

Save: 2-3 min/turn writing time. Reader still gets all the detail in the canonical home, doesn't have to read 3 versions to verify they match.
