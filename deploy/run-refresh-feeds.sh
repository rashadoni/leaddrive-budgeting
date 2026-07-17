#!/usr/bin/env bash
#
# Invoke the FREE-feed refresh endpoint from the production VM without putting
# CRON_SECRET in the process command line. Intended for the systemd unit in
# deploy/systemd/budgetpro-refresh-feeds.service.

set -euo pipefail

APP_DIR="${BUDGETPRO_APP_DIR:-/opt/budgetpro}"
ENV_FILE="${BUDGETPRO_ENV_FILE:-$APP_DIR/.env.production}"
BASE_URL="${BUDGETPRO_CRON_BASE_URL:-http://127.0.0.1}"
CURL_BIN="${CURL_BIN:-/usr/bin/curl}"
CANARY_DIR="${BUDGETPRO_CANARY_DIR:-/run/budgetpro-refresh-feeds}"
MODE="run"

case "${1:-}" in
  "") ;;
  --check) MODE="check" ;;
  --canary) MODE="canary" ;;
  *)
    echo "Usage: $0 [--check|--canary]" >&2
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [--check|--canary]" >&2
  exit 2
fi

if [ ! -r "$ENV_FILE" ]; then
  echo "refresh-feeds: environment file is not readable: $ENV_FILE" >&2
  exit 1
fi

SECRET_LINE=$(grep -m 1 '^CRON_SECRET=' "$ENV_FILE" || true)
CRON_SECRET=${SECRET_LINE#CRON_SECRET=}
case "$CRON_SECRET" in
  \"*\") CRON_SECRET=${CRON_SECRET#\"}; CRON_SECRET=${CRON_SECRET%\"} ;;
  \'*\') CRON_SECRET=${CRON_SECRET#\'}; CRON_SECRET=${CRON_SECRET%\'} ;;
esac

if [ -z "$CRON_SECRET" ]; then
  echo "refresh-feeds: CRON_SECRET is missing — refusing to call the endpoint" >&2
  exit 1
fi

case "$CRON_SECRET" in
  *$'\r'*|*$'\n'*)
    echo "refresh-feeds: CRON_SECRET contains a line break — refusing unsafe header input" >&2
    exit 1
    ;;
esac

if [ "${#CRON_SECRET}" -lt 32 ]; then
  echo "refresh-feeds: CRON_SECRET must contain at least 32 characters" >&2
  exit 1
fi
case "$CRON_SECRET" in
  *[!A-Za-z0-9._~+=:/-]*)
    echo "refresh-feeds: CRON_SECRET contains unsupported dotenv characters" >&2
    exit 1
    ;;
esac

if [ ! -x "$CURL_BIN" ]; then
  echo "refresh-feeds: curl is not executable: $CURL_BIN" >&2
  exit 1
fi

if [ "$MODE" = "check" ]; then
  echo "refresh-feeds: prerequisites OK"
  exit 0
fi

umask 077
AUTH_FILE=$(mktemp "${TMPDIR:-/tmp}/budgetpro-refresh-feeds-auth.XXXXXX")
cleanup() {
  rm -f "$AUTH_FILE"
}
trap cleanup EXIT HUP INT TERM

# curl accepts @file for --header. The root-only temporary file keeps the
# bearer out of argv/process listings and is removed on every exit path.
printf 'Authorization: Bearer %s\n' "$CRON_SECRET" > "$AUTH_FILE"

"$CURL_BIN" \
  --fail-with-body \
  --silent \
  --show-error \
  --connect-timeout 10 \
  --max-time 540 \
  --header "@$AUTH_FILE" \
  "${BASE_URL%/}/api/cron/refresh-feeds"
printf '\n'

if [ "$MODE" = "canary" ]; then
  install -d -m 0700 "$CANARY_DIR"
  : > "$CANARY_DIR/canary-ok"
  chmod 0600 "$CANARY_DIR/canary-ok"
  echo "refresh-feeds: canary succeeded; enable window is open for 60 minutes"
fi
