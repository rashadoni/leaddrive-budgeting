-- Budget section tenant and plan-reference guards. Candidate only;
-- production application needs separate owner approval after isolated gates.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public."Organization", public.budget_plans, public.budget_sections
  IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_sections'
      AND policyname = 'tenant_isolation'
      AND cmd = 'ALL'
      AND qual LIKE '%"organizationId"%app.organization_id%'
      AND qual LIKE '%app.bypass_rls%'
      AND with_check IS NULL
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_sections'
  ) <> 1 THEN
    RAISE EXCEPTION 'budget section preflight: unexpected policy'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conname = 'budget_sections_planId_fkey'
      AND conrelid = 'public.budget_sections'::regclass
      AND confrelid = 'public.budget_plans'::regclass
      AND contype = 'f'
      AND confupdtype = 'c'
      AND confdeltype = 'c'
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_constraint
    WHERE conname = 'budget_plans_organizationId_fkey'
      AND conrelid = 'public.budget_plans'::regclass
      AND confrelid = 'public."Organization"'::regclass
      AND contype = 'f'
      AND confupdtype = 'c'
      AND confdeltype = 'c'
  ) <> 1 OR EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'budget_sections_organizationId_fkey'
      AND conrelid = 'public.budget_sections'::regclass
  ) THEN
    RAISE EXCEPTION 'budget section preflight: unexpected foreign keys'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.budget_sections AS section
    LEFT JOIN public."Organization" AS organization
      ON organization.id = section."organizationId"
    LEFT JOIN public.budget_plans AS plan
      ON plan.id = section."planId"
    WHERE organization.id IS NULL
       OR plan.id IS NULL
       OR plan."organizationId" IS DISTINCT FROM section."organizationId"
  ) THEN
    RAISE EXCEPTION 'budget section preflight: orphan or cross-organization references exist'
      USING ERRCODE = 'check_violation';
  END IF;

  IF to_regprocedure('public.guard_budget_section_plan_write()') IS NOT NULL
  OR to_regprocedure('public.guard_budget_section_plan_reassignment()') IS NOT NULL
  OR EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE (tgrelid = 'public.budget_sections'::regclass
           AND tgname = 'budget_section_plan_write_guard_trg')
       OR (tgrelid = 'public.budget_plans'::regclass
           AND tgname = 'budget_section_plan_reassignment_guard_trg')
  ) THEN
    RAISE EXCEPTION 'budget section preflight: guards already exist'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$preflight$;

ALTER TABLE public.budget_sections
  ADD CONSTRAINT "budget_sections_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

CREATE FUNCTION public.guard_budget_section_plan_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  plan_organization_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."planId", 2));

  SELECT plan."organizationId"
  INTO plan_organization_id
  FROM public.budget_plans AS plan
  WHERE plan.id = NEW."planId";

  IF plan_organization_id IS NULL
  OR plan_organization_id IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'budget section plan must belong to the same organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_budget_section_plan_write() FROM PUBLIC;

CREATE TRIGGER budget_section_plan_write_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "planId"
  ON public.budget_sections
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_section_plan_write();

CREATE FUNCTION public.guard_budget_section_plan_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.id, 2));

  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
  AND EXISTS (
    SELECT 1 FROM public.budget_sections WHERE "planId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'plan with budget sections cannot move across organizations'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_budget_section_plan_reassignment() FROM PUBLIC;

CREATE TRIGGER budget_section_plan_reassignment_guard_trg
  BEFORE UPDATE OF "organizationId" ON public.budget_plans
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_section_plan_reassignment();

DROP POLICY tenant_isolation ON public.budget_sections;
CREATE POLICY tenant_select ON public.budget_sections
  FOR SELECT
  USING ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_insert ON public.budget_sections
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_update ON public.budget_sections
  FOR UPDATE
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_delete ON public.budget_sections
  FOR DELETE
  USING ("organizationId" = current_setting('app.organization_id', true));

DO $postcondition$
DECLARE
  guard_count integer;
BEGIN
  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'budget_sections'
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
        AND actual.tablename = 'budget_sections'
        AND actual.policyname = expected.policyname
        AND actual.cmd = expected.cmd
    ) <> 1
  ) OR EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_sections'
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
      AND pg_class.relname = 'budget_sections'
      AND pg_class.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'budget section postcondition: policy mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (
    SELECT count(*) FROM pg_constraint
    WHERE conname = 'budget_sections_organizationId_fkey'
      AND conrelid = 'public.budget_sections'::regclass
      AND confrelid = 'public."Organization"'::regclass
      AND contype = 'f'
      AND confupdtype = 'c'
      AND confdeltype = 'c'
      AND convalidated
  ) <> 1 THEN
    RAISE EXCEPTION 'budget section postcondition: organization FK mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO guard_count
  FROM pg_trigger
  JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
  WHERE pg_trigger.tgname IN (
    'budget_section_plan_write_guard_trg',
    'budget_section_plan_reassignment_guard_trg'
  )
    AND NOT pg_trigger.tgisinternal
    AND pg_trigger.tgenabled = 'O'
    AND pg_proc.prosecdef
    AND pg_proc.proconfig = ARRAY['search_path=pg_catalog, public'];

  IF guard_count <> 2 THEN
    RAISE EXCEPTION 'budget section postcondition: guard mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$postcondition$;

COMMIT;
