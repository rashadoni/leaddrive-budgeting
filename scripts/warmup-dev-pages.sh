#!/usr/bin/env bash
# Pre-compile commonly-visited routes so the first browser visit doesn't
# pay the 5-10s on-demand compile cost. Idempotent — safe to re-run.
#
# Usage:
#   bash scripts/warmup-dev-pages.sh
#
# Or wire into LaunchAgent: source after next-dev is "Ready in Nms" line.
#
# Each route is hit via curl with 5-min timeout (cold compile can be 6-8s
# on a clean .next/cache). Auth-gated routes return 307 to /login — that's
# expected and still triggers the compile. We don't follow redirects
# because /login is itself a route that needs to compile.

set -u  # no -e: continue on individual route failures

BASE_URL="${BASE_URL:-http://localhost:3000}"
TIMEOUT_SECS=300

# Wait for dev server to be Ready (looks for the bootstrap signal in log).
LOG_FILE="${HOME}/Library/Logs/budgetpro.log"
echo "Waiting for dev server Ready signal..."
for _ in $(seq 1 60); do
  if grep -q "✓ Ready in" "${LOG_FILE}" 2>/dev/null \
     && curl -s -o /dev/null --max-time 2 "${BASE_URL}/login"; then
    echo "  Dev server alive."
    break
  fi
  sleep 1
done

# Routes to warm — ordered by user-visit frequency.
ROUTES=(
  "/login"                                  # public
  "/budgeting"                              # main P&L workspace
  "/budgeting/terminal"                     # risk terminal
  "/budgeting/onboarding"                   # this turn's target
  "/budgeting/onboarding?view=import"       # import wizard view
  "/budgeting/board-deck"
  "/budgeting/reports"
  "/budgeting/audit"
  "/budgeting/admin/companies"
  "/budgeting/admin/onboarding"
  "/budgeting/admin/periods"
  "/budgeting/admin/approval-requests"
  "/budgeting/admin/intel-health"
  "/budgeting/admin/drift"
  "/budgeting/admin/data-entry"
  "/budgeting/admin/chart-of-accounts"
  "/budgeting/alerts/history"
  "/settings"
  "/dashboard"
)

echo
echo "Warming ${#ROUTES[@]} routes against ${BASE_URL}..."
for path in "${ROUTES[@]}"; do
  start=$(date +%s)
  http=$(curl -s -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT_SECS}" "${BASE_URL}${path}")
  end=$(date +%s)
  elapsed=$((end - start))
  case "${http}" in
    200|307|301|302) status="OK" ;;
    *) status="WARN" ;;
  esac
  printf "  [%s %3s] %-50s %ds\n" "${status}" "${http}" "${path}" "${elapsed}"
done

echo
echo "Warmup complete."
