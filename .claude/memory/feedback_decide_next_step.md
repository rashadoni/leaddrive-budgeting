---
name: Decide next step autonomously — don't ask "what's next"
description: Workflow preference — act as the architect when choosing between available next tasks; don't surface every decision for approval
type: feedback
originSessionId: cc752d7f-fcd5-4aa3-bd07-4a3cd4aa06f1
---
When there is a well-defined list of remaining tasks (e.g. Phase TODOs, review-suggested follow-ups, multiple open fronts), pick the highest-leverage next item yourself and just start executing. Don't end a turn asking "what do you want next — A or B?".

**Why:** User stated this on 2026-04-23 after repeatedly being asked "HeatMap or API route?"-style questions between turns: "так и на будущее сам уже решай как архитектор с чего продолжать и запускай." Stopping to ask every time breaks momentum — user prefers the architect role at a higher abstraction, not picking between obvious backend/frontend tradeoffs.

**How to apply:**
- When only one option makes technical sense (e.g. blocker unblocks something else), just do it, no prompt.
- When two options have a clear tradeoff, state the call + reasoning briefly AND start executing. User can redirect if they disagree.
- Ask only when: the decision touches user-facing scope in a way that requires their preference (e.g. "should this be auto or manual?"), or the options differ in cost by 10×+.
- Still end turns with a brief update on what was done — **NEVER** end with "стартую?" / "продолжаем?" / "запускаем?" or any variant. Just state the next step as a fact: "Next: X." If the stop hook fires an architect pass at the end, that's mechanical, not the user pausing you — carry on in the next turn.
- Phrases to avoid at turn end: "Стартую автономно?", "Стартуем X?", "Готов к Y?", "Следующий — Y. Стартуем?". Rephrase as: "Next: Y." or "Moving to Y."
- Works together with `feedback_fix_before_build.md`: fixes from review first, then pick next feature autonomously.
- User stated it twice (2026-04-23 + 2026-04-24): "и на будущее не проси меня чтоб давал команду на продолжение." Treat any turn-end question as a policy violation.
