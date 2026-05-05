#!/usr/bin/env bash
# Pre-demo sanity check — single command Day-5 morning before customer demo.
#
# Exit code 0 = system green light, demo can proceed.
# Exit code != 0 = P0 fix needed; do NOT start demo until resolved.
#
# Verifies:
#  1. TypeScript compiles clean
#  2. All vitest tests pass
#  3. ~/Downloads/DEMO-CO.xlsx exists + correct row count (27)
#  4. Dev server is running on port 3000
#  5. Critical API endpoints return 307 (auth redirect = healthy)
#  6. Auth-gate not regressed (unauth requests don't leak data)
#  7. /budgeting?tab=pnl-report load < 600ms (Turn-38-sub12 baseline)
#  8. DB integrity: AZMADE org has expected company / line / IV counts
#  9. Prisma migrate status clean (pending migrations → ⚠ by default; with
#     `--apply-pending` runs `prisma migrate deploy` first then re-checks)
#
# Usage:
#   bash scripts/pre-demo-check.sh                     # report-only
#   bash scripts/pre-demo-check.sh --apply-pending     # auto-apply drift
#   OR: npm run demo:check
#
# Re-run after any P0 fix until exit 0.

set -e

# Phase 7.G Turn XIX (closes 67-turn 🔄, Turn-42-sub-18 architect 💡):
# `--apply-pending` flag auto-deploys pending migrations before the warn-check
# fires. Sub-18 lost ~5 min surfacing then manually applying a pending
# migration; this flag closes that loop. Default behavior (no flag) is
# back-compat report-only — the gate doesn't unilaterally mutate the DB
# unless caller explicitly opts in.
APPLY_PENDING=false
for arg in "$@"; do
  case "$arg" in
    --apply-pending)
      APPLY_PENDING=true
      ;;
    *)
      echo "Unknown flag: $arg"
      echo "Usage: $0 [--apply-pending]"
      exit 2
      ;;
  esac
done
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

check() {
  local name="$1"
  local cmd="$2"
  printf "  %-50s " "$name"
  if eval "$cmd" >/dev/null 2>&1; then
    printf "${GREEN}✓${NC}\n"
    PASS=$((PASS + 1))
  else
    printf "${RED}✗${NC}\n"
    FAIL=$((FAIL + 1))
  fi
}

warn_check() {
  local name="$1"
  local cmd="$2"
  local expected="$3"
  printf "  %-50s " "$name"
  local actual
  actual=$(eval "$cmd" 2>/dev/null || echo "ERROR")
  if [ "$actual" = "$expected" ]; then
    printf "${GREEN}✓${NC} ($actual)\n"
    PASS=$((PASS + 1))
  else
    printf "${YELLOW}⚠${NC} (got '$actual', expected '$expected')\n"
    WARN=$((WARN + 1))
  fi
}

cd "$(dirname "$0")/.."

echo ""
echo "━━━ Pre-Demo Sanity Check ━━━"
echo ""

echo "Code health:"
check "TypeScript compiles clean"          "npx tsc --noEmit"
check "Vitest 928+ tests pass"             "npx vitest run --reporter=dot"

echo ""
echo "Demo fixtures:"
check "DEMO-CO.xlsx exists"                "test -f \"\$HOME/Downloads/DEMO-CO.xlsx\""
# Zero-dep row count via xlsx zip internals (xlsx files are ZIP archives with sheet1.xml).
# Avoids npm cache fragility from inline `npx tsx -e` (architect sub-13 closure).
warn_check "DEMO-CO.xlsx is 27+ rows"      "unzip -p \"\$HOME/Downloads/DEMO-CO.xlsx\" xl/worksheets/sheet1.xml 2>/dev/null | grep -o '<row r=' | wc -l | tr -d ' ' | awk '{print (\$1>=27)?\"ok\":\"low(\"\$1\")\"}'" "ok"

echo ""
echo "Dev server health:"
check "Port 3000 responds"                 "curl -s -o /dev/null http://localhost:3000"
warn_check "/budgeting auth gate (307)"    "curl -s -o /dev/null -w %{http_code} http://localhost:3000/budgeting" "307"
warn_check "/api/companies auth gate (307)" "curl -s -o /dev/null -w %{http_code} http://localhost:3000/api/companies" "307"
warn_check "/api/budgeting/availability"   "curl -s -o /dev/null -w %{http_code} http://localhost:3000/api/budgeting/availability" "307"
# Auth-regression guard: if middleware degrades and starts returning JSON without
# a session cookie, the 307-only check above would still ✓. Affirmatively reject.
check "Auth-gate doesn't leak data"        "! curl -s http://localhost:3000/api/companies | grep -qE '\"id\":|\"organizations\":'"
# Perf regression-guard for Turn-38-sub12 baseline (264ms warm; 600ms is 2.3× safety).
warn_check "/budgeting load < 0.6s"        "curl -s -o /dev/null -w '%{time_total}' -L http://localhost:3000/budgeting?tab=pnl-report 2>/dev/null | awk '{print (\$1 < 0.6)?\"ok\":\$1}'" "ok"

echo ""
echo "Database integrity (psql):"
if [ -f .env ]; then
  set -a; source .env; set +a
fi

if command -v psql >/dev/null 2>&1; then
  warn_check "AZMADE companies count = 14"   'psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM companies c JOIN \"Organization\" o ON o.id = c.\"organizationId\" WHERE o.slug='\''azmade'\''" | tr -d "[:space:]"' "14"
  # Tight bands (architect sub-13 closure): catches drops AND under/over-imports.
  # Current: 6816 lines / 41 IVs. Bands allow ±10% to absorb DEMO-CO seed +27 (sub-7).
  warn_check "AZMADE BudgetLines 6800-7500"  'psql "$DATABASE_URL" -t -c "SELECT CASE WHEN COUNT(*) BETWEEN 6800 AND 7500 THEN '\''ok'\'' ELSE COUNT(*)::text END FROM budget_lines bl JOIN budget_plans bp ON bp.id = bl.\"planId\" JOIN \"Organization\" o ON o.id = bp.\"organizationId\" WHERE o.slug='\''azmade'\''" | tr -d "[:space:]"' "ok"
  warn_check "AZMADE IndicatorValues 40-60"  'psql "$DATABASE_URL" -t -c "SELECT CASE WHEN COUNT(*) BETWEEN 40 AND 60 THEN '\''ok'\'' ELSE COUNT(*)::text END FROM indicator_values iv JOIN \"Organization\" o ON o.id = iv.\"organizationId\" WHERE o.slug='\''azmade'\''" | tr -d "[:space:]"' "ok"
  warn_check "Audit events 25-200"           'psql "$DATABASE_URL" -t -c "SELECT CASE WHEN COUNT(*) BETWEEN 25 AND 200 THEN '\''ok'\'' ELSE COUNT(*)::text END FROM audit_events" | tr -d "[:space:]"' "ok"
else
  printf "  ${YELLOW}⚠ psql not on PATH — skipping DB checks${NC}\n"
  WARN=$((WARN + 4))
fi

echo ""
echo "E2E smoke (Playwright):"
# Phase 7.G Turn E — closes documented-vs-actual drift. DEPLOYMENT_READINESS.md §5.1
# + ADMIN_RUNBOOK §0 documented `pre-demo-check.sh && npm run test:e2e` as the
# pre-prod gate but pre-demo-check.sh did not actually invoke the E2E suite.
# Now bundled. The visual-baseline spec (Turn E) catches what tsc + vitest can't
# (layout regressions). Cost: ~22-30s; acceptable for the pre-demo gate.
# E2E_SKIP_LLM=true skips the LLM-gated wizard case (real Anthropic API round-trip,
# ~20s + API cost) — that case is for hand-runs, not pre-demo automation.
check "Playwright smoke (incl. visual)"   "E2E_SKIP_LLM=true npm run test:e2e --silent"

echo ""
echo "Migration status:"
if [ "$APPLY_PENDING" = "true" ]; then
  # Apply any pending migrations FIRST, then run the warn-check on the
  # post-apply state. `prisma migrate deploy` is idempotent — applies
  # only pending migrations, no-op if up-to-date.
  #
  # stdout+stderr captured to ${TMPDIR}/pre-demo-migrate-$$.log so that
  # on failure the log path is referenced in the FAIL message — without
  # this, `>/dev/null 2>&1` would suppress the diagnostic detail (which
  # migrations applied + why deploy failed). On success the log can
  # still be consulted for audit (which migrations landed) — we report
  # ✓ inline either way. Architect Turn-XIX Round-1 ⚠️ #1 closure.
  MIGRATE_LOG="${TMPDIR:-/tmp}/pre-demo-migrate-$$.log"
  printf "  %-50s " "Auto-apply pending migrations"
  if npx prisma migrate deploy >"$MIGRATE_LOG" 2>&1; then
    printf "${GREEN}✓${NC}\n"
    PASS=$((PASS + 1))
  else
    printf "${RED}✗${NC} (prisma migrate deploy failed; log: $MIGRATE_LOG)\n"
    FAIL=$((FAIL + 1))
  fi
fi
warn_check "Prisma migrate status clean"   "npx prisma migrate status 2>&1 | grep -q 'Database schema is up to date' && echo ok || echo drift" "ok"

echo ""
echo "━━━ Summary ━━━"
echo "  Passed:   $PASS"
echo "  Warnings: $WARN"
echo "  Failed:   $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  printf "${RED}✗ NOT READY FOR DEMO${NC} — $FAIL hard failures. Fix before proceeding.\n"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  printf "${YELLOW}⚠ READY WITH WARNINGS${NC} — $WARN soft mismatches. Review then proceed.\n"
  exit 0
else
  printf "${GREEN}✓ DEMO GO${NC} — all checks pass.\n"
  exit 0
fi
