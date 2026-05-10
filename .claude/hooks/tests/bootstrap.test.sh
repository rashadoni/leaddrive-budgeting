#!/usr/bin/env bash
# Regression guard for `.claude/hooks/bootstrap.sh` slug derivation +
# worktree-aware dual-target sync (Phase 7.G Turn LXXX follow-up + ²).
#
# Tests source the production functions from `bootstrap.sh` directly
# (rather than re-implementing them locally) — closes architect ⚠️
# false-green class flagged on follow-up² re-review per
# `feedback_verify_one_layer_up.md` (gate must exercise production code).
#
# Run: bash .claude/hooks/tests/bootstrap.test.sh
# Expected: all tests pass, exit 0.

set -uo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/bootstrap.sh"

# Source production functions (bootstrap.sh has main-guard so this loads
# helpers without executing the sync body).
# shellcheck disable=SC1090
source "$HOOK"

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

echo "== bootstrap.sh slug derivation + dual-target (Turn LXXX f/u + ²) =="

# --- to_slug() — production helper ---
assert_eq \
  "$(to_slug "/Users/rashadrahimov/Documents/leaddrive-budgeting")" \
  "-Users-rashadrahimov-Documents-leaddrive-budgeting" \
  "to_slug main-repo path → canonical slug"

assert_eq \
  "$(to_slug "/Users/rashadrahimov/Documents/leaddrive-budgeting/.claude/worktrees/jovial-wilbur-c05126")" \
  "-Users-rashadrahimov-Documents-leaddrive-budgeting--claude-worktrees-jovial-wilbur-c05126" \
  "to_slug worktree path → double-dash for /.claude/"

assert_eq \
  "$(to_slug "/foo/.bar/baz")" \
  "-foo--bar-baz" \
  "to_slug /foo/.bar/baz → -foo--bar-baz"

assert_eq \
  "$(to_slug "/x/y.z.w")" \
  "-x-y-z-w" \
  "to_slug multi-dot path → all dots → -"

assert_eq "$(to_slug "")" "" "to_slug empty → empty (edge case)"
assert_eq "$(to_slug "/")" "-" "to_slug / → - (root edge case)"

# --- detect_canonical_root() — production helper ---
# In this worktree, canonical resolution should walk back to /leaddrive-budgeting.
canonical=$(detect_canonical_root "$(pwd)")
case "$canonical" in
  */leaddrive-budgeting)
    report "detect_canonical_root in worktree → ends in /leaddrive-budgeting" 1
    ;;
  *)
    echo "    actual: $canonical" >&2
    report "detect_canonical_root in worktree → ends in /leaddrive-budgeting" 0
    ;;
esac

# Soft-fail: non-git directory should echo input unchanged.
nongit=$(detect_canonical_root "/")
assert_eq "$nongit" "/" "detect_canonical_root on non-git path → echoes input (soft-fail)"

# --- compute_targets() — production helper ---
# In this worktree (cwd != canonical), expect 2 distinct mirror paths.
# macOS default bash is 3.2 — no mapfile. Use while-read for portability.
targets=()
while IFS= read -r line; do targets+=("$line"); done < <(compute_targets "$(pwd)" "/fake/home")
assert_eq "${#targets[@]}" "2" "compute_targets in worktree → 2 targets (worktree + canonical)"

# Both should be under the supplied home root.
case "${targets[0]}" in
  /fake/home/.claude/projects/*/memory)
    report "compute_targets target[0] under fake home root" 1
    ;;
  *)
    echo "    actual: ${targets[0]}" >&2
    report "compute_targets target[0] under fake home root" 0
    ;;
esac

# Worktree target uses double-dash slug.
case "${targets[0]}" in
  *--claude-worktrees-*)
    report "compute_targets target[0] uses double-dash worktree slug" 1
    ;;
  *)
    echo "    actual: ${targets[0]}" >&2
    report "compute_targets target[0] uses double-dash worktree slug" 0
    ;;
esac

# Canonical target does NOT contain `--claude-worktrees-` (just the repo name).
case "${targets[1]}" in
  *--claude-worktrees-*)
    echo "    actual: ${targets[1]}" >&2
    report "compute_targets target[1] is canonical (no --claude-worktrees- segment)" 0
    ;;
  *-leaddrive-budgeting/memory)
    report "compute_targets target[1] is canonical (no --claude-worktrees- segment)" 1
    ;;
  *)
    echo "    actual: ${targets[1]}" >&2
    report "compute_targets target[1] is canonical (no --claude-worktrees- segment)" 0
    ;;
esac

# Dedup: when canonical == input, only 1 target.
targets_main=()
while IFS= read -r line; do targets_main+=("$line"); done < <(compute_targets "/some/non-git/path" "/fake/home")
assert_eq "${#targets_main[@]}" "1" "compute_targets in main-repo (non-git path) → 1 target (dedup)"

# --- Integration: bootstrap.sh runs end-to-end with fake HOME ---
# Verifies production code (not test re-implementation) actually creates
# the mirror dirs. Uses $TMPDIR for sandbox-writable scratch space.
FAKE_HOME="$TMPDIR/bootstrap-test-fakehome-$$"
rm -rf "$FAKE_HOME" 2>/dev/null || true
mkdir -p "$FAKE_HOME"
output=$(HOME="$FAKE_HOME" bash "$HOOK" 2>&1)
exit_code=$?

# Stdout must contain `{}` for SessionStart-hook contract.
case "$output" in
  *'{}'*)
    report "bootstrap.sh end-to-end → emits {} on stdout" 1
    ;;
  *)
    echo "    actual stdout/stderr: $output" >&2
    report "bootstrap.sh end-to-end → emits {} on stdout" 0
    ;;
esac

assert_eq "$exit_code" "0" "bootstrap.sh end-to-end → exit 0"

# Both worktree-slug + canonical-slug mirrors should exist under fake home.
mirror_count=$(find "$FAKE_HOME/.claude/projects" -maxdepth 2 -type d -name memory 2>/dev/null | wc -l | tr -d ' ')
assert_eq "$mirror_count" "2" "bootstrap.sh end-to-end → 2 mirrors created (worktree + canonical)"

# Verify a known memory file landed in BOTH mirrors.
worktree_file=$(find "$FAKE_HOME/.claude/projects" -path "*--claude-worktrees-*/memory/MEMORY.md" 2>/dev/null | head -1)
canonical_file=$(find "$FAKE_HOME/.claude/projects" -path "*-leaddrive-budgeting/memory/MEMORY.md" 2>/dev/null | head -1)
[ -f "$worktree_file" ] && r=1 || r=0
report "MEMORY.md present in worktree mirror" $r
[ -f "$canonical_file" ] && r=1 || r=0
report "MEMORY.md present in canonical mirror" $r

# Cleanup
rm -rf "$FAKE_HOME"

echo ""
echo "Results: $pass_count passed, $fail_count failed"
[ "$fail_count" = "0" ]
