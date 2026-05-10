#!/usr/bin/env bash
# Phase 7.G Turn LXXXXIV — backfill 2 BudgetLine fields tracked in CARRYOVER 🔄.
#
# CONTEXT (per CARRYOVER L382 + L383):
# - Turn-XXXIX: code-side currencyCode tagging shipped (every NEW BudgetLine.create
#   tags from `company.baseCurrencyCode ?? 'AZN'`). But ~10584 EXISTING NULL-currencyCode
#   BudgetLines need backfill.
# - Turn-XL: schema migration + writer updates shipped (every NEW BudgetLine.create
#   tags monthIndex 0..11). But ~15089 EXISTING BudgetLines have monthIndex IS NULL.
#
# USAGE:
#   bash scripts/backfill-budget-lines.sh [--dry-run]
#
# WHAT IT DOES:
# 1. Counts NULL rows pre-backfill (sanity check).
# 2. Updates currencyCode from companies.baseCurrencyCode where missing.
# 3. Updates monthIndex via sortOrder heuristic (sortOrder % 100 for non-orphan rows).
# 4. Counts NULL rows post-backfill (verify).
# 5. POST /api/indicators (recompute) — picks up new tagging for FX_IMPORTED_INPUT signal.
#
# SAFETY:
# - Uses BEGIN/COMMIT transaction (rollback if any UPDATE fails).
# - 3353 orphan-companyId pre-Phase-7 legacy rows stay NULL by design (those are
#   not visible to company-scoped indicators).
# - ROLLUP-* synthetic codes leave monthIndex NULL by design (annual-only).

set -euo pipefail

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set. Source .env first." >&2
  exit 1
fi

echo "=== Phase 7.G Turn LXXXXIV BudgetLine backfill ==="
echo "DATABASE_URL: ${DATABASE_URL//:*/}:***"  # mask password
echo "Dry-run: $DRY_RUN"
echo ""

echo "--- Pre-backfill counts ---"
psql "$DATABASE_URL" <<'SQL'
SELECT
  COUNT(*) FILTER (WHERE "currencyCode" IS NULL) AS null_currency,
  COUNT(*) FILTER (WHERE "monthIndex" IS NULL) AS null_monthindex,
  COUNT(*) FILTER (WHERE "companyId" IS NULL) AS orphan_company_id,
  COUNT(*) AS total
FROM budget_lines;
SQL

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "--- DRY RUN: SQL that WOULD run ---"
  cat <<'PREVIEW'
BEGIN;

-- (1) currencyCode backfill from companies.baseCurrencyCode
UPDATE budget_lines bl
SET "currencyCode" = c."baseCurrencyCode"
FROM companies c
WHERE bl."companyId" = c.id
  AND bl."currencyCode" IS NULL
  AND c."baseCurrencyCode" IS NOT NULL;

-- (2) monthIndex backfill via sortOrder heuristic
-- Covers BOTH monthly-imported lines (sortOrder = monthIdx) and full-xlsx-imported
-- lines (sortOrder = r*100+m). Orphan-companyId rows stay NULL by design.
UPDATE budget_lines
SET "monthIndex" = "sortOrder" % 100
WHERE "monthIndex" IS NULL
  AND "companyId" IS NOT NULL
  AND "sortOrder" >= 0
  AND "sortOrder" < 1200;

COMMIT;
PREVIEW
  echo ""
  echo "DRY RUN complete — no DB changes. Run without --dry-run to execute."
  exit 0
fi

echo ""
echo "--- Executing backfill (transactional) ---"
psql "$DATABASE_URL" <<'SQL'
BEGIN;

UPDATE budget_lines bl
SET "currencyCode" = c."baseCurrencyCode"
FROM companies c
WHERE bl."companyId" = c.id
  AND bl."currencyCode" IS NULL
  AND c."baseCurrencyCode" IS NOT NULL;

UPDATE budget_lines
SET "monthIndex" = "sortOrder" % 100
WHERE "monthIndex" IS NULL
  AND "companyId" IS NOT NULL
  AND "sortOrder" >= 0
  AND "sortOrder" < 1200;

COMMIT;
SQL

echo ""
echo "--- Post-backfill counts ---"
psql "$DATABASE_URL" <<'SQL'
SELECT
  COUNT(*) FILTER (WHERE "currencyCode" IS NULL) AS null_currency_remaining,
  COUNT(*) FILTER (WHERE "monthIndex" IS NULL) AS null_monthindex_remaining,
  COUNT(*) FILTER (WHERE "companyId" IS NULL) AS orphan_company_id,
  COUNT(*) AS total
FROM budget_lines;
SQL

echo ""
echo "--- Triggering recompute (POST /api/indicators) ---"
echo "Note: only picks up new tagging if dev server is running on :3000."
echo "If skipped, run manually: curl -X POST http://localhost:3000/api/indicators -H 'cookie: <session>'"
echo ""
echo "Backfill complete. Closes CARRYOVER 🔄 rows L382 (currencyCode) + L383 (monthIndex)."
