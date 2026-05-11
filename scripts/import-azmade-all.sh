#!/usr/bin/env bash
#
# Phase 7.G CXXXVII — single-command full import pipeline for AZMADE.
#
# Runs all 3 import scripts in correct dependency order:
#   1. import-azmade-budgets.ts  → BudgetLine (P&L planned, from SOPL sheets)
#   2. import-azmade-bs-cf.ts    → BalanceSheetLine + CashFlowEntry (BS + CF)
#   3. import-azmade-sales.ts    → ProductLine + SalesBudgetLine (per-product
#                                  sales for AAC)
#
# Each script is idempotent — re-running converges to the same DB state.
# Execution stops on the first failure (set -e) so you don't continue on
# broken state.
#
# Prerequisites:
#   - Postgres up (`brew services list | grep postgres`)
#   - AZMADE org seeded (`npx tsx scripts/seed-azmade-holding.ts` if first run)
#   - Cleanup of fake data already done (see docs/CLEANUP_DEMO_DATA.md Steps 1-2)
#
# Usage:
#   bash scripts/import-azmade-all.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo ""
echo "=========================================================="
echo "  AZMADE full import pipeline — Phase 7.G CXXXVII"
echo "  Repo: $REPO_ROOT"
echo "=========================================================="
echo ""

step() {
  echo ""
  echo "──────────────────────────────────────────────────────────"
  echo "  $1"
  echo "──────────────────────────────────────────────────────────"
}

step "1/3 — P&L import (SOPL sheets → budget_lines)"
npx tsx scripts/import-azmade-budgets.ts

step "2/3 — BS + CF import (SOFP/BS + CFS/CF sheets)"
npx tsx scripts/import-azmade-bs-cf.ts

step "3/3 — AAC sales by product (S-all sheet)"
npx tsx scripts/import-azmade-sales.ts

echo ""
echo "=========================================================="
echo "  ✓ FULL IMPORT COMPLETE"
echo ""
echo "  Verify in browser:"
echo "    /budgeting?tab=pnl-report     — P&L (real client data)"
echo "    /budgeting?tab=balance-sheet  — Balance Sheet"
echo "    /budgeting?tab=cash-flow      — Cash Flow"
echo "    /budgeting?tab=sales-budget   — Sales by product (AAC)"
echo "    /budgeting/terminal           — Risk Terminal HeatMap"
echo "=========================================================="
echo ""
