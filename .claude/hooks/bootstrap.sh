#!/usr/bin/env bash
# SessionStart hook — syncs in-repo `.claude/memory/` into Claude Code's
# user-home memory path so protocol auto-memory works on any machine
# after a fresh clone.
#
# Runs idempotently on every session start. Cheap (<50ms if no-op).
#
# Worktree-aware (Phase 7.G Turn LXXX follow-up — closes architect ⚠️ #1):
# When invoked from a git worktree (e.g. `.claude/worktrees/<slug>/`), syncs
# to BOTH the worktree-slug mirror AND the canonical-repo-slug mirror so
# memory rules surface in Claude Code regardless of which checkout the
# next session opens. When invoked from the main repo, syncs only to its
# own slug (the canonical one).
#
# Slug convention matches Claude Code's actual derivation: replace BOTH
# `/` AND `.` with `-` (so `/.claude/` becomes `--claude-`, not
# `-.claude-` which would be an orphan directory Claude Code never reads).
#
# Failure modes (all soft — never block session start):
#   - jq missing                 → warn to stderr, skip
#   - repo .claude/memory/ empty → warn, skip
#   - user-home path unwritable  → warn, skip (user can fix manually)
#   - git not available          → fall back to single-mirror sync
#
# Manual invocation: `bash .claude/hooks/bootstrap.sh` — prints a short
# summary of what it did.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_MEMORY="$REPO_ROOT/.claude/memory"

log() { echo "[bootstrap] $*" >&2; }

# Claude Code slug convention: absolute path with `/` AND `.` → `-`.
# Use `tr` with both characters in one pass so `/.claude/` → `--claude-`
# (matches what Claude Code produces; verified via `ls ~/.claude/projects/`).
to_slug() {
  echo "$1" | tr '/.' '--'
}

# Detect canonical repo root via git. When invoked from a worktree,
# `git rev-parse --git-common-dir` returns the path to the main repo's
# `.git` directory (the "shared" git dir); its parent is the canonical
# repo root. When invoked from the main repo, this resolves to the same
# directory as REPO_ROOT — so the dedup loop below cleanly degenerates
# to a single sync target.
CANONICAL_ROOT=""
if command -v git >/dev/null 2>&1; then
  if COMMON_DIR=$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null); then
    # Resolve relative paths against REPO_ROOT.
    case "$COMMON_DIR" in
      /*) ABS_COMMON="$COMMON_DIR" ;;
      *)  ABS_COMMON="$REPO_ROOT/$COMMON_DIR" ;;
    esac
    if [ -d "$ABS_COMMON" ]; then
      CANONICAL_ROOT="$(cd "$(dirname "$ABS_COMMON")" && pwd)"
    fi
  fi
fi

# Fallback: if git detection failed, treat REPO_ROOT as canonical.
if [ -z "$CANONICAL_ROOT" ]; then
  CANONICAL_ROOT="$REPO_ROOT"
fi

# Build sync target list — dedupe so main-repo runs hit one mirror, worktree
# runs hit two (worktree-slug + canonical-slug).
TARGETS=()
TARGETS+=("$HOME/.claude/projects/$(to_slug "$REPO_ROOT")/memory")
CANONICAL_MEMORY="$HOME/.claude/projects/$(to_slug "$CANONICAL_ROOT")/memory"
if [ "$CANONICAL_MEMORY" != "${TARGETS[0]}" ]; then
  TARGETS+=("$CANONICAL_MEMORY")
fi

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

TOTAL_SYNCED=0
TOTAL_SKIPPED=0

for USER_MEMORY in "${TARGETS[@]}"; do
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
      log "warn: computed mirror '$USER_MEMORY' missing in $PROJECTS_ROOT, but similarly-named directories exist:"
      echo "$FUZZY_MATCHES" | while read -r d; do log "  possible match: $d"; done
    fi
  fi

  # Ensure destination exists.
  if ! mkdir -p "$USER_MEMORY" 2>/dev/null; then
    log "warn: cannot create $USER_MEMORY — skipping this mirror"
    continue
  fi

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
      if [ "$src" -nt "$dst" ]; then
        cp "$src" "$dst" && SYNCED=$((SYNCED + 1))
      else
        SKIPPED=$((SKIPPED + 1))
      fi
    fi
  done

  TOTAL_SYNCED=$((TOTAL_SYNCED + SYNCED))
  TOTAL_SKIPPED=$((TOTAL_SKIPPED + SKIPPED))

  if [ "$SYNCED" -gt 0 ]; then
    log "synced $SYNCED memory file(s) → $USER_MEMORY (skipped $SKIPPED up-to-date)"
  fi
done

# Claude Code expects a JSON response on SessionStart hook. Empty object =
# no additional context to inject. We log to stderr only so the
# conversation stays clean.
echo "{}"

exit 0
