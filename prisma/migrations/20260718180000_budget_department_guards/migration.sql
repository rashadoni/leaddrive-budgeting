-- Budget department tenant and reference guards. Candidate only;
-- production application needs separate owner approval after isolated gates.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Freeze every side of the invariants while preflight validates historical
-- rows and the migration installs the matching write/reassignment guards.
LOCK TABLE public.users,
  public.budget_departments,
  public.budget_lines,
  public.budget_actuals,
  public.budget_forecast_entries,
  public.budget_direction_templates,
  public.sales_forecasts,
  public.expense_forecasts,
  public.budget_department_owners
  IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_departments'
      AND policyname = 'tenant_isolation'
      AND cmd = 'ALL'
      AND qual LIKE '%"organizationId"%app.organization_id%'
      AND qual LIKE '%app.bypass_rls%'
      AND with_check IS NULL
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_departments'
  ) <> 1 THEN
    RAISE EXCEPTION 'budget department preflight: unexpected policy'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('budget_lines_departmentId_fkey', 'public.budget_lines'::regclass, 'n'),
      ('budget_actuals_departmentId_fkey', 'public.budget_actuals'::regclass, 'n'),
      ('budget_forecast_entries_departmentId_fkey', 'public.budget_forecast_entries'::regclass, 'n'),
      ('budget_direction_templates_departmentId_fkey', 'public.budget_direction_templates'::regclass, 'n'),
      ('sales_forecasts_departmentId_fkey', 'public.sales_forecasts'::regclass, 'c'),
      ('expense_forecasts_departmentId_fkey', 'public.expense_forecasts'::regclass, 'c'),
      ('budget_department_owners_departmentId_fkey', 'public.budget_department_owners'::regclass, 'c')
    ) AS expected(constraint_name, child_table, delete_action)
    WHERE (
      SELECT count(*)
      FROM pg_constraint AS actual
      WHERE actual.conname = expected.constraint_name
        AND actual.conrelid = expected.child_table
        AND actual.confrelid = 'public.budget_departments'::regclass
        AND actual.contype = 'f'
        AND actual.confupdtype = 'c'
        AND actual.confdeltype = expected.delete_action::"char"
    ) <> 1
  ) THEN
    RAISE EXCEPTION 'budget department preflight: unexpected foreign keys'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.budget_lines AS child
    JOIN public.budget_departments AS department ON department.id = child."departmentId"
    WHERE child."organizationId" IS DISTINCT FROM department."organizationId"
  ) OR EXISTS (
    SELECT 1 FROM public.budget_actuals AS child
    JOIN public.budget_departments AS department ON department.id = child."departmentId"
    WHERE child."organizationId" IS DISTINCT FROM department."organizationId"
  ) OR EXISTS (
    SELECT 1 FROM public.budget_forecast_entries AS child
    JOIN public.budget_departments AS department ON department.id = child."departmentId"
    WHERE child."organizationId" IS DISTINCT FROM department."organizationId"
  ) OR EXISTS (
    SELECT 1 FROM public.budget_direction_templates AS child
    JOIN public.budget_departments AS department ON department.id = child."departmentId"
    WHERE child."organizationId" IS DISTINCT FROM department."organizationId"
  ) OR EXISTS (
    SELECT 1 FROM public.sales_forecasts AS child
    JOIN public.budget_departments AS department ON department.id = child."departmentId"
    WHERE child."organizationId" IS DISTINCT FROM department."organizationId"
  ) OR EXISTS (
    SELECT 1 FROM public.expense_forecasts AS child
    JOIN public.budget_departments AS department ON department.id = child."departmentId"
    WHERE child."organizationId" IS DISTINCT FROM department."organizationId"
  ) OR EXISTS (
    SELECT 1 FROM public.budget_department_owners AS child
    JOIN public.budget_departments AS department ON department.id = child."departmentId"
    WHERE child."organizationId" IS DISTINCT FROM department."organizationId"
  ) THEN
    RAISE EXCEPTION 'budget department preflight: cross-organization references exist'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.budget_department_owners AS owner_row
    LEFT JOIN public.users AS account ON account.id = owner_row."userId"
    WHERE account.id IS NULL
       OR account."organizationId" IS DISTINCT FROM owner_row."organizationId"
  ) THEN
    RAISE EXCEPTION 'budget department preflight: cross-organization owners exist'
      USING ERRCODE = 'check_violation';
  END IF;

  IF to_regprocedure('public.guard_budget_department_reference_write()') IS NOT NULL
  OR to_regprocedure('public.guard_budget_department_reassignment()') IS NOT NULL
  OR to_regprocedure('public.guard_budget_department_owner_write()') IS NOT NULL
  OR to_regprocedure('public.guard_budget_department_owner_user_reassignment()') IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname IN (
      'budget_line_department_guard_trg',
      'budget_actual_department_guard_trg',
      'budget_forecast_entry_department_guard_trg',
      'budget_direction_template_department_guard_trg',
      'sales_forecast_department_guard_trg',
      'expense_forecast_department_guard_trg',
      'budget_department_owner_write_guard_trg',
      'budget_department_reassignment_guard_trg',
      'budget_department_owner_user_reassignment_guard_trg'
    )
  ) THEN
    RAISE EXCEPTION 'budget department preflight: guards already exist'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.guard_budget_department_reference_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  department_organization_id text;
BEGIN
  IF NEW."departmentId" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."departmentId", 0));

  SELECT department."organizationId"
  INTO department_organization_id
  FROM public.budget_departments AS department
  WHERE department.id = NEW."departmentId";

  IF department_organization_id IS NULL
  OR department_organization_id IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'budget department reference must belong to the same organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_budget_department_reference_write() FROM PUBLIC;

CREATE TRIGGER budget_line_department_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "departmentId" ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_department_reference_write();
CREATE TRIGGER budget_actual_department_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "departmentId" ON public.budget_actuals
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_department_reference_write();
CREATE TRIGGER budget_forecast_entry_department_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "departmentId" ON public.budget_forecast_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_department_reference_write();
CREATE TRIGGER budget_direction_template_department_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "departmentId" ON public.budget_direction_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_department_reference_write();
CREATE TRIGGER sales_forecast_department_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "departmentId" ON public.sales_forecasts
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_department_reference_write();
CREATE TRIGGER expense_forecast_department_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "departmentId" ON public.expense_forecasts
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_department_reference_write();

CREATE FUNCTION public.guard_budget_department_owner_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  department_organization_id text;
  user_organization_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."departmentId", 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."userId", 0));

  SELECT department."organizationId"
  INTO department_organization_id
  FROM public.budget_departments AS department
  WHERE department.id = NEW."departmentId";

  SELECT account."organizationId"
  INTO user_organization_id
  FROM public.users AS account
  WHERE account.id = NEW."userId";

  IF department_organization_id IS NULL
  OR department_organization_id IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'department owner department must belong to the same organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF user_organization_id IS NULL
  OR user_organization_id IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'department owner user must belong to the same organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_budget_department_owner_write() FROM PUBLIC;

CREATE TRIGGER budget_department_owner_write_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "departmentId", "userId"
  ON public.budget_department_owners
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_department_owner_write();

CREATE FUNCTION public.guard_budget_department_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.id, 0));

  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
  AND (
    EXISTS (SELECT 1 FROM public.budget_lines WHERE "departmentId" = OLD.id)
    OR EXISTS (SELECT 1 FROM public.budget_actuals WHERE "departmentId" = OLD.id)
    OR EXISTS (SELECT 1 FROM public.budget_forecast_entries WHERE "departmentId" = OLD.id)
    OR EXISTS (SELECT 1 FROM public.budget_direction_templates WHERE "departmentId" = OLD.id)
    OR EXISTS (SELECT 1 FROM public.sales_forecasts WHERE "departmentId" = OLD.id)
    OR EXISTS (SELECT 1 FROM public.expense_forecasts WHERE "departmentId" = OLD.id)
    OR EXISTS (SELECT 1 FROM public.budget_department_owners WHERE "departmentId" = OLD.id)
  ) THEN
    RAISE EXCEPTION 'referenced budget department cannot move across organizations'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_budget_department_reassignment() FROM PUBLIC;

CREATE TRIGGER budget_department_reassignment_guard_trg
  BEFORE UPDATE OF "organizationId" ON public.budget_departments
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_department_reassignment();

CREATE FUNCTION public.guard_budget_department_owner_user_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.id, 0));

  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
  AND EXISTS (
    SELECT 1 FROM public.budget_department_owners
    WHERE "userId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'department owner user cannot move across organizations'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_budget_department_owner_user_reassignment() FROM PUBLIC;

CREATE TRIGGER budget_department_owner_user_reassignment_guard_trg
  BEFORE UPDATE OF "organizationId" ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_department_owner_user_reassignment();

DROP POLICY tenant_isolation ON public.budget_departments;
CREATE POLICY tenant_select ON public.budget_departments
  FOR SELECT
  USING ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_insert ON public.budget_departments
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_update ON public.budget_departments
  FOR UPDATE
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

DO $postcondition$
DECLARE
  guard_count integer;
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_departments'
  ) <> 3 OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('tenant_select', 'SELECT'),
      ('tenant_insert', 'INSERT'),
      ('tenant_update', 'UPDATE')
    ) AS expected(policyname, cmd)
    WHERE (
      SELECT count(*)
      FROM pg_policies AS actual
      WHERE actual.schemaname = 'public'
        AND actual.tablename = 'budget_departments'
        AND actual.policyname = expected.policyname
        AND actual.cmd = expected.cmd
    ) <> 1
  ) OR EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_departments'
      AND (
        coalesce(qual, '') LIKE '%app.bypass_rls%'
        OR coalesce(with_check, '') LIKE '%app.bypass_rls%'
        OR cmd NOT IN ('SELECT', 'INSERT', 'UPDATE')
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'budget_departments'
      AND pg_class.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'budget department postcondition: policy mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO guard_count
  FROM pg_trigger
  JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
  WHERE pg_trigger.tgname IN (
    'budget_line_department_guard_trg',
    'budget_actual_department_guard_trg',
    'budget_forecast_entry_department_guard_trg',
    'budget_direction_template_department_guard_trg',
    'sales_forecast_department_guard_trg',
    'expense_forecast_department_guard_trg',
    'budget_department_owner_write_guard_trg',
    'budget_department_reassignment_guard_trg',
    'budget_department_owner_user_reassignment_guard_trg'
  )
    AND NOT pg_trigger.tgisinternal
    AND pg_trigger.tgenabled = 'O'
    AND pg_proc.prosecdef
    AND pg_proc.proconfig = ARRAY['search_path=pg_catalog, public'];

  IF guard_count <> 9 THEN
    RAISE EXCEPTION 'budget department postcondition: guard mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$postcondition$;

COMMIT;
