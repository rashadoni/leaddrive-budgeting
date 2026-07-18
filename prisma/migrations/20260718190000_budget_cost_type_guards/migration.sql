-- Budget cost type tenant and reference guards. Candidate only;
-- production application needs separate owner approval after isolated gates.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public.budget_cost_types,
  public.budget_lines,
  public.budget_actuals,
  public.budget_forecast_entries,
  public.budget_direction_templates,
  public.expense_forecasts
  IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_cost_types'
      AND policyname = 'tenant_isolation'
      AND cmd = 'ALL'
      AND qual LIKE '%"organizationId"%app.organization_id%'
      AND qual LIKE '%app.bypass_rls%'
      AND with_check IS NULL
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_cost_types'
  ) <> 1 THEN
    RAISE EXCEPTION 'budget cost type preflight: unexpected policy'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('budget_lines_costTypeId_fkey', 'public.budget_lines'::regclass, 'n'),
      ('budget_actuals_costTypeId_fkey', 'public.budget_actuals'::regclass, 'n'),
      ('budget_forecast_entries_costTypeId_fkey', 'public.budget_forecast_entries'::regclass, 'n'),
      ('budget_direction_templates_costTypeId_fkey', 'public.budget_direction_templates'::regclass, 'n'),
      ('expense_forecasts_costTypeId_fkey', 'public.expense_forecasts'::regclass, 'c')
    ) AS expected(constraint_name, child_table, delete_action)
    WHERE (
      SELECT count(*)
      FROM pg_constraint AS actual
      WHERE actual.conname = expected.constraint_name
        AND actual.conrelid = expected.child_table
        AND actual.confrelid = 'public.budget_cost_types'::regclass
        AND actual.contype = 'f'
        AND actual.confupdtype = 'c'
        AND actual.confdeltype = expected.delete_action::"char"
    ) <> 1
  ) THEN
    RAISE EXCEPTION 'budget cost type preflight: unexpected foreign keys'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.budget_lines AS child
    JOIN public.budget_cost_types AS cost_type ON cost_type.id = child."costTypeId"
    WHERE child."organizationId" IS DISTINCT FROM cost_type."organizationId"
  ) OR EXISTS (
    SELECT 1 FROM public.budget_actuals AS child
    JOIN public.budget_cost_types AS cost_type ON cost_type.id = child."costTypeId"
    WHERE child."organizationId" IS DISTINCT FROM cost_type."organizationId"
  ) OR EXISTS (
    SELECT 1 FROM public.budget_forecast_entries AS child
    JOIN public.budget_cost_types AS cost_type ON cost_type.id = child."costTypeId"
    WHERE child."organizationId" IS DISTINCT FROM cost_type."organizationId"
  ) OR EXISTS (
    SELECT 1 FROM public.budget_direction_templates AS child
    JOIN public.budget_cost_types AS cost_type ON cost_type.id = child."costTypeId"
    WHERE child."organizationId" IS DISTINCT FROM cost_type."organizationId"
  ) OR EXISTS (
    SELECT 1 FROM public.expense_forecasts AS child
    JOIN public.budget_cost_types AS cost_type ON cost_type.id = child."costTypeId"
    WHERE child."organizationId" IS DISTINCT FROM cost_type."organizationId"
  ) THEN
    RAISE EXCEPTION 'budget cost type preflight: cross-organization references exist'
      USING ERRCODE = 'check_violation';
  END IF;

  IF to_regprocedure('public.guard_budget_cost_type_reference_write()') IS NOT NULL
  OR to_regprocedure('public.guard_budget_cost_type_reassignment()') IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname IN (
      'budget_line_cost_type_guard_trg',
      'budget_actual_cost_type_guard_trg',
      'budget_forecast_entry_cost_type_guard_trg',
      'budget_direction_template_cost_type_guard_trg',
      'expense_forecast_cost_type_guard_trg',
      'budget_cost_type_reassignment_guard_trg'
    )
  ) THEN
    RAISE EXCEPTION 'budget cost type preflight: guards already exist'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.guard_budget_cost_type_reference_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  cost_type_organization_id text;
BEGIN
  IF NEW."costTypeId" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."costTypeId", 1));

  SELECT cost_type."organizationId"
  INTO cost_type_organization_id
  FROM public.budget_cost_types AS cost_type
  WHERE cost_type.id = NEW."costTypeId";

  IF cost_type_organization_id IS NULL
  OR cost_type_organization_id IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'budget cost type reference must belong to the same organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_budget_cost_type_reference_write() FROM PUBLIC;

CREATE TRIGGER budget_line_cost_type_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "costTypeId" ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_cost_type_reference_write();
CREATE TRIGGER budget_actual_cost_type_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "costTypeId" ON public.budget_actuals
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_cost_type_reference_write();
CREATE TRIGGER budget_forecast_entry_cost_type_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "costTypeId" ON public.budget_forecast_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_cost_type_reference_write();
CREATE TRIGGER budget_direction_template_cost_type_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "costTypeId" ON public.budget_direction_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_cost_type_reference_write();
CREATE TRIGGER expense_forecast_cost_type_guard_trg
  BEFORE INSERT OR UPDATE OF "organizationId", "costTypeId" ON public.expense_forecasts
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_cost_type_reference_write();

CREATE FUNCTION public.guard_budget_cost_type_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.id, 1));

  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
  AND (
    EXISTS (SELECT 1 FROM public.budget_lines WHERE "costTypeId" = OLD.id)
    OR EXISTS (SELECT 1 FROM public.budget_actuals WHERE "costTypeId" = OLD.id)
    OR EXISTS (SELECT 1 FROM public.budget_forecast_entries WHERE "costTypeId" = OLD.id)
    OR EXISTS (SELECT 1 FROM public.budget_direction_templates WHERE "costTypeId" = OLD.id)
    OR EXISTS (SELECT 1 FROM public.expense_forecasts WHERE "costTypeId" = OLD.id)
  ) THEN
    RAISE EXCEPTION 'referenced budget cost type cannot move across organizations'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_budget_cost_type_reassignment() FROM PUBLIC;

CREATE TRIGGER budget_cost_type_reassignment_guard_trg
  BEFORE UPDATE OF "organizationId" ON public.budget_cost_types
  FOR EACH ROW EXECUTE FUNCTION public.guard_budget_cost_type_reassignment();

DROP POLICY tenant_isolation ON public.budget_cost_types;
CREATE POLICY tenant_select ON public.budget_cost_types
  FOR SELECT
  USING ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_insert ON public.budget_cost_types
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_update ON public.budget_cost_types
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
      AND tablename = 'budget_cost_types'
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
        AND actual.tablename = 'budget_cost_types'
        AND actual.policyname = expected.policyname
        AND actual.cmd = expected.cmd
    ) <> 1
  ) OR EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_cost_types'
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
      AND pg_class.relname = 'budget_cost_types'
      AND pg_class.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'budget cost type postcondition: policy mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO guard_count
  FROM pg_trigger
  JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
  WHERE pg_trigger.tgname IN (
    'budget_line_cost_type_guard_trg',
    'budget_actual_cost_type_guard_trg',
    'budget_forecast_entry_cost_type_guard_trg',
    'budget_direction_template_cost_type_guard_trg',
    'expense_forecast_cost_type_guard_trg',
    'budget_cost_type_reassignment_guard_trg'
  )
    AND NOT pg_trigger.tgisinternal
    AND pg_trigger.tgenabled = 'O'
    AND pg_proc.prosecdef
    AND pg_proc.proconfig = ARRAY['search_path=pg_catalog, public'];

  IF guard_count <> 6 THEN
    RAISE EXCEPTION 'budget cost type postcondition: guard mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$postcondition$;

COMMIT;
