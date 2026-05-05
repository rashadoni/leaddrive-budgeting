---
name: Session speedup playbook — apply when work feels too slow
description: 20 techniques to compress per-turn time from ~10-20min → ~4-8min. Apply when user surfaces "медленно" / pacing complaint OR proactively when session has 5+ similar-shape turns. Codified Phase 7.G Turn XXII after user explicit speedup ask.
type: feedback
---

# Session speedup playbook

User signal that triggers this memory: "медленно идёт работа" / "ускорить" / "из-за multi-agents медленно" / pacing complaint / 5+ similar-shape turns where per-turn time exceeds ~10min.

Per-turn time breakdown (typical 10-20 min/turn baseline):
- Read context / understand: 30s-2min
- Edits / shipping: 30s-3min
- tsc + vitest verification: 15-30s
- Visual gate (when needed): 7-10s
- CARRYOVER closure narrative + counter-bump: 2-4min
- ROADMAP changelog: 1-2min
- Commit (multi-line message): 1-2min
- Architect Round-1 invocation: 60-90s
- Round-1 fixes (when ⚠️): 1-3min + sometimes another architect call
- User-facing message: 1-2min

## 🔥 HIGH IMPACT (≥30% per-turn speedup)

### 1. Architect on Sonnet/Haiku for routine reviews
The architect subagent inherits parent model by default (Opus). Sonnet ~3× faster, Haiku ~5× faster.
For routine Round-1 (closure-shaped turns matching established patterns), specify `model: "sonnet"` or `model: "haiku"` per call:
```
Agent({subagent_type: "architect", model: "sonnet", description: "...", prompt: "..."})
```
Reserve Opus for: novel architecture decisions / multi-file refactors / cross-cutting concerns.
**Save: 30-60s × every architect call ≈ 50% speedup on overhead.**

### 2. Compact architect prompts + capped output
Default prompts: 200-500 lines (full diff explanation + 3 quick-scrutiny questions).
Default output: 200-500 word reviews.
Compact form: prompt ≤80 lines, request `"≤150 words; only Проблемы + Completion Audit; skip Хорошо/Предложения if 🟢"`.
Architect responds 3-5× faster on shorter context.
**Save: 30-60s + cheaper tokens.**

### 3. Parallel tool calls in single message
Sequential tool calls have ~5-10s round-trip each. Batch independent calls in ONE message:
- `tsc + vitest + bootstrap.sh` → 3 parallel Bash calls (not 3 sequential)
- Multiple Read calls when scoping context → parallel
- Independent grep/find probes → parallel
**Save: 30-60s/turn just by batching.**

### 4. Single-canonical-narrative — kill triple duplication
Currently same closure narrative written 3×:
- CARRYOVER CLOSED row (~500 words)
- commit message body (~300 words)
- ROADMAP §Changelog entry (~150 words)

**Convention**: CARRYOVER CLOSED is canonical (full detail). Commit message is pointer (`See CARRYOVER row L<NNN>`). ROADMAP changelog = 1-line summary + delta numbers.
**Save: 2-3 min/turn writing.**

### 5. Skip premise re-verify for fresh rows
`feedback_stale_premise_reverify.md` mandates premise re-verify on ≥30-turn-old rows. Default applies it to ALL rows currently.
**Convention**: only re-verify when `turns-open >= 30`. Fresh rows (≤14t) trust the original filing.
**Save: 30-60s/turn.**

## 🟡 MEDIUM IMPACT (10-30%)

### 6. Compact CARRYOVER CLOSED narrative template
500-word essays per closure are bloat. Compact ≤200-word template:
```
Phase 7.G Turn <N> closure (commit `<hash>`) — closes <Nt>-turn 🔄 (<row anchor>).
Per user "<RAW msg>". Premise: <verified yes/no, 1 line>.
Shipped — <X NEW / Y EDITS / Z schema>: (1) <file:LOC change>, (2) <file:LOC>, ...
Verification: tsc <0/N>; vitest <pre→post>/<total> across <N> files; visual gate <2/2 / N/A>.
CARRYOVER: <pre> → <post> (<delta> net). Counter-bump <N> rows via /tmp/claude/bump_*.py.
<Streak metric line>. <Phase note if relevant>.
```
**Save: 1-2min/turn writing.**

### 7. Counter-bump as one-liner Bash (not script-write step)
Replace `Write /tmp/claude/bump_carryover_turnN.py` + `python3 ...` with inline:
```bash
python3 -c "
import re, sys
from pathlib import Path
p = Path('docs/CARRYOVER.md')
t = p.read_text()
m1, m2 = re.search(r'^## OPEN', t, re.M), re.search(r'^## CLOSED', t, re.M)
o = t[m1.end():m2.start()]
n = re.sub(r'^(\| (?:🔄|⚠️) \| \d{4}-\d{2}-\d{2} \| )(\d+)( \|)', lambda m: f'{m.group(1)}{int(m.group(2))+1}{m.group(3)}', o, flags=re.M)
p.write_text(t[:m1.end()] + n + t[m2.start():])
print(f'bumped {n.count(chr(10))} rows')
"
```
Or `npm run carryover:bump` if a project-level script exists.
**Save: ~30-60s/turn (no separate file write step).**

### 8. Skip Round-1 architect for trivial single-line fixes
Single-line edits (typo / comment update / import order) don't need architect Round-1.
Rule: if commit diff is <5 LOC and fixed-shape (typo / comment / docstring / import sort), skip architect, commit straight.
**Save: 1-2min × every trivial fix.**

### 9. Batch 2-3 closures per turn → 1 architect call
Currently 1 closure = 1 architect Round-1.
**Convention**: when 2-3 closures share theme (e.g. companion ⚠️ items, related sub-tasks), batch into one turn with one consolidated architect review.
**Save: 1-2min per 2-3 batched turns.**

### 10. Skip vitest/tsc on bash-only / docs-only commits
Currently full suite runs every turn (~14s vitest, ~5s tsc).
**Rule**: if no `.ts`/`.tsx`/`.js`/`.jsx` files changed, skip vitest. If no `.ts(x)` files changed, skip tsc. Run focused vitest only on touched files when applicable.
**Save: ~5-15s/turn averaged.**

### 11. Pre-canned skill markers — skip discovery
When user invokes well-known protocol step (e.g. "проодолжай" = autonomy continue, "Phase C" = pivot forward), skip option-listing discovery cycle. Pick highest-leverage default and announce per `feedback_decide_next_step.md`.
**Save: 1-2 message round-trips.**

## 🔵 LOW IMPACT (<10% but cumulative)

### 12. Commit-message templating
Stop writing 30-50 line essays in commit body. Template:
```
<type>(<scope>): Phase 7.G Turn <N> — <one-line>

Closes <Nt>-turn 🔄 (CARRYOVER L<NNN>). Per user "<RAW>".
<2-3 sentences shipped>.

Verification: tsc 0; vitest <N>/<N>; <visual gate>; <hook tests if any>.
CARRYOVER: <pre> → <post> (<delta> net).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### 13. Skip Round-1 acknowledgment commits
When architect 🟢 with 0 ⚠️ and 0 💡, skip any acknowledgment edit — just move to next turn. Commit was already clean.

### 14. TodoWrite только при значимых state changes
Currently update 4-5x/turn (~100ms each). Reduce to: 1× at turn start (declare in_progress), 1× at turn end (mark completed). Skip mid-turn intermediate updates.

### 15. Single-message multi-file edits
When updating 5 files, do 5 Edit calls in single message (parallel-eligible), not 5 sequential messages.
**Save: 30-60s/turn on multi-file turns.**

## 🚧 INFRA-DEFERRED (high-impact, requires infra work)

### 16. `architect-gate.sh` carve-out for hygiene/Q&A turns
Currently the Stop hook fires on every turn that touches any file (mark-dirty.sh PostToolUse).
For Q&A turns where the only mutation is `docs/CARRYOVER.md` heartbeat (no commit, no source delta) OR commits typed `docs(carryover|roadmap):`, architect adds no value.
**Implementation path:** extend `architect-gate.sh` (carve-out check 0 BEFORE check 3): if all transcript Edit/Write target only `docs/CARRYOVER.md` AND no `git commit` was fired, skip architect requirement; OR if all `git commit` calls have type prefix `docs(carryover` / `docs(roadmap`, skip.
**Save: 1-2min × ~30-50% of turns.**
**Risk:** disables safety net for hygiene-shaped commits. Mitigation: developer self-discipline + memory rule + occasional spot-audit.
**Defer until:** explicit user approval (high-impact, but reverses a load-bearing protection).

### 17. `feedback_100_percent_closure.md` Q&A turn exemption
The "every turn requires architect" rule was written for substantive code turns. Q&A / pure information turns shouldn't trigger.
**Implementation path:** extend memory file with explicit Q&A-turn carve-out. Architect-gate hook needs to recognize the exemption marker.

## Cumulative impact

If all 1-15 applied (without infra-deferred):
- Per-turn time: ~10-20min → ~4-8min (50-60% reduction)
- Architect overhead: ~50-90s → ~20-40s per call (Sonnet + compact)
- Writing time per closure: ~5min → ~1-2min (canonical narrative + compact template)

If 16-17 also shipped: another ~30% on Q&A-heavy sessions.

## When NOT to apply

- **Novel architecture decisions** — keep Opus + verbose architect prompts.
- **Multi-file refactors with cross-cutting concerns** — full architect scrutiny.
- **First closure of a new pattern** — establish precedent at full quality before compacting.
- **User explicitly asks for thoroughness** — defer to user signal.

## Triggering conditions

Apply this playbook proactively when:
1. User surfaces "медленно" / "ускорить" / pacing complaint.
2. Session has 5+ consecutive similar-shape closure turns.
3. Per-turn time visibly exceeds ~10min for routine bounded items.
4. Architect 🟢 streak hits 5+ turns without ⚠️ (signal of routine pattern).

When in doubt, default to compact mode for routine + thorough mode for novel.
