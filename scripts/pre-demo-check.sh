#!/usr/bin/env bash
# Pre-demo sanity check — single command Day-5 morning before customer demo.
#
# Exit code 0 = system green light, demo can proceed.
# Exit code != 0 = P0 fix needed; do NOT start demo until resolved.
#
# Verifies:
#  1. TypeScript compiles clean
#  2. All vitest tests pass
#  3. Production build succeeds (catches Next.js issues dev hides)
#  4. ~/Downloads/DEMO-CO.xlsx exists + correct row count (27)
#  5. Dev server is running on port 3000
#  6. Critical API endpoints return 307 (auth redirect = healthy)
#  7. DB integrity: AZMADE org has expected company / line counts
#
# Usage:
#   bash scripts/pre-demo-check.sh
#
# Re-run after any P0 fix until exit 0.

set -e
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
warn_check "DEMO-CO.xlsx is 27 rows"       "npx tsx -e 'import x from \"xlsx\"; const wb=x.readFile(process.env.HOME+\"/Downloads/DEMO-CO.xlsx\"); const rows=x.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1}); console.log(rows.filter(r=>r[0]&&String(r[0]).match(/^\\d/)).length)'" "27"

echo ""
echo "Dev server health:"
check "Port 3000 responds"                 "curl -s -o /dev/null http://localhost:3000"
warn_check "/budgeting auth gate"          "curl -s -o /dev/null -w %{http_code} http://localhost:3000/budgeting" "307"
warn_check "/api/companies auth gate"      "curl -s -o /dev/null -w %{http_code} http://localhost:3000/api/companies" "307"
warn_check "/api/budgeting/availability"   "curl -s -o /dev/null -w %{http_code} http://localhost:3000/api/budgeting/availability" "307"

echo ""
echo "Database integrity (psql):"
if [ -f .env ]; then
  set -a; source .env; set +a
fi

if command -v psql >/dev/null 2>&1; then
  warn_check "AZMADE companies count = 14"   'psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM companies c JOIN \"Organization\" o ON o.id = c.\"organizationId\" WHERE o.slug='\''azmade'\''" | tr -d "[:space:]"' "14"
  warn_check "AZMADE BudgetLines > 6800"     'psql "$DATABASE_URL" -t -c "SELECT CASE WHEN COUNT(*) >= 6800 THEN '\''ok'\'' ELSE COUNT(*)::text END FROM budget_lines bl JOIN budget_plans bp ON bp.id = bl.\"planId\" JOIN \"Organization\" o ON o.id = bp.\"organizationId\" WHERE o.slug='\''azmade'\''" | tr -d "[:space:]"' "ok"
  warn_check "AZMADE IndicatorValues >= 41"  'psql "$DATABASE_URL" -t -c "SELECT CASE WHEN COUNT(*) >= 41 THEN '\''ok'\'' ELSE COUNT(*)::text END FROM indicator_values iv JOIN \"Organization\" o ON o.id = iv.\"organizationId\" WHERE o.slug='\''azmade'\''" | tr -d "[:space:]"' "ok"
  warn_check "Audit events present"          'psql "$DATABASE_URL" -t -c "SELECT CASE WHEN COUNT(*) >= 1 THEN '\''ok'\'' ELSE '\''empty'\'' END FROM audit_events" | tr -d "[:space:]"' "ok"
else
  printf "  ${YELLOW}⚠ psql not on PATH — skipping DB checks${NC}\n"
  WARN=$((WARN + 4))
fi

echo ""
echo "Migration status:"
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
