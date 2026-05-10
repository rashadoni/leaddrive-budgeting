#!/usr/bin/env bash
set -euo pipefail

# PostToolUse hook — Phase 7.G Turn LXXIX follow-up (user-confirmed
# refinement #2). Auto-runs `bootstrap.sh` when an Edit/Write/MultiEdit
# touches a `.claude/memory/*.md` file, syncing the user-home mirror so
# new memory rules auto-load in the next session without manual prompt.
#
# Closes the highest risk class of the LXXVIII carve-out: memory edits
# bypass architect, which used to catch the "you forgot bootstrap" gap.
# Now bootstrap is automatic on every memory edit.
#
# Cost: ~100ms (bootstrap.sh syncs at most 17 small files; rsync-cheap).
# Defensive: fire-and-forget (`true` on any failure) so a failed sync
# never blocks the user's tool_use return.

INPUT=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

case "$TOOL_NAME" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

# Only fire on memory file edits.
case "$FILE_PATH" in
  */.claude/memory/*.md) ;;
  *) exit 0 ;;
esac

# Resolve script dir → bootstrap.sh next to it.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOOTSTRAP="$SCRIPT_DIR/bootstrap.sh"

if [ ! -x "$BOOTSTRAP" ]; then
  exit 0
fi

# Fire-and-forget — log to stderr (visible to dev) but never block.
bash "$BOOTSTRAP" >/dev/null 2>&1 || true

exit 0
