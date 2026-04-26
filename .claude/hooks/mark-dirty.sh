#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
touch "${TMPDIR:-/tmp}/.claude-dirty-${SESSION_ID}"

exit 0
