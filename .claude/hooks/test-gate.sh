#!/usr/bin/env bash
set -euo pipefail

# Stop hook — mechanical test gate.
#
# Runs `npx tsc --noEmit` + `npx vitest run` and blocks Stop on failure.
# Mirrors architect-gate.sh dirty-marker pattern: skip on no-substantive
# turns (no Edit/Write activity). Independent of architect — architect
# may also run tests via Bash, but that's interpretation; this is the
# deterministic gate.
#
# Order in Stop hooks chain: test-gate runs FIRST. If tests fail, no
# point invoking architect — feedback would be "fix tests first" anyway.
# Fail-fast saves ~1 min of architect compute per broken-tests turn.
#
# Exits 0 on pass (transparent — no spam in transcript).
# Emits `{"decision":"block","reason":"..."}` on fail.

INPUT=$(cat)

# Preflight: jq required for transcript parsing + JSON output construction.
if ! command -v jq >/dev/null 2>&1; then
  cat <<'JSON'
{"decision":"block","reason":"test-gate: jq not found in PATH. Install (e.g. `brew install jq`) before continuing — without jq, the test gate cannot construct safe JSON output."}
JSON
  exit 0
fi

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")
DIRTY="${TMPDIR:-/tmp}/.claude-dirty-${SESSION_ID}"

# Not dirty → no code changes → no need to test. Same gate as architect-gate.sh.
if [ ! -f "$DIRTY" ]; then
  exit 0
fi

# Project root: hook script lives at .claude/hooks/test-gate.sh → up 2 = repo root.
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
cd "$REPO_ROOT"

# Run tsc first (faster fail). Capture combined output.
# `|| { ... ; exit 0 }` converts subprocess non-zero into JSON block while
# keeping the hook's own exit 0 so Claude Code reads the JSON correctly.
# Helper: strip ANSI escape sequences + non-newline control chars from
# stdin. `npx` ANSI-colorizes output (terminal-aware); when we capture
# via `2>&1` and pass to `jq --arg`, the U+001B (ESC) and other control
# chars produce invalid JSON ("control characters from U+0000 through
# U+001F must be escaped"). Strip them BEFORE jq sees the payload.
# Keep `\n` (U+000A) and `\t` (U+0009) — jq escapes those correctly.
strip_ctrl() {
  # Remove ANSI CSI sequences (ESC[…m), then drop any remaining 0x00–0x1F
  # except 0x09 (tab) and 0x0A (newline).
  sed $'s/\x1b\\[[0-9;]*[a-zA-Z]//g' | tr -d '\000-\010\013-\014\016-\037'
}

TSC_OUT=$(npx tsc --noEmit 2>&1) || {
  TSC_TAIL=$(echo "$TSC_OUT" | tail -10 | strip_ctrl)
  REASON_PAYLOAD="test-gate: tsc --noEmit failed. Fix TypeScript errors before turn close. Last 10 lines:
$TSC_TAIL"
  jq -n --arg reason "$REASON_PAYLOAD" '{decision: "block", reason: $reason}'
  exit 0
}

# tsc clean — run vitest.
# vitest 4.x renamed reporters — `default` is the safe baseline; `basic`
# from vitest 1.x/2.x is gone and triggers a reporter-load crash that
# produced false-block in the first synthetic test. Pin `default` so the
# hook is robust to a version that ships in this repo.
VITEST_OUT=$(npx vitest run --reporter=default 2>&1) || {
  VITEST_TAIL=$(echo "$VITEST_OUT" | tail -20 | strip_ctrl)
  REASON_PAYLOAD="test-gate: vitest run failed. Fix failing tests before turn close. Last 20 lines:
$VITEST_TAIL"
  jq -n --arg reason "$REASON_PAYLOAD" '{decision: "block", reason: $reason}'
  exit 0
}

# Both pass — silent exit (no JSON output = no transcript spam).
exit 0
