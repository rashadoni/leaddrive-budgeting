-- User layout preference tenant and ownership guards. Candidate only;
-- production application needs separate owner approval after isolated gates.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Keep the ownership scan stable while the migration replaces the policy and
-- installs both sides of the write invariant.
LOCK TABLE public.users, public.user_layout_preferences
  IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_layout_preferences'
      AND policyname = 'tenant_isolation'
      AND cmd = 'ALL'
      AND qual LIKE '%"organizationId"%app.organization_id%'
      AND qual LIKE '%app.bypass_rls%'
      AND with_check IS NULL
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_layout_preferences'
  ) <> 1 THEN
    RAISE EXCEPTION 'user layout preference preflight: unexpected policy'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_layout_preferences AS layout
    LEFT JOIN public.users AS account ON account.id = layout."userId"
    WHERE account.id IS NULL
       OR account."organizationId" IS DISTINCT FROM layout."organizationId"
  ) THEN
    RAISE EXCEPTION 'user layout preference preflight: cross-organization users exist'
      USING ERRCODE = 'check_violation';
  END IF;

  IF to_regprocedure('public.guard_user_layout_preference_write()') IS NOT NULL
  OR to_regprocedure('public.guard_user_layout_user_reassignment()') IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE (tgrelid = 'public.user_layout_preferences'::regclass
           AND tgname = 'user_layout_preference_write_guard_trg')
       OR (tgrelid = 'public.users'::regclass
           AND tgname = 'user_layout_user_reassignment_guard_trg')
  ) THEN
    RAISE EXCEPTION 'user layout preference preflight: guards already exist'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.guard_user_layout_preference_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  user_organization_id text;
BEGIN
  -- The matching users trigger takes the same transaction-scoped lock before
  -- an organization reassignment. This closes the insert/reassignment race
  -- without contending with normal lastLogin or role updates.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."userId", 0));

  SELECT account."organizationId"
  INTO user_organization_id
  FROM public.users AS account
  WHERE account.id = NEW."userId";

  IF user_organization_id IS NULL
  OR user_organization_id IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'layout user must belong to the same organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_user_layout_preference_write() FROM PUBLIC;

CREATE TRIGGER user_layout_preference_write_guard_trg
  BEFORE INSERT OR UPDATE ON public.user_layout_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_user_layout_preference_write();

CREATE FUNCTION public.guard_user_layout_user_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.id, 0));

  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
  AND EXISTS (
    SELECT 1
    FROM public.user_layout_preferences AS layout
    WHERE layout."userId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'user with saved layouts cannot be moved across organizations'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_user_layout_user_reassignment() FROM PUBLIC;

CREATE TRIGGER user_layout_user_reassignment_guard_trg
  BEFORE UPDATE OF "organizationId" ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_user_layout_user_reassignment();

DROP POLICY tenant_isolation ON public.user_layout_preferences;
CREATE POLICY tenant_select ON public.user_layout_preferences
  FOR SELECT
  USING ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_insert ON public.user_layout_preferences
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_update ON public.user_layout_preferences
  FOR UPDATE
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_delete ON public.user_layout_preferences
  FOR DELETE
  USING ("organizationId" = current_setting('app.organization_id', true));

DO $postcondition$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_layout_preferences'
  ) <> 4 OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('tenant_select', 'SELECT'),
      ('tenant_insert', 'INSERT'),
      ('tenant_update', 'UPDATE'),
      ('tenant_delete', 'DELETE')
    ) AS expected(policyname, cmd)
    WHERE (
      SELECT count(*)
      FROM pg_policies AS actual
      WHERE actual.schemaname = 'public'
        AND actual.tablename = 'user_layout_preferences'
        AND actual.policyname = expected.policyname
        AND actual.cmd = expected.cmd
    ) <> 1
  ) OR EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_layout_preferences'
      AND (
        coalesce(qual, '') LIKE '%app.bypass_rls%'
        OR coalesce(with_check, '') LIKE '%app.bypass_rls%'
        OR cmd NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'user_layout_preferences'
      AND pg_class.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'user layout preference postcondition: policy mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
    WHERE pg_trigger.tgrelid = 'public.user_layout_preferences'::regclass
      AND pg_trigger.tgname = 'user_layout_preference_write_guard_trg'
      AND NOT pg_trigger.tgisinternal
      AND pg_trigger.tgenabled = 'O'
      AND pg_proc.prosecdef
      AND pg_proc.proconfig = ARRAY['search_path=pg_catalog, public']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
    WHERE pg_trigger.tgrelid = 'public.users'::regclass
      AND pg_trigger.tgname = 'user_layout_user_reassignment_guard_trg'
      AND NOT pg_trigger.tgisinternal
      AND pg_trigger.tgenabled = 'O'
      AND pg_proc.prosecdef
      AND pg_proc.proconfig = ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'user layout preference postcondition: guard mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$postcondition$;

COMMIT;
