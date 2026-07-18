-- Budget direction template tenant and organization guards. Candidate only;
-- production application needs separate owner approval after isolated gates.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Stabilize the orphan/reference checks and the two predecessor guards while
-- adding the missing tenant-parent FK and replacing only this table's policy.
LOCK TABLE public."Organization",
  public.budget_departments,
  public.budget_cost_types,
  public.budget_direction_templates
  IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  guard_count integer;
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_direction_templates'
      AND policyname = 'tenant_isolation'
      AND cmd = 'ALL'
      AND qual LIKE '%"organizationId"%app.organization_id%'
      AND qual LIKE '%app.bypass_rls%'
      AND with_check IS NULL
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_direction_templates'
  ) <> 1 THEN
    RAISE EXCEPTION 'budget direction template preflight: unexpected policy'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('budget_direction_templates_departmentId_fkey', 'public.budget_departments'::regclass, 'n'),
      ('budget_direction_templates_costTypeId_fkey', 'public.budget_cost_types'::regclass, 'n')
    ) AS expected(constraint_name, parent_table, delete_action)
    WHERE (
      SELECT count(*)
      FROM pg_constraint AS actual
      WHERE actual.conname = expected.constraint_name
        AND actual.conrelid = 'public.budget_direction_templates'::regclass
        AND actual.confrelid = expected.parent_table
        AND actual.contype = 'f'
        AND actual.confupdtype = 'c'
        AND actual.confdeltype = expected.delete_action::"char"
    ) <> 1
  ) OR EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.budget_direction_templates'::regclass
      AND conname = 'budget_direction_templates_organizationId_fkey'
  ) THEN
    RAISE EXCEPTION 'budget direction template preflight: unexpected foreign keys'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.budget_direction_templates AS template
    LEFT JOIN public."Organization" AS organization
      ON organization.id = template."organizationId"
    LEFT JOIN public.budget_departments AS department
      ON department.id = template."departmentId"
    LEFT JOIN public.budget_cost_types AS cost_type
      ON cost_type.id = template."costTypeId"
    WHERE organization.id IS NULL
       OR (template."departmentId" IS NOT NULL AND (
         department.id IS NULL
         OR department."organizationId" IS DISTINCT FROM template."organizationId"
       ))
       OR (template."costTypeId" IS NOT NULL AND (
         cost_type.id IS NULL
         OR cost_type."organizationId" IS DISTINCT FROM template."organizationId"
       ))
  ) THEN
    RAISE EXCEPTION 'budget direction template preflight: orphan or cross-organization references exist'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO guard_count
  FROM pg_trigger
  JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
  WHERE pg_trigger.tgrelid = 'public.budget_direction_templates'::regclass
    AND pg_trigger.tgname IN (
      'budget_direction_template_department_guard_trg',
      'budget_direction_template_cost_type_guard_trg'
    )
    AND NOT pg_trigger.tgisinternal
    AND pg_trigger.tgenabled = 'O'
    AND pg_proc.prosecdef
    AND pg_proc.proconfig = ARRAY['search_path=pg_catalog, public'];

  IF guard_count <> 2 THEN
    RAISE EXCEPTION 'budget direction template preflight: predecessor guards missing'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$preflight$;

ALTER TABLE public.budget_direction_templates
  ADD CONSTRAINT "budget_direction_templates_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

DROP POLICY tenant_isolation ON public.budget_direction_templates;
CREATE POLICY tenant_select ON public.budget_direction_templates
  FOR SELECT
  USING ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_insert ON public.budget_direction_templates
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_update ON public.budget_direction_templates
  FOR UPDATE
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_delete ON public.budget_direction_templates
  FOR DELETE
  USING ("organizationId" = current_setting('app.organization_id', true));

DO $postcondition$
DECLARE
  guard_count integer;
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_direction_templates'
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
        AND actual.tablename = 'budget_direction_templates'
        AND actual.policyname = expected.policyname
        AND actual.cmd = expected.cmd
    ) <> 1
  ) OR EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_direction_templates'
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
      AND pg_class.relname = 'budget_direction_templates'
      AND pg_class.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'budget direction template postcondition: policy mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'public.budget_direction_templates'::regclass
      AND conname = 'budget_direction_templates_organizationId_fkey'
      AND confrelid = 'public."Organization"'::regclass
      AND contype = 'f'
      AND confupdtype = 'c'
      AND confdeltype = 'c'
      AND convalidated
  ) <> 1 THEN
    RAISE EXCEPTION 'budget direction template postcondition: organization FK mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO guard_count
  FROM pg_trigger
  JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
  WHERE pg_trigger.tgrelid = 'public.budget_direction_templates'::regclass
    AND pg_trigger.tgname IN (
      'budget_direction_template_department_guard_trg',
      'budget_direction_template_cost_type_guard_trg'
    )
    AND NOT pg_trigger.tgisinternal
    AND pg_trigger.tgenabled = 'O'
    AND pg_proc.prosecdef
    AND pg_proc.proconfig = ARRAY['search_path=pg_catalog, public'];

  IF guard_count <> 2 THEN
    RAISE EXCEPTION 'budget direction template postcondition: guard mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$postcondition$;

COMMIT;
