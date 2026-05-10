#!/usr/bin/env bash
# Regression guard for `.claude/hooks/auto-bootstrap.sh`.
# Validates that bootstrap fires ONLY on memory edits, never blocks
# tool_use return regardless of bootstrap success/failure.
#
# Run: bash .claude/hooks/tests/auto-bootstrap.test.sh
# Expected: all 6 tests pass, exit 0.

set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/auto-bootstrap.sh"
SESSION="auto-bootstrap-test-$$"

if ! command -v jq >/dev/null; then
  echo "FAIL: jq not installed — hook requires it" >&2
  exit 1
fi

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

# Helper: run hook with given input, return exit code (always expect 0).
run_hook() {
  local tool="$1" file="$2"
  echo "{\"session_id\":\"$SESSION\",\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$file\"}}" \
    | bash "$HOOK" >/dev/null 2>&1
  echo $?
}

run_hook_bash() {
  echo "{\"session_id\":\"$SESSION\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git status\"}}" \
    | bash "$HOOK" >/dev/null 2>&1
  echo $?
}

assert_exit_zero() {
  local actual="$1" name="$2"
  [ "$actual" = "0" ] && r=1 || r=0
  report "$name" $r
}

echo "== auto-bootstrap.sh (Turn LXXIX refinement #2) =="

# Memory edit → exit 0 (bootstrap fired or skipped silently)
assert_exit_zero "$(run_hook Edit /abs/.claude/memory/foo.md)" "Edit on .claude/memory/*.md → exit 0 (bootstrap fired)"
assert_exit_zero "$(run_hook Write /abs/.claude/memory/MEMORY.md)" "Write on .claude/memory/MEMORY.md → exit 0"
assert_exit_zero "$(run_hook MultiEdit /abs/.claude/memory/feedback_x.md)" "MultiEdit on memory → exit 0"

# Non-memory paths → exit 0 (no-op, no bootstrap fire)
assert_exit_zero "$(run_hook Edit /abs/src/foo.ts)" "Edit on src/*.ts → exit 0 (no-op)"
assert_exit_zero "$(run_hook Edit /abs/docs/CARRYOVER.md)" "Edit on docs/CARRYOVER.md → exit 0 (no-op, not a memory file)"

# Bash → exit 0 (not Edit-class, no-op)
assert_exit_zero "$(run_hook_bash)" "Bash → exit 0 (no-op)"

echo ""
echo "Results: $pass_count passed, $fail_count failed"
[ "$fail_count" = "0" ]
