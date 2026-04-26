#!/usr/bin/env bash
# SessionStart hook — syncs in-repo `.claude/memory/` into Claude Code's
# user-home memory path so protocol auto-memory works on any machine
# after a fresh clone.
#
# Runs idempotently on every session start. Cheap (<50ms if no-op).
#
# Failure modes (all soft — never block session start):
#   - jq missing                 → warn to stderr, skip
#   - repo .claude/memory/ empty → warn, skip
#   - user-home path unwritable  → warn, skip (user can fix manually)
#
# Manual invocation: `bash .claude/hooks/bootstrap.sh` — prints a short
# summary of what it did.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_MEMORY="$REPO_ROOT/.claude/memory"

# Derive the Claude Code user-home memory path from cwd.
# Claude Code convention: ~/.claude/projects/<cwd-slug>/memory/
# where <cwd-slug> = absolute path with / → - and leading - preserved.
CWD_SLUG="$(echo "$REPO_ROOT" | tr '/' '-')"
USER_MEMORY="$HOME/.claude/projects/${CWD_SLUG}/memory"

log() { echo "[bootstrap] $*" >&2; }

# Preflight: source exists?
if [ ! -d "$REPO_MEMORY" ]; then
  log "skip: $REPO_MEMORY not found — nothing to sync"
  exit 0
fi

# Count in-repo memory files.
REPO_COUNT=$(find "$REPO_MEMORY" -maxdepth 1 -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$REPO_COUNT" = "0" ]; then
  log "skip: $REPO_MEMORY is empty"
  exit 0
fi

# Slug-mismatch sanity check: if Claude Code uses a different slug convention
# than our tr-based derivation, we'd silently create an orphan directory
# that Claude Code never reads from. Detect this heuristically: if
# `~/.claude/projects/` has sibling directories that look like they could be
# this project (fuzzy name match) but our computed slug doesn't exist among
# them, warn. Never blocks — soft diagnostic only.
PROJECTS_ROOT="$HOME/.claude/projects"
if [ -d "$PROJECTS_ROOT" ] && [ ! -d "$USER_MEMORY" ]; then
  BASE_NAME=$(basename "$REPO_ROOT")
  FUZZY_MATCHES=$(find "$PROJECTS_ROOT" -maxdepth 1 -type d -name "*${BASE_NAME}*" 2>/dev/null | grep -v "^${USER_MEMORY%/memory}$" || true)
  if [ -n "$FUZZY_MATCHES" ]; then
    log "warn: computed slug '$CWD_SLUG' not found in $PROJECTS_ROOT, but similarly-named directories exist:"
    echo "$FUZZY_MATCHES" | while read -r d; do log "  possible match: $d"; done
    log "Claude Code may be using a different slug convention. Inspect $PROJECTS_ROOT manually and adjust bootstrap.sh if needed."
  fi
fi

# Ensure destination exists.
mkdir -p "$USER_MEMORY" 2>/dev/null || {
  log "warn: cannot create $USER_MEMORY — check permissions; skipping sync"
  exit 0
}

# Sync: copy only if repo version is newer or user-home missing the file.
# Keeps user's local edits intact if they're newer (e.g. developer added a
# memory file mid-session that hasn't been mirrored back to repo yet).
SYNCED=0
SKIPPED=0
for src in "$REPO_MEMORY"/*.md; do
  [ -f "$src" ] || continue
  base=$(basename "$src")
  dst="$USER_MEMORY/$base"

  if [ ! -f "$dst" ]; then
    cp "$src" "$dst" && SYNCED=$((SYNCED + 1))
  else
    # Compare mtimes; repo newer → overwrite. Otherwise keep user-home.
    if [ "$src" -nt "$dst" ]; then
      cp "$src" "$dst" && SYNCED=$((SYNCED + 1))
    else
      SKIPPED=$((SKIPPED + 1))
    fi
  fi
done

# Claude Code expects a JSON response on SessionStart hook. Empty object =
# no additional context to inject. We log to stderr only so the
# conversation stays clean.
echo "{}"

if [ "$SYNCED" -gt 0 ]; then
  log "synced $SYNCED memory file(s) from repo to $USER_MEMORY (skipped $SKIPPED up-to-date)"
fi
exit 0
