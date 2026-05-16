#!/usr/bin/env bash
# Audit script — surfaces work that exists on a branch but never landed on main.
#
# Why: Phase 7.G Turn LVIII session-handoff revealed 16 commits stuck on
# `claude/brave-lehmann-1520db` (Board Deck PDF export, IntelFeedPanel, etc.)
# that never made it back. Each Claude Code session creates its own worktree
# branch; without a "did we merge?" check, branches silently accumulate.
#
# Usage:
#   bash scripts/audit-unmerged-branches.sh
#
# Run this:
#   - At session-end before declaring work "done"
#   - Weekly as part of repo hygiene
#   - Before deploys (CI should refuse a deploy if any branch >7 days has
#     unmerged commits)
#
# Exit codes:
#   0 — every branch is either merged or fast-forward-equivalent to main
#   1 — one or more branches have unmerged commits older than 7 days

set -euo pipefail

# Resolve repo root regardless of where the script is invoked from.
REPO=$(git rev-parse --show-toplevel)
cd "$REPO"

# Reference branch — assume `main` is the integration target.
INTEGRATION_BRANCH=${INTEGRATION_BRANCH:-main}

echo "Audit: unmerged branches vs $INTEGRATION_BRANCH"
echo "Repo:  $REPO"
echo "Now:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "────────────────────────────────────────────────────────────────────────"

EXIT_CODE=0
WARN_AGE_DAYS=7

for branch in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  [[ "$branch" == "$INTEGRATION_BRANCH" ]] && continue

  unmerged_count=$(git rev-list --count "$INTEGRATION_BRANCH..$branch" 2>/dev/null || echo 0)
  if [[ "$unmerged_count" == "0" ]]; then
    continue
  fi

  # Latest commit timestamp on the branch (UTC, seconds since epoch).
  last_commit_ts=$(git log -1 --format='%ct' "$branch")
  now_ts=$(date -u +%s)
  age_days=$(( (now_ts - last_commit_ts) / 86400 ))

  # Color-code by age. Tag the branch's HEAD subject for quick read.
  head_subject=$(git log -1 --format='%s' "$branch" | head -c 80)
  if [[ "$age_days" -gt "$WARN_AGE_DAYS" ]]; then
    flag="🔴 STALE"
    EXIT_CODE=1
  else
    flag="🟡 fresh"
  fi

  echo "$flag  $branch"
  echo "    commits ahead: $unmerged_count · last commit: ${age_days}d ago"
  echo "    head: $head_subject"
  echo
done

if [[ "$EXIT_CODE" == "0" ]]; then
  echo "✅ No stale unmerged branches."
else
  echo "────────────────────────────────────────────────────────────────────────"
  echo "🔴 At least one branch is >${WARN_AGE_DAYS} days stale with unmerged work."
  echo
  echo "To rescue:"
  echo "  1. git log --oneline $INTEGRATION_BRANCH..<branch>   # see what's there"
  echo "  2. git diff $INTEGRATION_BRANCH...<branch> -- <path> # per-file diff"
  echo "  3. git cherry-pick / merge / rebase as appropriate"
  echo "  4. If superseded: git branch -D <branch>   # drop it explicitly"
fi

exit $EXIT_CODE
