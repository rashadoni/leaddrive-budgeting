-- Trade spend ledger RLS and append-only guards. Candidate only; production
-- application needs separate owner approval after isolated PostgreSQL gates.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trade_spend_ledger'
      AND policyname = 'tenant_isolation'
      AND cmd = 'ALL'
      AND qual LIKE '%"organizationId"%app.organization_id%'
      AND qual LIKE '%app.bypass_rls%'
      AND with_check IS NULL
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trade_spend_ledger'
  ) <> 1 THEN
    RAISE EXCEPTION 'trade spend ledger preflight: unexpected policy'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.trade_spend_ledger
    WHERE ("voidedAt" IS NULL) <> ("voidedBy" IS NULL)
  ) THEN
    RAISE EXCEPTION 'trade spend ledger preflight: partial void rows exist'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.trade_spend_ledger AS ledger
    LEFT JOIN public."Organization" AS organization
      ON organization.id = ledger."organizationId"
    WHERE organization.id IS NULL
  ) THEN
    RAISE EXCEPTION 'trade spend ledger preflight: orphan organization rows exist'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.trade_spend_ledger AS ledger
    JOIN public.trade_spend_types AS spend_type
      ON spend_type.id = ledger."spendTypeId"
    WHERE spend_type."organizationId" IS DISTINCT FROM ledger."organizationId"
  ) THEN
    RAISE EXCEPTION 'trade spend ledger preflight: cross-organization spend types exist'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_spend_ledger_organizationId_fkey'
      AND conrelid = 'public.trade_spend_ledger'::regclass
  )
  OR to_regprocedure('public.guard_trade_spend_ledger_write()') IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.trade_spend_ledger'::regclass
      AND tgname = 'trade_spend_ledger_write_guard_trg'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trade spend ledger preflight: guards already exist'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$preflight$;

ALTER TABLE public.trade_spend_ledger
  ADD CONSTRAINT "trade_spend_ledger_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES public."Organization"(id)
  ON DELETE CASCADE
  ON UPDATE RESTRICT;

CREATE FUNCTION public.guard_trade_spend_ledger_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  spend_type_organization_id text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."voidedAt" IS NOT NULL OR NEW."voidedBy" IS NOT NULL THEN
      RAISE EXCEPTION 'trade spend ledger entries must be created unvoided'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - 'voidedAt' - 'voidedBy') IS DISTINCT FROM
       (to_jsonb(OLD) - 'voidedAt' - 'voidedBy')
    OR OLD."voidedAt" IS NOT NULL
    OR OLD."voidedBy" IS NOT NULL
    OR NEW."voidedAt" IS NULL
    OR NEW."voidedBy" IS NULL THEN
      RAISE EXCEPTION 'trade spend ledger permits only a one-way void transition'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  SELECT spend_type."organizationId"
  INTO spend_type_organization_id
  FROM public.trade_spend_types AS spend_type
  WHERE spend_type.id = NEW."spendTypeId";

  IF spend_type_organization_id IS NULL
  OR spend_type_organization_id IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'trade spend type must belong to the same organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_trade_spend_ledger_write() FROM PUBLIC;

CREATE TRIGGER trade_spend_ledger_write_guard_trg
  BEFORE INSERT OR UPDATE ON public.trade_spend_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_trade_spend_ledger_write();

DROP POLICY tenant_isolation ON public.trade_spend_ledger;
CREATE POLICY tenant_select ON public.trade_spend_ledger
  FOR SELECT
  USING ("organizationId" = current_setting('app.organization_id', true));
CREATE POLICY tenant_insert ON public.trade_spend_ledger
  FOR INSERT
  WITH CHECK (
    "organizationId" = current_setting('app.organization_id', true)
    AND "voidedAt" IS NULL
    AND "voidedBy" IS NULL
  );
CREATE POLICY tenant_void ON public.trade_spend_ledger
  FOR UPDATE
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    AND "voidedAt" IS NULL
    AND "voidedBy" IS NULL
  )
  WITH CHECK (
    "organizationId" = current_setting('app.organization_id', true)
    AND "voidedAt" IS NOT NULL
    AND "voidedBy" IS NOT NULL
  );

DO $postcondition$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trade_spend_ledger'
  ) <> 3 OR EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trade_spend_ledger'
      AND (
        coalesce(qual, '') LIKE '%app.bypass_rls%'
        OR coalesce(with_check, '') LIKE '%app.bypass_rls%'
        OR cmd NOT IN ('SELECT', 'INSERT', 'UPDATE')
      )
  ) THEN
    RAISE EXCEPTION 'trade spend ledger postcondition: policy mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_spend_ledger_organizationId_fkey'
      AND conrelid = 'public.trade_spend_ledger'::regclass
      AND confrelid = 'public."Organization"'::regclass
      AND confdeltype = 'c'
      AND confupdtype = 'r'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.trade_spend_ledger'::regclass
      AND tgname = 'trade_spend_ledger_write_guard_trg'
      AND NOT tgisinternal
      AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'trade spend ledger postcondition: guard mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$postcondition$;

COMMIT;
