-- Evidence-core RLS hardening. Candidate only; production application needs
-- separate owner approval after isolated PostgreSQL gates.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['audit_events', 'period_snapshots']
  LOOP
    IF (
      SELECT count(*)
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND policyname = 'tenant_isolation'
        AND cmd = 'ALL'
        AND qual LIKE '%"organizationId"%app.organization_id%'
        AND qual LIKE '%app.bypass_rls%'
        AND with_check IS NULL
    ) <> 1 OR (
      SELECT count(*)
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    ) <> 1 THEN
      RAISE EXCEPTION 'evidence-core RLS preflight: unexpected policy on %', target_table
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  IF to_regprocedure('public.reject_period_snapshot_update()') IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.period_snapshots'::regclass
      AND tgname = 'period_snapshots_immutable_trg'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'evidence-core RLS preflight: period immutability trigger already exists'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$preflight$;

DROP POLICY tenant_isolation ON public.audit_events;
CREATE POLICY tenant_select ON public.audit_events
  FOR SELECT
  USING ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_insert ON public.audit_events
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

DROP POLICY tenant_isolation ON public.period_snapshots;
CREATE POLICY tenant_select ON public.period_snapshots
  FOR SELECT
  USING ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_insert ON public.period_snapshots
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

CREATE FUNCTION public.reject_period_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'period_snapshots are immutable; create a new sign-off row'
    USING ERRCODE = 'restrict_violation';
END;
$function$;

CREATE TRIGGER period_snapshots_immutable_trg
  BEFORE UPDATE ON public.period_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_period_snapshot_update();

DO $postcondition$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['audit_events', 'period_snapshots']
  LOOP
    IF (
      SELECT count(*)
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    ) <> 2 OR EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND (
          coalesce(qual, '') LIKE '%app.bypass_rls%'
          OR coalesce(with_check, '') LIKE '%app.bypass_rls%'
          OR cmd NOT IN ('SELECT', 'INSERT')
        )
    ) THEN
      RAISE EXCEPTION 'evidence-core RLS postcondition failed on %', target_table
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.audit_events'::regclass
      AND tgname = 'audit_events_notify_trg'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.period_snapshots'::regclass
      AND tgname = 'period_snapshots_immutable_trg'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'evidence-core RLS postcondition: trigger mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$postcondition$;

COMMIT;
