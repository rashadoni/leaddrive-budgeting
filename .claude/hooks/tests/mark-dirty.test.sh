#!/usr/bin/env bash
# Regression guard for `.claude/hooks/mark-dirty.sh`.
# Validates the carve-out introduced Turn LXXVIII: docs/memory-only
# edits don't mark dirty (architect-gate skips); other edits do.
#
# Run: bash .claude/hooks/tests/mark-dirty.test.sh
# Expected: all 10 tests pass, exit 0.

set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/mark-dirty.sh"
SESSION="mark-dirty-test-$$"
DIRTY="${TMPDIR:-/tmp}/.claude-dirty-${SESSION}"

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

cleanup() {
  rm -f "$DIRTY"
}
trap cleanup EXIT

# Helper: run hook with given tool_name + file_path, return "DIRTY" / "CLEAN".
run_hook() {
  local tool="$1" file="$2"
  rm -f "$DIRTY"
  echo "{\"session_id\":\"$SESSION\",\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$file\"}}" \
    | bash "$HOOK" >/dev/null 2>&1
  if [ -f "$DIRTY" ]; then echo "DIRTY"; else echo "CLEAN"; fi
}

run_hook_bash() {
  local cmd="$1"
  rm -f "$DIRTY"
  echo "{\"session_id\":\"$SESSION\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$cmd\"}}" \
    | bash "$HOOK" >/dev/null 2>&1
  if [ -f "$DIRTY" ]; then echo "DIRTY"; else echo "CLEAN"; fi
}

echo "== mark-dirty.sh carve-out (Turn LXXVIII) =="

# Helper: assert hook output matches expected DIRTY/CLEAN.
# `report` expects 1=pass, 0=fail. Shell `[ ... ]` returns 0 on pass —
# invert via && r=1 || r=0 idiom.
assert_eq() {
  local expected="$1" actual="$2" name="$3"
  [ "$actual" = "$expected" ] && r=1 || r=0
  report "$name" $r
}

# Carve-out paths → CLEAN
assert_eq CLEAN "$(run_hook Edit /abs/.claude/memory/foo.md)" "Edit on .claude/memory/*.md → CLEAN (carve-out)"
assert_eq CLEAN "$(run_hook Edit /abs/docs/CARRYOVER.md)" "Edit on docs/CARRYOVER.md → CLEAN (carve-out)"
assert_eq CLEAN "$(run_hook Edit /abs/docs/ROADMAP.md)" "Edit on docs/ROADMAP.md → CLEAN (carve-out)"
assert_eq CLEAN "$(run_hook Edit /abs/CLAUDE.md)" "Edit on CLAUDE.md → CLEAN (carve-out)"
assert_eq CLEAN "$(run_hook Write /abs/docs/notes.md)" "Write on docs/*.md → CLEAN (carve-out)"

# Non-carve-out paths → DIRTY
assert_eq DIRTY "$(run_hook Edit /abs/src/foo.ts)" "Edit on src/*.ts → DIRTY (not carved out)"
assert_eq DIRTY "$(run_hook Edit /abs/prisma/schema.prisma)" "Edit on prisma/schema.prisma → DIRTY (schema affects runtime)"
assert_eq DIRTY "$(run_hook Edit /abs/.claude/hooks/foo.sh)" "Edit on .claude/hooks/*.sh → DIRTY (hook edits affect enforcement)"
assert_eq DIRTY "$(run_hook Edit /abs/.claude/agents/architect.md)" "Edit on .claude/agents/*.md → DIRTY (architect.md alters review)"
assert_eq DIRTY "$(run_hook Edit /abs/messages/en.json)" "Edit on messages/*.json → DIRTY (i18n affects UI runtime)"

# Bash → DIRTY (safe default; could do anything)
assert_eq DIRTY "$(run_hook_bash "git commit -m foo")" "Bash tool → DIRTY (safe default)"

# Suffix-collision safety: archive-docs/foo.md should NOT match `*/docs/*.md`
assert_eq DIRTY "$(run_hook Edit /abs/archive-docs/foo.md)" "Edit on archive-docs/foo.md → DIRTY (no false carve-out on suffix collision)"

# Some-docs.md (no /docs/ segment) should NOT match
assert_eq DIRTY "$(run_hook Edit /abs/some-docs.md)" "Edit on /abs/some-docs.md → DIRTY (no /docs/ segment)"

# Empty file_path → DIRTY (safe default)
rm -f "$DIRTY"
echo "{\"session_id\":\"$SESSION\",\"tool_name\":\"Edit\",\"tool_input\":{}}" | bash "$HOOK" >/dev/null 2>&1
[ -f "$DIRTY" ] && r=1 || r=0
report "Edit with no file_path → DIRTY (safe default)" $r

echo ""
echo "Results: $pass_count passed, $fail_count failed"
[ "$fail_count" = "0" ]
