#!/usr/bin/env bash
# Regression guard for `.claude/hooks/architect-gate.sh`.
# Runs 13 scenarios against the hook using fake Stop event JSONs and a
# fake transcript file. Any path regression fails the test.
#
# Run: bash .claude/hooks/tests/architect-gate.test.sh
# Expected: all 13 tests pass, exit 0.

set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/architect-gate.sh"
FAKE="${TMPDIR:-/tmp}/architect-gate-test-$$"
SESSION="test-$$"
DIRTY="${TMPDIR:-/tmp}/.claude-dirty-${SESSION}"

# jq is required by the hook. If missing, the test can't run.
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
  rm -f "$FAKE" "$DIRTY"
}
trap cleanup EXIT

# Helper: run hook with given input JSON, capture stdout.
run_hook() {
  local input="$1"
  echo "$input" | bash "$HOOK" 2>/dev/null || true
}

# ──────────────────────────────────────────────────────────────────────────
# 0: not dirty → pass through (exit 0, no output).
rm -f "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false}')
if [ -z "$out" ]; then
  report "not-dirty passes through" 1
else
  report "not-dirty passes through (got: $out)" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# 1: dirty + no transcript_path → block with "diagnostic" message.
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false}')
if echo "$out" | grep -q '"decision":"block"' && echo "$out" | grep -q 'diagnostic'; then
  report "dirty + no transcript_path → diagnostic block" 1
else
  report "dirty + no transcript_path → diagnostic block (got: $out)" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# 2: dirty + transcript with no architect invocation → block "no architect".
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"test user message"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Okay"}]},"timestamp":"2026-01-01T00:00:01Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'"}')
if echo "$out" | grep -q '"decision":"block"' && echo "$out" | grep -q 'no architect subagent invocation'; then
  report "dirty + no architect invocation → block" 1
else
  report "dirty + no architect → block (got: $out)" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# 3: dirty + architect invoked WITHOUT RAW USER MESSAGE marker → block.
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"test user message"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"t","prompt":"Please review my changes without the raw marker."}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":"PASS"}]},"timestamp":"2026-01-01T00:00:02Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'"}')
if echo "$out" | grep -q '"decision":"block"' && echo "$out" | grep -q "RAW USER MESSAGE"; then
  report "dirty + architect without RAW marker → block" 1
else
  report "dirty + no RAW marker → block (got: $out)" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# 4: dirty + architect WITH RAW marker + PASS reply → allow (empty output, dirty cleared).
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"test user message"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"t","prompt":"RAW USER MESSAGE: close tasks to 100%. Review."}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW — PASS. Proceed."}]}]},"timestamp":"2026-01-01T00:00:02Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'"}')
if [ -z "$out" ] && [ ! -f "$DIRTY" ]; then
  report "dirty + RAW marker + PASS → allow + dirty cleared" 1
else
  report "dirty + RAW + PASS → allow (got: '$out', dirty still: $([ -f "$DIRTY" ] && echo YES || echo no))" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# 5: dirty + architect RAW + FAIL reply → block.
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"test user message"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"t","prompt":"RAW USER MESSAGE: close tasks. Review."}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW\n🎯 Следующее действие: FAIL — close items first."}]}]},"timestamp":"2026-01-01T00:00:02Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'"}')
if echo "$out" | grep -q '"decision":"block"' && echo "$out" | grep -q "architect review returned FAIL"; then
  report "dirty + RAW + FAIL reply → block" 1
else
  report "dirty + FAIL → block (got: $out)" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# 6: dirty + architect PASS + LATER synthetic "Stop hook feedback" user event
#    → should STILL allow (hook-feedback must not reset the "last user" cursor
#    and trigger infinite loops).
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"real user directive"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"t","prompt":"RAW USER MESSAGE: real user directive. Review."}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW — PASS. Proceed."}]}]},"timestamp":"2026-01-01T00:00:02Z"}
{"type":"user","message":{"role":"user","content":"Stop hook feedback: architect-gate: no architect ..."},"timestamp":"2026-01-01T00:00:03Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":true,"transcript_path":"'"$FAKE"'"}')
if [ -z "$out" ] && [ ! -f "$DIRTY" ]; then
  report "dirty + PASS + later hook-feedback-synthetic → still allow" 1
else
  report "hook-feedback loop-breaker (got: '$out', dirty: $([ -f "$DIRTY" ] && echo YES || echo no))" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# 7b: FAIL → developer fixed → PASS → should allow. Only the LATEST
#     architect result counts. Intermediate FAIL in history must not block.
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"real user directive"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"round-1","prompt":"RAW USER MESSAGE: real directive. Review."}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW\n🎯 Следующее действие: FAIL — close X."}]}]},"timestamp":"2026-01-01T00:00:02Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"round-2","prompt":"RAW USER MESSAGE: real directive. Re-review after fix."}}]},"timestamp":"2026-01-01T00:00:03Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW — PASS. Proceed."}]}]},"timestamp":"2026-01-01T00:00:04Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'"}')
if [ -z "$out" ] && [ ! -f "$DIRTY" ]; then
  report "FAIL then fixed → PASS → allow (only latest result counts)" 1
else
  report "historic FAIL should not block when latest is PASS (got: '$out')" 0
fi

# ──────────────────────────────────────────────────────────────────────────
# 7: legit user message that QUOTES "Stop hook feedback" mid-sentence must NOT
#    be filtered. This is the round-2 architect hardening — narrowing from
#    substring match to content-start-boundary match.
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"Why does the Stop hook feedback trigger twice?"},"timestamp":"2026-01-01T00:00:00Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'"}')
# No architect was invoked after this real user message → hook SHOULD block
# (the user message IS counted as "last user", not filtered).
if echo "$out" | grep -q '"decision":"block"' && echo "$out" | grep -q "no architect subagent invocation"; then
  report "legit user text quoting 'Stop hook feedback' mid-sentence → treated as real user msg" 1
else
  report "legit quote not filtered (got: $out)" 0
fi
rm -f "$DIRTY"

# ──────────────────────────────────────────────────────────────────────────
# 10: CARRYOVER.md freshness — dirty + all architect gates pass + CARRYOVER
#     has OPEN items but transcript has NO Edit on it → block (check #5).
#
# Note: detection is via transcript-scan for Edit/Write/MultiEdit tool_use
# on docs/CARRYOVER.md (NOT mtime comparison — mtime races with mark-dirty
# fire order, see hook source comments for details).
TMPPROJ="${TMPDIR:-/tmp}/carryover-test-$$"
mkdir -p "$TMPPROJ/docs"
cat > "$TMPPROJ/docs/CARRYOVER.md" <<'CARRYOVER_EOF'
# CARRYOVER
| status | opened | turns-open | owner | blocker | item |
|---|---|---|---|---|---|
| 🔄 | 2026-04-24 | 0 | developer | none | Some pending work |
CARRYOVER_EOF
# Transcript has architect call but no CARRYOVER edits — should block.
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"real user directive"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"t","prompt":"RAW USER MESSAGE: real directive. Review."}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW — PASS. Proceed."}]}]},"timestamp":"2026-01-01T00:00:02Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'","cwd":"'"$TMPPROJ"'"}')
if echo "$out" | grep -q '"decision":"block"' && echo "$out" | grep -q "CARRYOVER"; then
  report "CARRYOVER OPEN + no Edit in transcript → block" 1
else
  report "CARRYOVER freshness check (got: $out)" 0
fi
rm -f "$DIRTY"

# ──────────────────────────────────────────────────────────────────────────
# 11: CARRYOVER.md freshness — dirty + OPEN items + transcript HAS Edit on
#     CARRYOVER.md after last user message → allow.
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"real user directive"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/some/abs/path/docs/CARRYOVER.md","old_string":"a","new_string":"b"}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":"ok"}]},"timestamp":"2026-01-01T00:00:02Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"t","prompt":"RAW USER MESSAGE: real directive. Review."}}]},"timestamp":"2026-01-01T00:00:03Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW — PASS. Proceed."}]}]},"timestamp":"2026-01-01T00:00:04Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'","cwd":"'"$TMPPROJ"'"}')
if [ -z "$out" ] && [ ! -f "$DIRTY" ]; then
  report "CARRYOVER edited via Edit tool → allow" 1
else
  report "CARRYOVER edit detection (got: '$out', dirty: $([ -f "$DIRTY" ] && echo YES || echo no))" 0
fi
rm -rf "$TMPPROJ"

# ──────────────────────────────────────────────────────────────────────────
# 11b: NEGATIVE — Edit on a CARRYOVER.md OUTSIDE `docs/` (e.g. `archive/
#      CARRYOVER.md`, `foo-docs/CARRYOVER.md`) must NOT count as processing
#      the tracker. Catches the suffix-collision class of bug.
TMPPROJ="${TMPDIR:-/tmp}/carryover-suffix-test-$$"
mkdir -p "$TMPPROJ/docs"
cat > "$TMPPROJ/docs/CARRYOVER.md" <<'CARRYOVER_EOF'
# CARRYOVER
| status | opened | turns-open | owner | blocker | item |
|---|---|---|---|---|---|
| 🔄 | 2026-04-24 | 0 | developer | none | Some pending work |
CARRYOVER_EOF
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"real user directive"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/some/abs/foo-docs/CARRYOVER.md","old_string":"a","new_string":"b"}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":"ok"}]},"timestamp":"2026-01-01T00:00:02Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"t","prompt":"RAW USER MESSAGE: real directive. Review."}}]},"timestamp":"2026-01-01T00:00:03Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW — PASS. Proceed."}]}]},"timestamp":"2026-01-01T00:00:04Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'","cwd":"'"$TMPPROJ"'"}')
if echo "$out" | grep -q '"decision":"block"' && echo "$out" | grep -q "CARRYOVER"; then
  report "Edit on suffix-colliding path (foo-docs/CARRYOVER.md) → block" 1
else
  report "suffix-collision negative test (got: '$out')" 0
fi
rm -rf "$TMPPROJ"
rm -f "$DIRTY"

# ──────────────────────────────────────────────────────────────────────────
# 11c: Phase 7.G Turn O cont'd — Bash tool_use invoking `bump_carryover_*`
#      Python helper SHOULD count as touching CARRYOVER (closes the chronic
#      Stop-hook false-positive class observed across Turn-H'/J'/K'/K').
TMPPROJ="${TMPDIR:-/tmp}/carryover-bash-test-$$"
mkdir -p "$TMPPROJ/docs"
cat > "$TMPPROJ/docs/CARRYOVER.md" <<'CARRYOVER_EOF'
# CARRYOVER
| status | opened | turns-open | owner | blocker | item |
|---|---|---|---|---|---|
| 🔄 | 2026-04-24 | 0 | developer | none | Some pending work |
CARRYOVER_EOF
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"real user directive"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"python3 /tmp/claude/bump_carryover_turnX.py"}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":"OK"}]},"timestamp":"2026-01-01T00:00:02Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"t","prompt":"RAW USER MESSAGE: real directive. Review."}}]},"timestamp":"2026-01-01T00:00:03Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW — PASS. Proceed."}]}]},"timestamp":"2026-01-01T00:00:04Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'","cwd":"'"$TMPPROJ"'"}')
if [ -z "$out" ] && [ ! -f "$DIRTY" ]; then
  report "Bash invokes bump_carryover_*.py → allow (Turn-O extension)" 1
else
  report "Bash bump_carryover_ detection (got: '$out', dirty: $([ -f "$DIRTY" ] && echo YES || echo no))" 0
fi
rm -rf "$TMPPROJ"
rm -f "$DIRTY"

# ──────────────────────────────────────────────────────────────────────────
# 11d: NEGATIVE — Bash with READ-ONLY command on CARRYOVER (grep / cat /
#      head) must NOT count as a touch (no write-shape token). Catches
#      the false-positive class for the Turn-O regex extension.
TMPPROJ="${TMPDIR:-/tmp}/carryover-bash-readonly-test-$$"
mkdir -p "$TMPPROJ/docs"
cat > "$TMPPROJ/docs/CARRYOVER.md" <<'CARRYOVER_EOF'
# CARRYOVER
| status | opened | turns-open | owner | blocker | item |
|---|---|---|---|---|---|
| 🔄 | 2026-04-24 | 0 | developer | none | Some pending work |
CARRYOVER_EOF
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"real user directive"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"grep -c \"^| 🔄 |\" docs/CARRYOVER.md"}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":"42"}]},"timestamp":"2026-01-01T00:00:02Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"t","prompt":"RAW USER MESSAGE: real directive. Review."}}]},"timestamp":"2026-01-01T00:00:03Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW — PASS. Proceed."}]}]},"timestamp":"2026-01-01T00:00:04Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'","cwd":"'"$TMPPROJ"'"}')
if echo "$out" | grep -q '"decision":"block"' && echo "$out" | grep -q "CARRYOVER"; then
  report "Bash read-only grep on CARRYOVER → block (no write-shape token)" 1
else
  report "Bash read-only grep should NOT count as touch (got: '$out')" 0
fi
rm -rf "$TMPPROJ"
rm -f "$DIRTY"

# ──────────────────────────────────────────────────────────────────────────
# 12: no CARRYOVER.md at all (project doesn't use the tracker) → allow.
#     Hook's check #5 must be skipped silently when file doesn't exist;
#     regression guard against someone deleting CARRYOVER.md and finding
#     the hook hard-blocks forever.
TMPPROJ="${TMPDIR:-/tmp}/no-carryover-test-$$"
mkdir -p "$TMPPROJ/docs"
# Note: NO CARRYOVER.md created.
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"real user directive"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"architect","description":"t","prompt":"RAW USER MESSAGE: real directive. Review."}}]},"timestamp":"2026-01-01T00:00:01Z"}
{"type":"user","message":{"role":"tool","content":[{"type":"tool_result","content":[{"type":"text","text":"ARCHITECT REVIEW — PASS. Proceed."}]}]},"timestamp":"2026-01-01T00:00:02Z"}
JSONL
touch "$DIRTY"
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'","cwd":"'"$TMPPROJ"'"}')
if [ -z "$out" ] && [ ! -f "$DIRTY" ]; then
  report "no CARRYOVER.md → allow (check #5 skipped silently)" 1
else
  report "no CARRYOVER.md should not block (got: '$out', dirty: $([ -f "$DIRTY" ] && echo YES || echo no))" 0
fi
rm -rf "$TMPPROJ"

# ──────────────────────────────────────────────────────────────────────────
# 13 (Turn LXXVIII follow-up): not-dirty + CARRYOVER 0 OPEN → allow.
# Carve-out turn (no source edits) with no pending tracker items must
# exit cleanly. Regression guard against the `grep -c || echo 0` bug
# that produced literal "0\n0" and crashed the integer comparison.
TMPPROJ="${TMPDIR:-/tmp}/carve-out-empty-test-$$"
mkdir -p "$TMPPROJ/docs"
cat > "$TMPPROJ/docs/CARRYOVER.md" <<'EOF'
## OPEN
(no rows)
EOF
rm -f "$DIRTY"  # NOT dirty (carve-out turn)
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"cwd":"'"$TMPPROJ"'"}')
if [ -z "$out" ]; then
  report "carve-out (not dirty) + CARRYOVER 0 OPEN → allow" 1
else
  report "carve-out + 0 OPEN should not block (got: '$out')" 0
fi
rm -rf "$TMPPROJ"

# ──────────────────────────────────────────────────────────────────────────
# 14 (Turn LXXVIII follow-up): not-dirty + CARRYOVER N OPEN + no edit → block.
# Carve-out turn must STILL be gated by CARRYOVER freshness check #5.
TMPPROJ="${TMPDIR:-/tmp}/carve-out-rot-test-$$"
mkdir -p "$TMPPROJ/docs"
cat > "$TMPPROJ/docs/CARRYOVER.md" <<'EOF'
## OPEN
| 🔄 | 2026-05-10 | 0 | developer | test | sample row |
EOF
# Transcript with NO Edit on CARRYOVER.md.
cat > "$FAKE" <<'JSONL'
{"type":"user","message":{"role":"user","content":"docs-only edit"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done"}]},"timestamp":"2026-01-01T00:00:01Z"}
JSONL
rm -f "$DIRTY"  # NOT dirty (carve-out turn)
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'","cwd":"'"$TMPPROJ"'"}')
if echo "$out" | grep -q '"decision":"block"' && echo "$out" | grep -q "CARRYOVER"; then
  report "carve-out + N OPEN + no edit → block (rot guard)" 1
else
  report "carve-out + N OPEN + no edit should block (got: '$out')" 0
fi
rm -rf "$TMPPROJ"

# ──────────────────────────────────────────────────────────────────────────
# 15 (Turn LXXVIII follow-up): not-dirty + CARRYOVER N OPEN + Edit → allow.
# Carve-out turn that DID heartbeat-touch CARRYOVER must allow close.
TMPPROJ="${TMPDIR:-/tmp}/carve-out-heartbeat-test-$$"
mkdir -p "$TMPPROJ/docs"
cat > "$TMPPROJ/docs/CARRYOVER.md" <<'EOF'
## OPEN
| 🔄 | 2026-05-10 | 0 | developer | test | sample row |
EOF
# Transcript WITH Edit on CARRYOVER.md.
cat > "$FAKE" <<JSONL
{"type":"user","message":{"role":"user","content":"docs-only edit + heartbeat"},"timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"$TMPPROJ/docs/CARRYOVER.md","old_string":"sample","new_string":"updated"}}]},"timestamp":"2026-01-01T00:00:01Z"}
JSONL
rm -f "$DIRTY"  # NOT dirty (carve-out turn — Edit on CARRYOVER doesn't mark dirty per Turn LXXVIII)
out=$(run_hook '{"session_id":"'"$SESSION"'","stop_hook_active":false,"transcript_path":"'"$FAKE"'","cwd":"'"$TMPPROJ"'"}')
if [ -z "$out" ]; then
  report "carve-out + N OPEN + Edit on CARRYOVER → allow" 1
else
  report "carve-out + N OPEN + Edit should allow (got: '$out')" 0
fi
rm -rf "$TMPPROJ"

# ──────────────────────────────────────────────────────────────────────────
echo ""
echo "Results: $pass_count passed, $fail_count failed"
if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
