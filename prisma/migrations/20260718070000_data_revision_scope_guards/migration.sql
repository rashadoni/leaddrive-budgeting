-- Phase 10 / Stage B2 — DataRevision tenant-scope hardening.
--
-- Candidate only: this migration is intentionally checked in but MUST NOT be
-- applied to a shared/production database without the isolated live-RLS gate
-- in src/lib/risk/data-revision.rls.integration.test.ts.
--
-- Scope is deliberately narrow:
--   1. supersedesId must point to a revision in the same organization;
--   2. data_revisions no longer trusts the user-settable app.bypass_rls GUC.
--
-- Direct DELETE retention and lifecycle timestamp transitions are NOT changed:
-- their intended owner-approved semantics are still open. The remaining
-- app.bypass_rls clauses on other tenant tables require a separate systemic
-- migration that preserves each table's special policy shape.

-- Fail before installing the guard if legacy/direct SQL already created an
-- invalid cross-tenant chain. Silently accepting it would preserve false
-- provenance under a stronger-looking constraint.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "data_revisions" AS child
    JOIN "data_revisions" AS predecessor
      ON predecessor."id" = child."supersedesId"
    WHERE child."id" = child."supersedesId"
       OR child."organizationId" IS DISTINCT FROM predecessor."organizationId"
  ) THEN
    RAISE EXCEPTION 'data_revisions contains self or cross-organization supersession links; repair before applying scope guard'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- The id-only self-FK proves existence, but not tenant ownership. A trigger is
-- used instead of a composite Prisma relation because ON DELETE SET NULL must
-- clear supersedesId without attempting to null the required organizationId.
-- The referenced revision's organization is immutable, so the insert-time
-- check remains true for the lifetime of both rows.
CREATE OR REPLACE FUNCTION data_revisions_enforce_supersedes_org()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."supersedesId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."supersedesId" = NEW."id" THEN
    RAISE EXCEPTION 'data_revisions cannot supersede itself'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."data_revisions" AS predecessor
    WHERE predecessor."id" = NEW."supersedesId"
      AND predecessor."organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'data_revisions supersedesId must reference the same organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_revisions_supersedes_org_guard ON "data_revisions";
CREATE TRIGGER data_revisions_supersedes_org_guard
  BEFORE INSERT OR UPDATE OF "supersedesId", "organizationId"
  ON "data_revisions"
  FOR EACH ROW
  EXECUTE FUNCTION data_revisions_enforce_supersedes_org();

-- Native PostgreSQL role attributes are the only bypass: the dedicated admin
-- connection uses a BYPASSRLS role. A regular app role may SET any custom GUC,
-- so app.bypass_rls must never grant access. Separate policies intentionally
-- omit DELETE: app traffic can read/create/update lifecycle state but cannot
-- erase evidence. Native BYPASSRLS admin retains the Organization cascade and
-- documented break-glass/tenant-erasure path.
DROP POLICY IF EXISTS tenant_isolation ON "data_revisions";
DROP POLICY IF EXISTS tenant_select ON "data_revisions";
DROP POLICY IF EXISTS tenant_insert ON "data_revisions";
DROP POLICY IF EXISTS tenant_update ON "data_revisions";

-- Keep the canonical policy name for the SELECT half so existing catalog
-- monitoring that counts tenant_isolation policies does not drift.
CREATE POLICY tenant_isolation ON "data_revisions"
  FOR SELECT
  USING (
    "organizationId" = current_setting('app.organization_id', true)
  );

CREATE POLICY tenant_insert ON "data_revisions"
  FOR INSERT
  WITH CHECK (
    "organizationId" = current_setting('app.organization_id', true)
  );

CREATE POLICY tenant_update ON "data_revisions"
  FOR UPDATE
  USING (
    "organizationId" = current_setting('app.organization_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.organization_id', true)
  );

-- Table-level DELETE is also revoked by scripts/sql/create-app-role.sql when
-- roles are provisioned by a superuser. It is deliberately not revoked here:
-- the migration role may be allowed DDL without being the grantor of
-- budgetpro_app's privileges, and a grantor mismatch must not break deploy.
