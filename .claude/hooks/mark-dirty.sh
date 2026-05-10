#!/usr/bin/env bash
set -euo pipefail

# PostToolUse hook — marks the session "dirty" so architect-gate enforces
# the architect-review protocol on Stop. The marker is per-session
# (cleared by architect-gate after a clean review).
#
# Phase 7.G Turn LXXVII follow-up — CARVE-OUT for pure docs/memory edits.
# Per user-confirmed Option C: docs-only / memory-only / typo-fix turns
# DON'T need architect protocol — they can't introduce runtime bugs by
# construction (no source file changes). Saves ~5-7 min wall-clock per
# such turn (architect sync + prompt prep + verdict read).
#
# Carve-out logic:
#  - Edit / Write / MultiEdit on a carve-out path → DON'T touch dirty
#  - Edit / Write / MultiEdit on any OTHER path → touch dirty (safe default)
#  - Bash, Agent, anything else → touch dirty (could do anything)
#
# Carve-out paths (suffix match on file_path):
#  - docs/*.md             — ROADMAP, CARRYOVER, project docs
#  - .claude/memory/*.md   — protocol memory files
#  - CLAUDE.md             — project root context file
#
# DELIBERATELY NOT carved out:
#  - .claude/hooks/*.sh    — editing hooks affects future enforcement
#  - .claude/agents/*.md   — architect.md changes alter review behavior
#  - messages/*.json       — i18n changes affect UI runtime
#  - prisma/schema.prisma  — schema changes affect runtime
#  - src/**                — source code obviously
#
# Mixed-edit turn: if ANY single tool_use touches a non-carve-out path,
# dirty is marked → architect required. Carve-out only applies when EVERY
# edit this turn stays within docs/memory.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
DIRTY="${TMPDIR:-/tmp}/.claude-dirty-${SESSION_ID}"

# Defensive: if jq missing, fall back to old behavior (always mark dirty).
if ! command -v jq >/dev/null 2>&1; then
  touch "$DIRTY"
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Non-Edit-class tool → mark dirty (safe default).
case "$TOOL_NAME" in
  Edit|Write|MultiEdit) ;;
  *)
    touch "$DIRTY"
    exit 0
    ;;
esac

# No file_path → mark dirty.
if [ -z "$FILE_PATH" ]; then
  touch "$DIRTY"
  exit 0
fi

# Carve-out check — suffix match on file_path.
case "$FILE_PATH" in
  */docs/*.md|*/.claude/memory/*.md|*/CLAUDE.md)
    # Carve-out path → DON'T mark dirty.
    exit 0
    ;;
  *)
    # Any other path → mark dirty.
    touch "$DIRTY"
    exit 0
    ;;
esac
