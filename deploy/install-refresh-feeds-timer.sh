#!/usr/bin/env bash
# Install the BudgetPro free-feed systemd units on the production VM.
# Installation does not change the timer's enable state by default. `--enable`
# is the explicit owner/SRE action after provider keys are configured.

set -euo pipefail

APP_DIR="/opt/budgetpro"
UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
ENABLE=0

case "${1:-}" in
  "") ;;
  --enable) ENABLE=1 ;;
  *)
    echo "Usage: $0 [--enable]" >&2
    exit 2
    ;;
esac

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "install-refresh-feeds-timer: run as root" >&2
  exit 1
fi

SERVICE_SOURCE="$APP_DIR/deploy/systemd/budgetpro-refresh-feeds.service"
TIMER_SOURCE="$APP_DIR/deploy/systemd/budgetpro-refresh-feeds.timer"
RUNNER="$APP_DIR/deploy/run-refresh-feeds.sh"

for file in "$SERVICE_SOURCE" "$TIMER_SOURCE" "$RUNNER"; do
  if [ ! -f "$file" ]; then
    echo "install-refresh-feeds-timer: required file missing: $file" >&2
    exit 1
  fi
done

systemd-analyze verify "$SERVICE_SOURCE" "$TIMER_SOURCE"

BACKUP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/budgetpro-refresh-feeds-units.XXXXXX")
SERVICE_TARGET="$UNIT_DIR/budgetpro-refresh-feeds.service"
TIMER_TARGET="$UNIT_DIR/budgetpro-refresh-feeds.timer"
WAS_ENABLED=$(systemctl is-enabled budgetpro-refresh-feeds.timer 2>/dev/null || true)
WAS_ACTIVE=$(systemctl is-active budgetpro-refresh-feeds.timer 2>/dev/null || true)

if [ -f "$SERVICE_TARGET" ]; then
  cp -p "$SERVICE_TARGET" "$BACKUP_DIR/service"
fi
if [ -f "$TIMER_TARGET" ]; then
  cp -p "$TIMER_TARGET" "$BACKUP_DIR/timer"
fi

rollback() {
  status=$?
  trap - ERR
  if [ -f "$BACKUP_DIR/service" ]; then
    install -m 0644 "$BACKUP_DIR/service" "$SERVICE_TARGET"
  else
    rm -f "$SERVICE_TARGET"
  fi
  if [ -f "$BACKUP_DIR/timer" ]; then
    install -m 0644 "$BACKUP_DIR/timer" "$TIMER_TARGET"
  else
    rm -f "$TIMER_TARGET"
  fi
  systemctl daemon-reload || true
  if [ "$WAS_ENABLED" = "enabled" ]; then
    systemctl enable budgetpro-refresh-feeds.timer >/dev/null 2>&1 || true
  else
    systemctl disable budgetpro-refresh-feeds.timer >/dev/null 2>&1 || true
  fi
  if [ "$WAS_ACTIVE" = "active" ]; then
    systemctl start budgetpro-refresh-feeds.timer || true
  else
    systemctl stop budgetpro-refresh-feeds.timer || true
  fi
  rm -rf "$BACKUP_DIR"
  echo "install-refresh-feeds-timer: installation failed; previous state restored" >&2
  exit "$status"
}
trap rollback ERR

install -m 0644 "$SERVICE_SOURCE" "$UNIT_DIR/budgetpro-refresh-feeds.service"
install -m 0644 "$TIMER_SOURCE" "$UNIT_DIR/budgetpro-refresh-feeds.timer"
chmod 0755 "$RUNNER"

systemctl daemon-reload
systemd-analyze verify "$SERVICE_TARGET" "$TIMER_TARGET"

if [ "$ENABLE" -eq 1 ]; then
  "$RUNNER" --check
  CANARY_MARKER="/run/budgetpro-refresh-feeds/canary-ok"
  RECENT_CANARY=$(find "$CANARY_MARKER" -mmin -60 -type f -print -quit 2>/dev/null || true)
  if [ -z "$RECENT_CANARY" ]; then
    echo "install-refresh-feeds-timer: no successful canary in the last 60 minutes" >&2
    echo "Run: $RUNNER --canary" >&2
    false
  fi
  systemctl enable --now budgetpro-refresh-feeds.timer
  echo "budgetpro-refresh-feeds.timer installed and enabled"
else
  echo "budgetpro-refresh-feeds.timer installed; enable state unchanged"
  echo "After provider keys are configured: $0 --enable"
fi

trap - ERR
rm -rf "$BACKUP_DIR"
