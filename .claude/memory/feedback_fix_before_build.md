---
name: Fix before build — always close open issues before new features
description: Workflow preference — finish fixes/repairs/regressions first, then move to new feature work; applies across the whole project
type: feedback
originSessionId: cc752d7f-fcd5-4aa3-bd07-4a3cd4aa06f1
---
Always finish fixes (bugs, regressions, review findings, TODOs surfaced during the previous turn) BEFORE starting any new feature, component, or module. Never park a known issue as "deferred" while jumping to new development.

**Why:** User stated this as a durable preference on 2026-04-23 after an architect review surfaced two open items (systemic `getSession` empty-orgId fix + numeric-level whitelist) and I asked whether to defer them. User's response: "сначала всегда … исправляем чиним фиксим а потом уже создаем и разрабатываем." Treat any suggestion to defer as incorrect unless the user explicitly accepts deferral.

**How to apply:**
- When an architect/code review flags issues, close ALL of them in the same session before proposing next-feature work.
- When you're about to say "let's defer X" or add "TODO" to ROADMAP — pause and fix X instead, unless it's genuinely blocked (missing dependency, requires user decision with real tradeoffs).
- In review/summary messages: don't present deferral as a normal option. Default path is fix-now.
- Only mark something ⏳ TODO in ROADMAP if there's a real blocker (e.g. network-blocked `npm install`) — not because "scope creep."

## ⚠️ Phase 7.G Turn LXXXI exception — single-round architect

User confirmed Option B on 2026-05-10: **architect review is single-round per turn**. After ONE architect round, ⚠️ items become 🔄 rows in `docs/CARRYOVER.md`, and the turn closes regardless of verdict. See `feedback_single_round_architect.md`.

**Fix-before-build still applies to:**
- Security regressions (auth bypass, org-isolation leak, PII exposure)
- Runtime broken (`tsc` errors, `vitest` failures, production 500s on happy-path)
- Pre-existing test failures
- CARRYOVER freshness gaps (single Edit closes)

**Fix-before-build does NOT apply to** (file as 🔄 row, turn closes):
- Test design quality (false-green class, missing edge cases, brittle assertions)
- Hook-internal style/refactor (covered by hook test suite)
- Code style, naming, unused imports
- Doc/typo nits
- Refactor opportunities not blocking shipped behavior

This exception kills the architect-FAIL → fix → re-architect spiral that burned 8-25 min/turn for diminishing returns. Real bug-catching is delegated to `tsc` + `vitest` + pre-commit M7 + periodic audit. Architect's per-turn role narrows to: scope check + one-shot quality pass + ⚠️ enumeration. Re-iteration to PASS within a turn is **prohibited** unless one of the four hard exceptions above applies.
