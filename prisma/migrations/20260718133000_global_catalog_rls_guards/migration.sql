-- Global catalog RLS hardening — native PostgreSQL BYPASSRLS is the only
-- write boundary for product-owned reference rows.
--
-- Candidate only. Do not apply to a shared/production database until the
-- isolated PostgreSQL 16 fresh-replay, upgrade and live negative-control gates
-- pass and the owner explicitly approves the production migration.
--
-- Scope is deliberately narrow:
--   * indicator_definitions: global + own rows remain readable; request-role
--     writes are limited to tenant-owned overrides;
--   * industries: shared taxonomy remains readable and becomes request-role
--     read-only.
-- The remaining 67 ordinary GUC-bypass policies are separate reviewed cohorts.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Fail closed if the predecessor policy shape is not the reviewed production
-- shape. A catalog mismatch must abort before either table changes.
DO $catalog_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'indicator_definitions'
      AND policyname = 'tenant_isolation'
      AND cmd = 'ALL'
      AND qual LIKE '%"organizationId" IS NULL%'
      AND qual LIKE '%app.bypass_rls%'
  ) THEN
    RAISE EXCEPTION
      'global catalog RLS preflight: unexpected indicator_definitions policy'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'industries'
      AND policyname = 'tenant_isolation'
      AND cmd = 'ALL'
      AND qual = 'true'
  ) THEN
    RAISE EXCEPTION
      'global catalog RLS preflight: unexpected industries policy'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$catalog_preflight$;

-- Global definitions are product-owned reference rows. App traffic may read
-- them, but only native budgetpro_admin may seed/change/delete them. Tenant
-- overrides remain normal request-role CRUD inside the active org scope.
DROP POLICY IF EXISTS tenant_isolation ON public.indicator_definitions;
DROP POLICY IF EXISTS tenant_insert ON public.indicator_definitions;
DROP POLICY IF EXISTS tenant_update ON public.indicator_definitions;
DROP POLICY IF EXISTS tenant_delete ON public.indicator_definitions;

CREATE POLICY tenant_isolation ON public.indicator_definitions
  FOR SELECT
  USING (
    "organizationId" IS NULL
    OR "organizationId" = current_setting('app.organization_id', true)
  );

CREATE POLICY tenant_insert ON public.indicator_definitions
  FOR INSERT
  WITH CHECK (
    "organizationId" = current_setting('app.organization_id', true)
  );

CREATE POLICY tenant_update ON public.indicator_definitions
  FOR UPDATE
  USING (
    "organizationId" = current_setting('app.organization_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.organization_id', true)
  );

CREATE POLICY tenant_delete ON public.indicator_definitions
  FOR DELETE
  USING (
    "organizationId" = current_setting('app.organization_id', true)
  );

-- Industries has no organizationId and is a shared seed taxonomy. Keep public
-- SELECT; expose no request-role write policy. The role-provisioning script
-- additionally revokes DML privileges as defence in depth.
DROP POLICY IF EXISTS tenant_isolation ON public.industries;
DROP POLICY IF EXISTS tenant_insert ON public.industries;
DROP POLICY IF EXISTS tenant_update ON public.industries;
DROP POLICY IF EXISTS tenant_delete ON public.industries;

CREATE POLICY tenant_isolation ON public.industries
  FOR SELECT
  USING (true);

-- Verify both special shapes before committing. The 67 ordinary policies still
-- carry the historical GUC until their domain-specific cohorts are reviewed.
DO $catalog_postcondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('indicator_definitions', 'industries')
      AND (
        coalesce(qual, '') LIKE '%app.bypass_rls%'
        OR coalesce(with_check, '') LIKE '%app.bypass_rls%'
      )
  ) THEN
    RAISE EXCEPTION
      'global catalog RLS postcondition: custom GUC remains'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'indicator_definitions'
  ) <> 4 THEN
    RAISE EXCEPTION
      'global catalog RLS postcondition: indicator policy count mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'industries'
      AND cmd = 'SELECT'
      AND qual = 'true'
  ) <> 1 THEN
    RAISE EXCEPTION
      'global catalog RLS postcondition: industries SELECT policy mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$catalog_postcondition$;

COMMIT;
