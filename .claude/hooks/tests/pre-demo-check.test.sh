#!/usr/bin/env bash
# Regression guard for `scripts/pre-demo-check.sh` arg parser + APPLY_PENDING
# branch (Turn XIX architect Round-1 ⚠️ #2 closure).
#
# Covers the control-flow scenarios introduced by recent turns:
#   (a) `--bogus-flag` → "Unknown flag: ..." + Usage line + exit-2  [Turn XIX]
#   (b) `--apply-pending` → APPLY_PENDING=true branch executes        [Turn XIX]
#       `npx prisma migrate deploy` (mocked) BEFORE the warn-check
#   (c) no flag → APPLY_PENDING=false → APPLY branch skipped          [Turn XIX]
#   (d) OPERON_SANDBOXED_NETWORK=1 → Dev-server http checks emit       [Turn XX]
#       "skipped (sandboxed)" lines instead of curl probes
#
# Sibling pattern of `architect-gate.test.sh` + `test-gate.test.sh`. Mocks
# the script's external deps (npx + curl + others) via $TMPDIR fakebin so
# the test never touches a real DB / dev-server / HTTP.
#
# Run: bash .claude/hooks/tests/pre-demo-check.test.sh
# Expected: 3 cases pass, exit 0.

set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/../../.." && pwd)/scripts/pre-demo-check.sh"
[ -f "$SCRIPT" ] || { echo "FAIL: SCRIPT not found at $SCRIPT" >&2; exit 1; }
FAKE_BIN="${TMPDIR:-/tmp}/pre-demo-check-fakebin-$$"
WORK_DIR="${TMPDIR:-/tmp}/pre-demo-check-work-$$"
export NPX_LOG="$WORK_DIR/npx-calls.log"

if ! command -v jq >/dev/null; then
  echo "FAIL: jq required (used by sibling tests; convention)" >&2
  exit 1
fi

mkdir -p "$FAKE_BIN" "$WORK_DIR"

# Fake `npx` — switches behavior via $NPX_MOCK_MODE + logs invocations
# to $NPX_LOG (both passed via env so the heredoc body uses no
# interpolation — single-quoted heredoc avoids shell-meta gotchas in
# pre-demo-check's actual `npx` arg patterns like `--reporter=dot`).
cat > "$FAKE_BIN/npx" <<'NPX_EOF'
#!/bin/bash
# Log invocation. NPX_LOG is set by the parent test harness.
echo "npx $*" >> "${NPX_LOG:-/dev/null}"
case "${NPX_MOCK_MODE:-pass}" in
  pass)
    case "$*" in
      *"prisma migrate status"*)
        echo "Database schema is up to date"
        ;;
      *"vitest"*)
        echo "..."
        ;;
      *)
        :
        ;;
    esac
    exit 0
    ;;
  *)
    exit 1
    ;;
esac
NPX_EOF
chmod +x "$FAKE_BIN/npx"

# Fake `curl` — pre-demo-check probes localhost endpoints; mock returns
# 307 (auth-redirect) which the real script treats as healthy.
cat > "$FAKE_BIN/curl" <<'CURL_EOF'
#!/usr/bin/env bash
# Pre-demo-check uses curl with various flags; emit 307 status code
# regardless of args — the script greps for it.
echo "307"
exit 0
CURL_EOF
chmod +x "$FAKE_BIN/curl"

# Fake `unzip` — used to count rows in DEMO-CO.xlsx; emit empty so the
# warn-check fires a soft mismatch but doesn't HARD FAIL.
cat > "$FAKE_BIN/unzip" <<'UNZIP_EOF'
#!/usr/bin/env bash
exit 0
UNZIP_EOF
chmod +x "$FAKE_BIN/unzip"

# Provide essentials in fakebin via symlink. Without these the script's
# basic shell builtins (cat/grep/awk/sed) wouldn't be reachable on the
# scrubbed PATH.
for util in cat grep awk sed wc tr cut head tail dirname basename mkdir test true false; do
  src=$(command -v "$util" 2>/dev/null) || continue
  ln -sf "$src" "$FAKE_BIN/$util"
done

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
  rm -rf "$FAKE_BIN" "$WORK_DIR"
}
trap cleanup EXIT

# Helpers
run_script() {
  local mode="$1"
  shift
  : > "$NPX_LOG"
  NPX_MOCK_MODE="$mode" NPX_LOG="$NPX_LOG" PATH="$FAKE_BIN" /bin/bash "$SCRIPT" "$@" 2>&1 \
    || echo "EXIT_CODE=$?"
}

# ──────────────────────────────────────────────────────────────────────────
# (a) --bogus-flag → arg parser rejects with stderr + exit-2.
out=$(NPX_MOCK_MODE=pass NPX_LOG="$NPX_LOG" PATH="$FAKE_BIN" /bin/bash "$SCRIPT" --bogus-flag 2>&1; echo "EXIT_CODE=$?")
exit_code=$(echo "$out" | grep -oE 'EXIT_CODE=[0-9]+$' | cut -d= -f2)
if echo "$out" | grep -q 'Unknown flag: --bogus-flag' \
   && echo "$out" | grep -q 'Usage:' \
   && [ "$exit_code" = "2" ]; then
  report "--bogus-flag → 'Unknown flag' + Usage + exit-2" 1
else
  report "bogus-flag rejection failed (exit_code=$exit_code, got: $out)" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# (b) --apply-pending → APPLY_PENDING=true branch fires `migrate deploy`
# BEFORE the warn-check. Assert by inspecting the npx call log.
out=$(run_script pass --apply-pending)
if grep -q 'prisma migrate deploy' "$NPX_LOG"; then
  # Also assert "Auto-apply pending migrations" line is in output.
  if echo "$out" | grep -q 'Auto-apply pending migrations'; then
    report "--apply-pending → APPLY branch invoked migrate deploy + report line present" 1
  else
    report "--apply-pending fired deploy but missing report line (got: $out)" 0
  fi
else
  report "--apply-pending did NOT fire 'prisma migrate deploy' (calls: $(cat "$NPX_LOG"))" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# (c) no flag → APPLY_PENDING=false → APPLY branch SKIPPED (back-compat).
# The migrate-status warn-check still fires because the script always
# runs that check.
out=$(run_script pass)
if ! grep -q 'prisma migrate deploy' "$NPX_LOG"; then
  # Also assert "Auto-apply pending migrations" line is NOT in output
  # (that's the apply-branch report line; should be absent without flag).
  if ! echo "$out" | grep -q 'Auto-apply pending migrations'; then
    report "no flag → APPLY branch skipped (back-compat)" 1
  else
    report "no-flag emitted 'Auto-apply' line — back-compat broken (got: $out)" 0
  fi
else
  report "no-flag fired 'prisma migrate deploy' — back-compat broken (calls: $(cat "$NPX_LOG"))" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# (d) OPERON_SANDBOXED_NETWORK=1 → dev-server http section emits "skipped
# (sandboxed)" lines, no curl invocation. Assert by absence of curl call
# log + presence of skipped-line in output.
: > "$NPX_LOG"
: > "$WORK_DIR/curl-calls.log"
# Wrap fake curl with logging so we can assert no calls were made.
cat > "$FAKE_BIN/curl" <<'CURL_LOG_EOF'
#!/bin/bash
echo "curl $*" >> "${CURL_LOG:-/dev/null}"
echo "307"
exit 0
CURL_LOG_EOF
chmod +x "$FAKE_BIN/curl"
out=$(NPX_MOCK_MODE=pass NPX_LOG="$NPX_LOG" CURL_LOG="$WORK_DIR/curl-calls.log" \
      OPERON_SANDBOXED_NETWORK=1 PATH="$FAKE_BIN" /bin/bash "$SCRIPT" 2>&1 \
      || echo "EXIT_CODE=$?")
if echo "$out" | grep -q 'skipped (sandboxed)' \
   && [ ! -s "$WORK_DIR/curl-calls.log" ]; then
  report "OPERON_SANDBOXED_NETWORK=1 → http checks skip with 'sandboxed' WARN, no curl invocations" 1
else
  curl_calls=$(cat "$WORK_DIR/curl-calls.log" 2>/dev/null | wc -l | tr -d ' ')
  report "sandbox-skip case failed (curl_calls=$curl_calls; got: $(echo "$out" | head -3 | tr '\n' '|'))" 0
fi

# ──────────────────────────────────────────────────────────────────────────
echo ""
echo "Results: $pass_count passed, $fail_count failed"
if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
