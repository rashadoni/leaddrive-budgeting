#!/usr/bin/env bash
# Regression guard for `.claude/hooks/test-gate.sh`.
# Covers the 5 scenarios specified by Turn-26 architect Round-1 ⚠️
# (CARRYOVER L367, closed Turn S):
#   (a) clean state silent exit 0       — dirty + all-green
#   (b) broken-TS produces valid JSON   — dirty + tsc fails
#   (c) broken-vitest produces valid JSON — dirty + vitest fails
#   (d) no-dirty-marker skips           — !dirty + everything green
#   (e) ANSI color in tsc/vitest output → JSON still valid (control chars stripped)
# Preflight-jq path (Turn-S architect Round-1 💡) NOT covered — macOS
# bundles `jq` at `/usr/bin/jq`, so any PATH that includes system-bin
# resolves jq even without homebrew. Empty PATH breaks `set -euo pipefail`
# startup (no `cat` for `$(cat)`). Filed as concrete 🔄 with closure path
# (symlink-essentials-minus-jq scaffold). Architect explicit "не блокирует".
#
# Mocks `npx` via a $TMPDIR fakebin on PATH; the hook is invoked with that
# PATH override so neither real tsc nor real vitest run during the test.
#
# Run: bash .claude/hooks/tests/test-gate.test.sh
# Expected: all 5 tests pass, exit 0.

set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/test-gate.sh"
SESSION="test-$$"
DIRTY="${TMPDIR:-/tmp}/.claude-dirty-${SESSION}"
FAKE_BIN="${TMPDIR:-/tmp}/test-gate-fakebin-$$"

if ! command -v jq >/dev/null; then
  echo "FAIL: jq not installed — hook requires it" >&2
  exit 1
fi

mkdir -p "$FAKE_BIN"

# Fake npx — switches behavior via $NPX_MOCK_MODE env var. The hook calls
# `npx tsc --noEmit` then `npx vitest run --reporter=default`; mock keys
# off arg substring to fail one or the other.
cat > "$FAKE_BIN/npx" <<'NPX_EOF'
#!/usr/bin/env bash
case "${NPX_MOCK_MODE:-pass}" in
  fail_tsc)
    if [[ "$*" == *"tsc"* ]]; then
      echo "src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'."
      echo "Found 1 error in 1 file."
      exit 1
    fi
    exit 0
    ;;
  fail_vitest)
    if [[ "$*" == *"vitest"* ]]; then
      echo "FAIL  test/foo.test.ts > should add"
      echo "AssertionError: expected 2 to equal 4"
      echo ""
      echo "Test Files  1 failed (1)"
      echo "      Tests  1 failed (1)"
      exit 1
    fi
    exit 0
    ;;
  ansi_fail_tsc)
    if [[ "$*" == *"tsc"* ]]; then
      # ANSI-colored output (red error). The hook's strip_ctrl helper must
      # remove ESC + other control chars BEFORE jq sees the payload, else
      # JSON is malformed ("control chars from U+0000–U+001F must be escaped").
      printf '\x1b[31merror TS2322:\x1b[0m type mismatch\n'
      printf '\x1b[1m\x1b[33mwarning\x1b[0m: implicit any\n'
      exit 1
    fi
    exit 0
    ;;
  pass|*)
    exit 0
    ;;
esac
NPX_EOF
chmod +x "$FAKE_BIN/npx"

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
  rm -rf "$FAKE_BIN"
  rm -f "$DIRTY"
}
trap cleanup EXIT

run_hook() {
  local mode="$1"
  echo '{"session_id":"'"$SESSION"'"}' \
    | NPX_MOCK_MODE="$mode" PATH="$FAKE_BIN:$PATH" bash "$HOOK" 2>/dev/null \
    || true
}

# ──────────────────────────────────────────────────────────────────────────
# (d) not-dirty → silent exit 0 (no test invocation needed).
rm -f "$DIRTY"
out=$(run_hook pass)
if [ -z "$out" ]; then
  report "not-dirty → silent exit 0 (skip when no edits this turn)" 1
else
  report "not-dirty produced output (got: $out)" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# (a) dirty + tsc + vitest both pass → silent exit 0.
touch "$DIRTY"
out=$(run_hook pass)
if [ -z "$out" ]; then
  report "dirty + all green → silent exit 0" 1
else
  report "dirty + green produced output (got: $out)" 0
fi
rm -f "$DIRTY"

# Helpers — extract via jq so checks are robust to compact vs pretty
# JSON formatting (architect-gate.sh uses compact printf; test-gate.sh
# currently uses pretty-printed `jq -n`).
decision_of() { echo "$1" | jq -r '.decision // ""' 2>/dev/null; }
reason_of()   { echo "$1" | jq -r '.reason   // ""' 2>/dev/null; }

# ──────────────────────────────────────────────────────────────────────────
# (b) dirty + tsc fails → valid JSON block mentioning tsc.
touch "$DIRTY"
out=$(run_hook fail_tsc)
if echo "$out" | jq -e . >/dev/null 2>&1 \
   && [ "$(decision_of "$out")" = "block" ] \
   && reason_of "$out" | grep -q 'tsc'; then
  report "dirty + tsc fail → valid JSON block mentioning tsc" 1
else
  report "tsc-fail expected valid JSON block mentioning tsc (got: $out)" 0
fi
rm -f "$DIRTY"

# ──────────────────────────────────────────────────────────────────────────
# (c) dirty + vitest fails → valid JSON block mentioning vitest.
touch "$DIRTY"
out=$(run_hook fail_vitest)
if echo "$out" | jq -e . >/dev/null 2>&1 \
   && [ "$(decision_of "$out")" = "block" ] \
   && reason_of "$out" | grep -q 'vitest'; then
  report "dirty + vitest fail → valid JSON block mentioning vitest" 1
else
  report "vitest-fail expected valid JSON block mentioning vitest (got: $out)" 0
fi
rm -f "$DIRTY"

# ──────────────────────────────────────────────────────────────────────────
# (e) dirty + tsc fails with ANSI-colored output → JSON still valid AND raw
#     ESC bytes stripped from reason payload (no U+001B leak into output).
touch "$DIRTY"
out=$(run_hook ansi_fail_tsc)
esc_present=0
echo "$out" | grep -q $'\x1b' && esc_present=1
if echo "$out" | jq -e . >/dev/null 2>&1 \
   && [ "$(decision_of "$out")" = "block" ] \
   && [ "$esc_present" -eq 0 ]; then
  report "dirty + ANSI-colored tsc fail → JSON valid, ESC bytes stripped" 1
else
  report "ANSI test failed (esc_present=$esc_present, got: $out)" 0
fi
rm -f "$DIRTY"

# ──────────────────────────────────────────────────────────────────────────
echo ""
echo "Results: $pass_count passed, $fail_count failed"
if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
