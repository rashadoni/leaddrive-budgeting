#!/usr/bin/env bash
set -euo pipefail

# Stop hook — enforces 3 conditions before letting developer close a substantive turn:
#   (1) architect subagent was invoked AFTER the last REAL user message
#       (hook-injected synthetic "Stop hook feedback" / "<system-reminder>"
#        events are skipped so they can't create an infinite loop)
#   (2) that architect prompt contains a verbatim user-message marker
#       (developer must paste "RAW USER MESSAGE" section)
#   (3) architect reply does NOT contain "Следующее действие: FAIL"
#
# Parsing: pure jq over the full transcript. Earlier awk implementation
# silently failed on POSIX awk flavours over multi-line continuations,
# producing ghost passes in tests while production loop-blocked.

INPUT=$(cat)

# Preflight: jq must be available. Without it, the entire enforcement stack
# silently degrades. Fail loudly so the developer can fix the environment
# rather than trusting a false PASS.
if ! command -v jq >/dev/null 2>&1; then
  cat <<'JSON'
{"decision":"block","reason":"architect-gate diagnostic: jq not found in PATH. This hook requires jq to parse the transcript. Install (e.g. `brew install jq`) before continuing — without jq, the 100%-closure protocol cannot be enforced and the turn will not be blocked, defeating the whole mechanism."}
JSON
  exit 0
fi

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
DIRTY="${TMPDIR:-/tmp}/.claude-dirty-${SESSION_ID}"

# If not dirty (no substantive changes this turn), let it close.
if [ ! -f "$DIRTY" ]; then
  exit 0
fi

# Missing transcript — diagnostic, distinct from protocol violation.
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  cat <<'JSON'
{"decision":"block","reason":"architect-gate diagnostic: Stop event missing transcript_path (cannot verify architect invocation). Likely a hook misconfiguration or unsupported Claude Code version. Invoke architect with a 'RAW USER MESSAGE' section and quote the full review in your final response — the gate cannot cryptographically verify this in the current state, so user-visible evidence is the fallback."}
JSON
  exit 0
fi

# One jq pass computes everything we need from the transcript:
#   .last_user_idx  — index (0-based) of most recent REAL user event,
#                      excluding tool_result wrappers and hook-injected
#                      synthetic messages (content starts with
#                      "Stop hook feedback:" or "<system-reminder>").
#   .architect_count — number of architect subagent invocations after that.
#   .has_raw_marker  — at least one of those architect calls has
#                      "RAW USER MESSAGE" in the prompt.
#   .has_fail        — the most recent architect tool_result contains
#                      "Следующее действие: FAIL" (strict regex — must
#                      match architect.md template).
AUDIT=$(jq -sr '
  # Helper: is this transcript entry a REAL user message (not tool_result
  # wrapper, not hook-synthetic)?
  def is_real_user:
    .type == "user"
    and (
      (.message.content // []) | if type == "array"
        then (any(.type == "tool_result") | not)
        else true end
    )
    and (
      (.message.content // "") | if type == "string"
        then (
          (startswith("Stop hook feedback:") | not)
          and (startswith("<system-reminder>") | not)
        )
        else true end
    );

  # Find index of most recent real-user entry.
  (to_entries | map(select(.value | is_real_user)) | .[-1].key // -1) as $last_user_idx

  # Slice the transcript AFTER the last real-user event.
  | (if $last_user_idx >= 0 then .[$last_user_idx+1:] else . end) as $after

  # Architect invocations after that point.
  | ($after
      | map(
          (.message.content // [])
          | if type == "array"
            then map(
              select(
                .type == "tool_use" and .name == "Agent"
                and .input.subagent_type == "architect"
              )
            )
            else [] end
        )
      | flatten
    ) as $architect_calls

  # Filter architect calls whose prompt contains the RAW marker.
  | ($architect_calls
      | map(select(.input.prompt // "" | test("RAW USER MESSAGE"; "i")))
    ) as $raw_calls

  # Most recent architect tool_result (the LAST one after last-real-user).
  # Intermediate FAILs that the developer has since closed by re-invoking
  # architect and getting PASS do not count — only the latest review result
  # gates the Stop. Otherwise the hook would block forever once a single
  # FAIL landed in history.
  | ($after
      | map(
          (.message.content // [])
          | if type == "array"
            then map(select(.type == "tool_result"))
            else [] end
        )
      | flatten
      | .[-1] // null
    ) as $last_tool_result

  | (if $last_tool_result == null then
       false
     else
       ($last_tool_result.content
        | if type == "array" then
            map(if .type == "text" then .text else "" end) | join("\n")
          elif type == "string" then .
          else "" end
       )
       | test("Следующее действие:\\s*FAIL"; "i")
     end) as $has_fail

  | {
      last_user_idx: $last_user_idx,
      architect_count: ($architect_calls | length),
      has_raw_marker: (($raw_calls | length) > 0),
      has_fail: $has_fail
    }
' "$TRANSCRIPT" 2>${TMPDIR:-/tmp}/architect-gate-jq-err.$$ || true)

# Distinguish "jq parse failed (corrupt transcript)" from "jq ran but found
# nothing meaningful". If jq produced NO output at all, the transcript is
# unparseable — surface that as a distinct diagnostic (not a protocol
# violation) so developer can inspect rather than chase a false lead.
if [ -z "$AUDIT" ]; then
  ERR=$(cat ${TMPDIR:-/tmp}/architect-gate-jq-err.$$ 2>/dev/null | head -c 300)
  rm -f ${TMPDIR:-/tmp}/architect-gate-jq-err.$$
  printf '{"decision":"block","reason":"architect-gate diagnostic: jq failed to parse transcript (%s). This is likely a corrupt/truncated transcript or a format change in Claude Code, NOT a protocol violation. Inspect transcript_path manually before proceeding."}\n' \
    "$(printf '%s' "$ERR" | sed 's/"/\\"/g' | tr -d '\n' | head -c 200)"
  exit 0
fi
rm -f ${TMPDIR:-/tmp}/architect-gate-jq-err.$$

LAST_USER_IDX=$(echo "$AUDIT" | jq -r '.last_user_idx')
ARCHITECT_COUNT=$(echo "$AUDIT" | jq -r '.architect_count')
HAS_RAW=$(echo "$AUDIT" | jq -r '.has_raw_marker')
HAS_FAIL=$(echo "$AUDIT" | jq -r '.has_fail')

# No real user message ever? Unusual state — be conservative.
if [ "$LAST_USER_IDX" = "-1" ]; then
  cat <<'JSON'
{"decision":"block","reason":"architect-gate: transcript has no real user message (only synthetic hook-injections). Refusing to close without verification."}
JSON
  exit 0
fi

# No architect invocation after the last real user message.
if [ "$ARCHITECT_COUNT" = "0" ]; then
  cat <<'JSON'
{"decision":"block","reason":"architect-gate: no architect subagent invocation found after the last user message. Invoke Agent(subagent_type='architect') with a prompt that includes the user's RAW message verbatim under a 'RAW USER MESSAGE' marker, and deliver all three blocks (Scope / Quality / Completion Audit) in your final response."}
JSON
  exit 0
fi

# Architect was invoked but none of the calls carries the RAW marker.
if [ "$HAS_RAW" != "true" ]; then
  cat <<'JSON'
{"decision":"block","reason":"architect-gate: architect was invoked but prompt lacks the 'RAW USER MESSAGE' marker. Per memory/feedback_100_percent_closure.md, the architect must receive the user's verbatim request — not a summary. Re-invoke architect with a 'RAW USER MESSAGE:' section quoting the user's words verbatim."}
JSON
  exit 0
fi

# IMPORTANT: the "Следующее действие:\s*FAIL" regex below is intentionally
# strict — matches the exact format mandated in `.claude/agents/architect.md`
# (last line of the ARCHITECT REVIEW block). If architect.md template
# changes, update the jq regex in lockstep. Loose matching (e.g. "FAIL:" /
# "FAIL.") would false-positive on developer-written FAIL mentions elsewhere.
if [ "$HAS_FAIL" = "true" ]; then
  cat <<'JSON'
{"decision":"block","reason":"architect-gate: the most recent architect review returned FAIL (Completion Audit or Проблемы). Close the blocking items and re-invoke architect for a PASS before ending the turn. Silent ignore of architect FAIL is itself a scope violation (memory/feedback_100_percent_closure.md)."}
JSON
  exit 0
fi

# Check #5: CARRYOVER.md freshness.
# If the project has a carryover tracker with OPEN items, it MUST have been
# edited this turn. Prevents the developer from jumping to new work while
# pre-existing 🔄 items silently rot between turns. See
# `memory/feedback_carryover_enforcement.md`.
#
# Detection: scan the transcript for Edit / Write / MultiEdit tool_use
# entries (after the last real user message) whose `file_path` ends with
# `docs/CARRYOVER.md`. mtime comparison was the original implementation
# but it has a fundamental race: `mark-dirty.sh` runs PostToolUse on every
# Edit, bumping DIRTY mtime AFTER the file edit completes. If the
# developer edits CARRYOVER and then ANY other file, DIRTY mtime ends up
# > CARRYOVER mtime, falsely indicating the tracker wasn't touched. The
# transcript-based check is precise: if a tool_use call modified
# CARRYOVER, that's a fact, not a timestamp race.
#
# Path resolution: transcript_path lives in ~/.claude/projects/<slug>/, but
# CARRYOVER.md lives in the project repo. Use Claude Code's `cwd` field
# (provided in Stop event input) if present; otherwise skip this check
# with a note so the developer can fix manually.
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
if [ -n "$CWD" ] && [ -f "$CWD/docs/CARRYOVER.md" ]; then
  CARRYOVER="$CWD/docs/CARRYOVER.md"
  OPEN_COUNT=$(grep -c "^| 🔄 |" "$CARRYOVER" 2>/dev/null || echo 0)
  if [ "$OPEN_COUNT" -gt 0 ]; then
    # Count Edit/Write/MultiEdit tool_use calls after LAST_USER_IDX whose
    # file_path matches CARRYOVER.md. Match by suffix (handles abs / rel
    # paths) — comparing to literal `$CARRYOVER` would miss relative paths
    # like `docs/CARRYOVER.md`.
    # Require a leading `/` before `docs/` to avoid false matches on paths
    # like `archive-docs/CARRYOVER.md` or `foo-docs/CARRYOVER.md`. All real
    # tool_use file_paths in Claude Code are absolute, so this never
    # excludes a legitimate edit. Negative-test #13 guards against
    # regression.
    # Phase 7.G Turn O cont'd — also count Bash tool_use entries that
    # write CARRYOVER (Python `bump_carryover_*` helpers; shell `>`
    # redirects to docs/CARRYOVER.md). Pre-Turn-L convention required
    # an Edit-tool follow-up after Python bumpers; this extension lets
    # the bulk-bump operation itself satisfy check #5 directly.
    #
    # Defensive regex (anchored to write-shape patterns to avoid false
    # positives on read-only commands like `grep ... docs/CARRYOVER.md`):
    #   `bump_carryover_`          — Python helper script-name convention
    #   `> .*docs/CARRYOVER.md`    — shell redirect (write or append)
    # Pure read-only Bash on the file (grep/cat/head) does NOT match —
    # those should still be paired with an Edit-tool call to satisfy
    # the gate.
    CARRYOVER_EDITS=$(jq -sr --argjson startIdx "$LAST_USER_IDX" '
      .[$startIdx+1:]
      | map(
          (.message.content // [])
          | if type == "array"
            then map(
              select(
                .type == "tool_use"
                and (
                  ((.name == "Edit" or .name == "Write" or .name == "MultiEdit")
                    and ((.input.file_path // "") | endswith("/docs/CARRYOVER.md")))
                  or
                  (.name == "Bash"
                    and ((.input.command // "") | test("bump_carryover_|carryover:bump|>\\s*[^|]*docs/CARRYOVER\\.md")))
                )
              )
            )
            else [] end
        )
      | flatten
      | length
    ' "$TRANSCRIPT" 2>/dev/null || echo 0)

    if [ "$CARRYOVER_EDITS" = "0" ] || [ -z "$CARRYOVER_EDITS" ]; then
      cat <<JSON
{"decision":"block","reason":"architect-gate: docs/CARRYOVER.md has ${OPEN_COUNT} open (🔄) items but was NOT updated this turn. Per memory/feedback_carryover_enforcement.md, every substantive turn must process the tracker — close what you can, heartbeat (bump turns-open counter) for user-owned items, or re-escalate with a specific new blocker. File unchanged = partial items silently rotting between turns."}
JSON
      exit 0
    fi
  fi
fi

# All checks passed. Clear dirty marker and let turn close.
rm -f "$DIRTY"
exit 0
