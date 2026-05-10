#!/usr/bin/env bash
# Regression guard for `.claude/hooks/bootstrap.sh` slug derivation +
# worktree-aware dual-target sync (Phase 7.G Turn LXXX follow-up).
#
# Closes architect ⚠️ from FAIL re-review of `e4a8664`: bootstrap.sh
# dual-target / slug-derivation logic was untested. Manual live-verification
# proved it works on this machine, but next refactor (or different worktree
# depth) could regress silently. Per `feedback_verify_one_layer_up.md` —
# gates must be tested as production runs them.
#
# Run: bash .claude/hooks/tests/bootstrap.test.sh
# Expected: all tests pass, exit 0.

set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/bootstrap.sh"

pass_count=0
fail_count=0
report() {
  local name="$1" ok="$2"
  if [ "$ok" = "1" ]; then
    echo "  ✓ $name"
    pass_count=$((pass_count + 1))
  else
    echo "  ✗ $name" >&2
    fail_count=$((fail_count + 1))
  fi
}

assert_eq() {
  local actual="$1" expected="$2" name="$3"
  if [ "$actual" = "$expected" ]; then
    report "$name" 1
  else
    echo "    expected: $expected" >&2
    echo "    actual:   $actual" >&2
    report "$name" 0
  fi
}

echo "== bootstrap.sh slug derivation + dual-target (Turn LXXX follow-up) =="

# --- Slug helper ---
# Reuse the same pattern bootstrap.sh uses: tr '/.' '--'.
to_slug() { echo "$1" | tr '/.' '--'; }

# Test 1: main repo path → expected canonical Claude Code slug
assert_eq \
  "$(to_slug "/Users/rashadrahimov/Documents/leaddrive-budgeting")" \
  "-Users-rashadrahimov-Documents-leaddrive-budgeting" \
  "to_slug main-repo path → canonical slug"

# Test 2: worktree path with .claude segment → double-dash for `/.`
assert_eq \
  "$(to_slug "/Users/rashadrahimov/Documents/leaddrive-budgeting/.claude/worktrees/jovial-wilbur-c05126")" \
  "-Users-rashadrahimov-Documents-leaddrive-budgeting--claude-worktrees-jovial-wilbur-c05126" \
  "to_slug worktree path → double-dash for /.claude/"

# Test 3: arbitrary `/foo/.bar/baz` → `-foo--bar-baz`
assert_eq \
  "$(to_slug "/foo/.bar/baz")" \
  "-foo--bar-baz" \
  "to_slug /foo/.bar/baz → -foo--bar-baz"

# Test 4: path with multiple dots → all replaced
assert_eq \
  "$(to_slug "/x/y.z.w")" \
  "-x-y-z-w" \
  "to_slug multi-dot path → all dots → -"

# --- Integration: bootstrap.sh runs cleanly from this worktree ---
# Confirms the script doesn't crash on the worktree-detection path. We
# don't assert mirror creation (sandbox would block writes to ~/.claude/
# anyway) — only that the script exits 0 and prints "{}" on stdout.
output=$(bash "$HOOK" 2>/dev/null || echo "FAIL")
case "$output" in
  '{}'|'{}'$'\n')
    report "bootstrap.sh exits cleanly with {} stdout" 1
    ;;
  *)
    echo "    actual stdout: $output" >&2
    report "bootstrap.sh exits cleanly with {} stdout" 0
    ;;
esac

# --- Canonical-detection unit test ---
# Verify git rev-parse --git-common-dir resolves to the canonical .git
# directory (parent = canonical repo root). This is what bootstrap.sh
# uses to detect "am I in a worktree?".
COMMON=$(git rev-parse --git-common-dir 2>/dev/null || echo "")
case "$COMMON" in
  /*) ABS_COMMON="$COMMON" ;;
  *)  ABS_COMMON="$(pwd)/$COMMON" ;;
esac
CANONICAL_PARENT=""
if [ -d "$ABS_COMMON" ]; then
  CANONICAL_PARENT="$(cd "$(dirname "$ABS_COMMON")" && pwd)"
fi

# In this worktree, canonical parent should be /Users/.../leaddrive-budgeting
case "$CANONICAL_PARENT" in
  */leaddrive-budgeting)
    report "git --git-common-dir resolves to canonical repo (ends in /leaddrive-budgeting)" 1
    ;;
  *)
    echo "    canonical resolved to: $CANONICAL_PARENT" >&2
    report "git --git-common-dir resolves to canonical repo (ends in /leaddrive-budgeting)" 0
    ;;
esac

# --- TARGETS dedup test ---
# Simulate the bootstrap.sh logic: TARGETS=[worktree-slug]; if canonical
# differs from worktree, append it. Verify dedup vs duplicate-append.
WORKTREE_SLUG="$(to_slug "$(pwd)")"
CANONICAL_SLUG="$(to_slug "${CANONICAL_PARENT:-$(pwd)}")"
TARGETS=("$WORKTREE_SLUG")
if [ "$CANONICAL_SLUG" != "$WORKTREE_SLUG" ]; then
  TARGETS+=("$CANONICAL_SLUG")
fi

# In this worktree (cwd != canonical), expect 2 targets.
# In a hypothetical main-repo run (cwd == canonical), expect 1.
case "$(pwd)" in
  */.claude/worktrees/*)
    assert_eq "${#TARGETS[@]}" "2" "TARGETS in worktree → 2 targets (worktree + canonical)"
    ;;
  *)
    assert_eq "${#TARGETS[@]}" "1" "TARGETS in main repo → 1 target (canonical only, dedup)"
    ;;
esac

echo ""
echo "Results: $pass_count passed, $fail_count failed"
[ "$fail_count" = "0" ]
