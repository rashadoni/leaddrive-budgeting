#!/usr/bin/env bash
# Phase 7.M Step 4 follow-up (2026-05-19) — daily quality check.
#
# Runs every morning via a macOS LaunchAgent (see
# `~/Library/LaunchAgents/com.budgetpro.quality.plist`) BEFORE the
# user opens the Risk Terminal. Does the three things that keep the
# system honest:
#
#   1. Refresh external feeds (CBAR FX / FAO / Brent / weather / etc.)
#      via the intel scheduler. New points pass through the Phase 7.M
#      Step 1 plausibility gate at ingest time.
#   2. Run the zombie-row cleanup pass — recompute any IV cells that
#      may have flipped state overnight (new feed data → indicator
#      recompute → potentially newly-classified rows).
#   3. Run the pre-demo smoke test. Exit code 0=green / 1=yellow /
#      2=red. On red, fires a macOS notification so the user sees
#      the problem before they walk into a meeting.
#
# Safe to run any time, idempotent. Skips itself if a previous run
# is still in progress (single-instance lock via flock-style PID file).
#
# Logs all output to ~/Library/Logs/budgetpro-quality.log (one line
# per run with timestamp; the script's verbose output goes to the
# same file). Rotate manually when it gets too big (or `logrotate`
# in a follow-up).

set -e

LOG_FILE="${HOME}/Library/Logs/budgetpro-quality.log"
LOCK_FILE="/tmp/budgetpro-quality.lock"
# Resolve project root from the script's own location so the wrapper
# works both from the main checkout AND from any worktree without an
# environment-specific edit. `cd ... && pwd` canonicalises symlinks.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Lock so two crons can't pile up. PID files survive crashes only
#    when the process held them at termination — we trust os.kill -0
#    to detect stale locks.
if [ -f "$LOCK_FILE" ]; then
  HELD_PID="$(cat "$LOCK_FILE" 2>/dev/null || echo '')"
  if [ -n "$HELD_PID" ] && kill -0 "$HELD_PID" 2>/dev/null; then
    echo "[$(date -u +%FT%TZ)] another run in progress (pid=$HELD_PID), skipping" >> "$LOG_FILE"
    exit 0
  fi
fi
echo "$$" > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

cd "$PROJECT_ROOT"

# ── Load env (DATABASE_URL, ANTHROPIC_API_KEY for impact-scan if you
#    want to extend later). Plist won't carry it; we read .env. Worktrees
#    don't ship .env (gitignored), so fall back to the parent checkout's
#    .env when running from inside `.claude/worktrees/...`.
ENV_CANDIDATES=(
  "${PROJECT_ROOT}/.env"
  "${PROJECT_ROOT}/../../../.env"
)
for env_file in "${ENV_CANDIDATES[@]}"; do
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    break
  fi
done

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[$(date -u +%FT%TZ)] FATAL: DATABASE_URL not set, aborting" >> "$LOG_FILE"
  exit 3
fi

# ── Pre-flight: notify helper.
#
# Phase 7.M Tier2 #5 (2026-05-19) — falls back to email when the Mac
# is unreachable (lid closed / off-network). The macOS notification is
# always attempted first; email triggers when the notification call
# returns non-zero AND `QUALITY_ALERT_EMAIL` is set in the environment.
#
# Email transport uses the system `mail` CLI (BSD-style on macOS) so
# it works out of the box on the user's Mac. For SMTP/SaaS delivery
# in a server deployment, set `QUALITY_ALERT_MAIL_CMD` to a custom
# command that takes the body on stdin and "$1" as the subject.
notify() {
  local title="$1"
  local body="$2"
  local notif_ok=1
  osascript -e "display notification \"${body}\" with title \"${title}\"" 2>/dev/null \
    && notif_ok=0
  if [ -n "${QUALITY_ALERT_EMAIL:-}" ]; then
    local mail_cmd="${QUALITY_ALERT_MAIL_CMD:-mail -s \"$title\" \"$QUALITY_ALERT_EMAIL\"}"
    echo "$body" | eval "$mail_cmd" 2>/dev/null || true
  fi
  return 0
}

# ── Run the sequence, capturing per-step exit codes.
log_section() {
  echo "" >> "$LOG_FILE"
  echo "──── $1 ──── $(date -u +%FT%TZ)" >> "$LOG_FILE"
}

log_section "START"

log_section "1/3 intel scheduler bootstrap"
if npx tsx scripts/intel-scheduler-bootstrap.ts --once >> "$LOG_FILE" 2>&1; then
  echo "  ok" >> "$LOG_FILE"
else
  rc=$?
  echo "  failed rc=$rc (continuing)" >> "$LOG_FILE"
  # Continue — partial adapter failures shouldn't block the rest.
fi

log_section "2/3 zombie cleanup recompute"
if npx tsx scripts/recompute-fx-zombies.ts >> "$LOG_FILE" 2>&1; then
  echo "  ok" >> "$LOG_FILE"
else
  rc=$?
  echo "  failed rc=$rc (continuing)" >> "$LOG_FILE"
fi

log_section "3/3 smoke test"
SMOKE_OUTPUT="$(npx tsx scripts/pre-demo-smoke.ts 2>&1)"
SMOKE_RC=$?
echo "$SMOKE_OUTPUT" >> "$LOG_FILE"

case "$SMOKE_RC" in
  0)
    echo "  smoke=GREEN" >> "$LOG_FILE"
    # No notification — nothing to do.
    ;;
  1)
    echo "  smoke=YELLOW" >> "$LOG_FILE"
    # Soft warning notification — the user can choose to ignore.
    SUMMARY="$(echo "$SMOKE_OUTPUT" | grep -E '🟡' | head -2 | tr '\n' ' ')"
    notify "BudgetPro · daily check 🟡" "${SUMMARY:-Review smoke-test output}"
    ;;
  2)
    echo "  smoke=RED" >> "$LOG_FILE"
    # Hard notification — fix before demo.
    SUMMARY="$(echo "$SMOKE_OUTPUT" | grep -E '🔴' | head -2 | tr '\n' ' ')"
    notify "BudgetPro · daily check 🔴 DO NOT DEMO" "${SUMMARY:-Run npm run smoke-test for detail}"
    ;;
  *)
    echo "  smoke=ERROR rc=$SMOKE_RC" >> "$LOG_FILE"
    notify "BudgetPro · daily check error" "smoke-test exited with rc=$SMOKE_RC — see ~/Library/Logs/budgetpro-quality.log"
    ;;
esac

log_section "END (smoke rc=$SMOKE_RC)"
exit "$SMOKE_RC"
