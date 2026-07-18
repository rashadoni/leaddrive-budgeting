-- AI token usage RLS/accounting guards. Candidate only; production application
-- needs separate owner approval after isolated PostgreSQL gates.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_token_usage'
      AND policyname = 'tenant_isolation'
      AND cmd = 'ALL'
      AND qual LIKE '%"organizationId"%app.organization_id%'
      AND qual LIKE '%app.bypass_rls%'
      AND with_check IS NULL
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_token_usage'
  ) <> 1 THEN
    RAISE EXCEPTION 'AI token usage preflight: unexpected policy'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ai_token_usage
    WHERE "tokensIn" < 0 OR "tokensOut" < 0 OR calls < 0
  ) THEN
    RAISE EXCEPTION 'AI token usage preflight: negative counters exist'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_token_usage'::regclass
      AND conname = 'ai_token_usage_nonnegative_counters_check'
  ) THEN
    RAISE EXCEPTION 'AI token usage preflight: counter guard already exists'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$preflight$;

ALTER TABLE public.ai_token_usage
  ADD CONSTRAINT ai_token_usage_nonnegative_counters_check
  CHECK ("tokensIn" >= 0 AND "tokensOut" >= 0 AND calls >= 0);

DROP POLICY tenant_isolation ON public.ai_token_usage;
CREATE POLICY tenant_select ON public.ai_token_usage
  FOR SELECT
  USING ("organizationId" = current_setting('app.organization_id', true));

DO $postcondition$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_token_usage'
      AND policyname = 'tenant_select'
      AND cmd = 'SELECT'
      AND qual LIKE '%"organizationId"%app.organization_id%'
      AND qual NOT LIKE '%app.bypass_rls%'
      AND with_check IS NULL
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_token_usage'
  ) <> 1 THEN
    RAISE EXCEPTION 'AI token usage postcondition: policy mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_token_usage'::regclass
      AND conname = 'ai_token_usage_nonnegative_counters_check'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'AI token usage postcondition: counter guard mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$postcondition$;

COMMIT;
