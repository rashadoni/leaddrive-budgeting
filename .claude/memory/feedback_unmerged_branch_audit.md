---
name: Audit unmerged branches at session end
description: Run `bash scripts/audit-unmerged-branches.sh` before declaring a session done; refuse to ship if a worktree branch has >7-day unmerged commits.
type: feedback
originSessionId: 655f3099-5ff0-4f97-8ca6-270171766e37
---
Before declaring "session done" when work happened in a worktree, run:

```bash
bash scripts/audit-unmerged-branches.sh
```

If the script returns exit 1 (stale unmerged branches), surface the list to
the user with a one-line recommendation per branch (merge / cherry-pick /
drop). Do not call the session complete with red flags hanging.

**Why:** 2026-05-16 audit caught 16 commits stuck on `claude/brave-lehmann-1520db`
(Phase 7.G turns XLIII–LVIII: Board Deck PDF export via Playwright,
AI-narrated executive summary, IntelFeedPanel + INT GO verb, Anthropic
web_search LLM, ChartOfAccount FK wiring, AAC product catalog extraction,
industries source-of-truth). Each Claude Code session creates its own
worktree branch; the previous protocol had no "did we merge it back?"
check, so the branches accumulated and the work silently vanished from
main's history while the worktree directories kept it on disk. The user
discovered it ~9 days later via a deep-analysis request.

**How to apply:**
- Each session that creates a worktree must merge or explicitly drop its
  branch before ending.
- Audit script lives at `scripts/audit-unmerged-branches.sh`; exit code 1
  on any branch >7 days stale with unmerged commits.
- If a branch is superseded (its idea was reimplemented differently on
  main), `git branch -D <name>` explicitly — leaving it dangling reads
  as "lost work" on a future audit.
- For multi-day worktrees (e.g. ongoing Phase 7.I), it's fine to leave
  the branch yellow (<7d); the script differentiates 🟡 fresh from
  🔴 stale so noise stays low.
