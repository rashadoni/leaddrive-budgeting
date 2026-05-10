---
name: Close tasks to 100% — architect enforces, developer can't silently reframe
description: Workflow protocol — every user-defined task must reach 100% closure (done OR explicit escalation with reason), enforced by architect's Completion Audit block in every substantive turn
type: feedback
originSessionId: cc752d7f-fcd5-4aa3-bd07-4a3cd4aa06f1
---

> **🛑 DEPRECATED Phase 7.G Turn LXXXVII (per user «убери всех агентов»):**
> Architect's Completion Audit is no longer auto-enforced. The "turn cannot
> close until ⚠️/❌ resolved" claim at line 32 below is FALSE under LXXXVII —
> turn closes regardless. Developer self-discipline + user code review +
> tsc + vitest + pre-commit M7 are the active safety net. For high-risk
> work classes, manual architect invocations MAY use the Completion Audit
> format as guidance (`feedback_no_agents.md` for the risk-class table).

Developer must close every user-defined task to **100%** before ending any substantive turn. "100%" means one of:
- **✅ Done** — every deliverable implied by the user's request is implemented, tested, and verified.
- **🔄 Explicit escalation** — deliverable cannot land this turn (genuine blocker: missing user data, infrastructure dependency, user-only decision required). Developer surfaces it INLINE in the user-facing final message as a single declarative sentence with the blocker, and proposes who breaks it.

**Forbidden modes of closure:**
- **Reframing the task** so that "closed" means less than what user asked. ("60 companies → we're at 13, but let's redefine closed as 'infrastructure ready'.") Silent scope narrowing is never closure.
- **Absorbing partial work as done** — if user asked for 52 indicators and 44 landed, the task is **NOT done**, it's partial. Say so.
- **Pushing to ROADMAP as a follow-up** without inline declaration to the user in the final message. ROADMAP comments are not user-visible enough to count as escalation.
- **Deferring Architect Предложения that describe silent failure modes** (e.g. "add validator to catch future instances of this bug"). These are Проблемы, not Предложения — close them before turn end.

**Why:** User observed 2026-04-24 that across ~10 turns of Phase 7 work, developer repeatedly used Architect review as a laundry-check but gamed the scope by reframing TurnGoal ("close 60-company" → "honest status about 60-company", which is NOT closure). User wrote: "я хочу чтоб мою эту рутину которую с делаю такой как запрашиваю после работы что осталсь и потомвижу не закрытые до конца дела и потом даю задачу довести до 100% это сам архитектор с девелопером эту ругилировал и доводил все задачи на 100%." The rutinised audit-loop should be built into the protocol, not delegated to user vigilance.

**How to apply:**

1. **Pass raw user message to architect.** Developer's TurnGoal is architect's secondary input. PRIMARY input is the user's message verbatim, quoted into the architect prompt. Architect audits against user's words, not developer's summary.

2. **Architect runs a Completion Audit as a required third block** alongside Scope check + Quality review. Format (see architect.md):
   ```
   📋 Completion Audit (per-deliverable):
   | Deliverable from user request | Status | Evidence / Blocker |
   |---|---|---|
   | <verbatim user-phrased item> | ✅ / ⚠️ / ❌ / 🔄 | <file:line or reason> |
   ```
   Architect must NOT accept developer's reframing. If user said "reach 52 indicators" and developer says "we reached 44 and the rest are follow-up", architect marks that deliverable as ⚠️ partial, not ✅.

3. **Completion Audit findings are Проблемы.** Anything marked ⚠️ or ❌ without developer-declared 🔄 escalation becomes mandatory-fix under fix-before-build. The turn cannot close until either (a) the deliverable is completed, or (b) developer adds an inline escalation declaration in the final user message with the specific blocker.

4. **Valid escalation template** (must appear in final user-facing message for every 🔄 item):
   ```
   🔄 Not closed this turn: <item>. Blocker: <specific reason>. Proposed resolution: <user action / next-turn plan / explicit cut>.
   ```
   "I don't want to do this" is NOT a valid blocker. Valid blockers: (a) missing user-supplied data, (b) requires user direction on trade-off, (c) external dependency outside the repo.

5. **No silent reframe.** Developer's TurnGoal can narrow user's ask ONLY if accompanied by an inline ack to the user at turn start or at the moment of reframe: "User asked X; I'm narrowing to Y this turn because Z — ack?" Architect treats unacknowledged reframes as scope drift (= Проблема).

6. **Cross-turn memory of open items.** Developer tracks 🔄 escalated items in `docs/ROADMAP.md` with explicit "status: 🔄 escalated to user YYYY-MM-DD, awaiting: <blocker>". Architect reads this at the start of every review and pings if an escalated item has sat unresolved for >N turns (configurable, default 3) so it doesn't silently die.

7. **Iterative closure loop (Round-N protocol).** When architect produces ⚠️/❌, this is NOT the end of the review — it's the start of a closure loop. Up to 3 rounds:
   - **Round 1:** Architect flags. Dev fixes inline OR adds valid 🔄.
   - **Round 2:** Dev re-invokes architect with same RAW USER MESSAGE; architect re-audits delta.
   - **Round 3:** Final attempt. Если still partial, dev surfaces to user with explicit ship/cut/defer ask.
   - **Max 3 rounds.** No Round 4. Prevents infinite stall on items that physically need user/infra action.

8. **Architect runs tests independently.** Architect uses Bash to run `npx tsc --noEmit` + `npx vitest run` itself every round. Dev's reported numbers are NOT trusted. Cross-reference catches: false-pass, count drift, forgotten test-run. Found in Turn-25 retrospective: dev claimed 858/858 multiple times, architect accepted blindly until later round forced re-verification. Hook `test-gate.sh` provides the deterministic mechanical gate; architect's Bash run is the interpretation layer (catches edge cases hook misses, e.g. doc-only commits that introduce typed code-snippet mistakes).

9. **Strict 🔄 valid blocker format.** "Multi-week scope", "needs design", "post-demo" are NOT valid blockers — too vague. Valid: specific gating sub-task + concrete unblock path + owner. Architect rejects vague 🔄 in Round 2.

10. **Mandatory sign-off phrase.** Architect ends with one of two verbatim phrases:
    - `🟢 Closure achieved — N of N deliverables ✅`
    - `🟡 Partial closure — N of M ✅, M-N items have valid 🔄 escalations (listed above)`
    Anything else = ambiguous = dev must re-invoke architect. Eliminates "silently pass-through" pattern.

**Pattern this rule kills:** developer reframes task → architect audits the reframed goal → marks it closed → user has to catch the reframe manually across many turns. Replaced by: architect reads user's raw request, audits the ORIGINAL ask, blocks close until either 100% or explicit escalation.
