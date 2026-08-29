#!/usr/bin/env bash
#
# READ-ONLY tail of the production app container's logs (2026-07-30).
#
#   bash deploy/check-app-logs.sh [lines] [grep-pattern]
#
# Exists for exactly one class of question: the UI shows a verdict ("RED",
# "Bloklanıb") without the reason, and the reason lives in the route's
# warnings, which are logged server-side. Same named-script shape as
# check-migrations.sh: reviewable, reads logs, writes nothing.
set -euo pipefail

PROD_HOST="${PROD_HOST:-root@75.119.156.234}"
APP_DIR="/opt/budgetpro"
LINES="${1:-300}"
PATTERN="${2:-.}"

ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
  && docker compose --env-file .env.production logs --tail $LINES --no-color app'" \
  | grep -E "$PATTERN" || echo "(no lines matched '$PATTERN' in last $LINES)"
