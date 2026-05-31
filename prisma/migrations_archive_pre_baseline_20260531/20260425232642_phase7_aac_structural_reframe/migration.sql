-- Phase 7.B AZMADE structural reframe (Turn 14): AAC is a single
-- operational company directly under AZMADE org, NOT a sub-group with an
-- AAC-MAIN child. Idempotent because:
--   - Fresh DBs seeded by `scripts/seed-azmade-holding.ts` (Turn-14
--     onwards) already produce the correct shape; nothing to do.
--   - DBs that were seeded BEFORE Turn 14 carry both rows and need the
--     promote-then-drop dance.
-- Either way the migration is a no-op when the target shape is already
-- in place. Safe to re-run.
--
-- Scope: AZMADE org only. Other orgs (e.g. Demo Company) are untouched
-- because they don't have AAC / AAC-MAIN rows seeded.

DO $$
DECLARE
  v_org_id TEXT;
  v_aac_wrapper_id TEXT;
  v_aac_main_id TEXT;
BEGIN
  -- Locate the azmade organization. If absent (e.g. fresh CI DB without
  -- seed run yet), skip — nothing to migrate.
  SELECT id INTO v_org_id FROM "Organization" WHERE slug = 'azmade';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'Skipping phase7_aac_structural_reframe: no azmade org';
    RETURN;
  END IF;

  -- Locate the level=1 AAC wrapper (the row to drop).
  SELECT id INTO v_aac_wrapper_id
  FROM companies
  WHERE "organizationId" = v_org_id
    AND code = 'AAC'
    AND level = 1;

  -- Locate the level=2 AAC-MAIN operational entity (the row to rename).
  SELECT id INTO v_aac_main_id
  FROM companies
  WHERE "organizationId" = v_org_id
    AND code = 'AAC-MAIN';

  -- Already-correct shape: AAC level=2 with no wrapper. No-op.
  IF v_aac_wrapper_id IS NULL AND v_aac_main_id IS NULL THEN
    RAISE NOTICE 'phase7_aac_structural_reframe: shape already correct, skipping';
    RETURN;
  END IF;

  -- Drop the wrapper FIRST (frees the 'AAC' code slot for the rename).
  -- The wrapper is expected to be empty (no BudgetLines, IndicatorValues,
  -- bookings, etc.) because data-bearing rows live on level=2. If the
  -- wrapper has children other than AAC-MAIN, this DELETE fails on FK
  -- and the migration aborts — surfaces the unexpected state instead of
  -- corrupting it.
  IF v_aac_wrapper_id IS NOT NULL THEN
    DELETE FROM companies WHERE id = v_aac_wrapper_id;
  END IF;

  -- Promote AAC-MAIN to AAC at level=2, parent=NULL.
  IF v_aac_main_id IS NOT NULL THEN
    UPDATE companies
    SET code = 'AAC',
        name = 'AAC',
        "nameAz" = NULL,
        "nameEn" = 'AAC',
        "parentCompanyId" = NULL,
        "sortOrder" = 11
    WHERE id = v_aac_main_id;
  END IF;
END
$$;
