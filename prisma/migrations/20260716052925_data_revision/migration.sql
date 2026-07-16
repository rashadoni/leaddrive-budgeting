-- CreateEnum
CREATE TYPE "RevisionReason" AS ENUM ('import', 'correction', 'mapping_change', 'late_adjustment', 'external_refresh', 'manual_override');

-- CreateTable
CREATE TABLE "data_revisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyIds" TEXT[],
    "sourceArtifactIds" TEXT[],
    "mappingVersionIds" TEXT[],
    "periodFrom" TEXT NOT NULL,
    "periodTo" TEXT NOT NULL,
    "reason" "RevisionReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "supersedesId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "data_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_revisions_supersedesId_key" ON "data_revisions"("supersedesId");

-- CreateIndex
CREATE INDEX "data_revisions_organizationId_createdAt_idx" ON "data_revisions"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "data_revisions_organizationId_periodFrom_periodTo_idx" ON "data_revisions"("organizationId", "periodFrom", "periodTo");

-- CreateIndex
CREATE UNIQUE INDEX "data_revisions_organizationId_contentHash_key" ON "data_revisions"("organizationId", "contentHash");

-- AddForeignKey
ALTER TABLE "data_revisions" ADD CONSTRAINT "data_revisions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_revisions" ADD CONSTRAINT "data_revisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_revisions" ADD CONSTRAINT "data_revisions_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "data_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Phase 10 / Stage B2 — org isolation + immutability, in the SAME migration
-- that creates the table. There must be no window in which data_revisions
-- exists without RLS.
-- ---------------------------------------------------------------------------

-- Tenant isolation. Policy body copied verbatim from the baseline pattern
-- (see 20260706183514_rls_trade_tables). `current_setting(..., true)` returns
-- NULL when app.organization_id is unset, and `"organizationId" = NULL` is
-- NULL rather than TRUE — so a missing org context denies by default. With
-- FOR ALL and no explicit WITH CHECK, Postgres applies USING to writes too,
-- so a cross-org INSERT is rejected by the same expression.
ALTER TABLE "data_revisions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "data_revisions";
CREATE POLICY tenant_isolation ON "data_revisions" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

-- Immutability (03-DATA-KPI-TRUST-SPEC §5.2, ADR Trust Core §4).
--
-- A revision pins a source state; it is superseded, never edited. The pinned
-- columns are therefore rejected on UPDATE at the database, not by convention.
-- Mutable by design: lockedAt / reconciledAt / approvedAt, because §5.1
-- requires the revision to carry lock/reconciliation/approval state.
--
-- Two columns need a narrower rule than "never changes". Both `createdById`
-- and `supersedesId` are ON DELETE SET NULL, and Postgres implements that as
-- an UPDATE — a blanket ban would make deleting a User (or a superseded
-- revision) fail outright. They may therefore transition to NULL, which is
-- what the cascade does, but never to a different value: provenance can be
-- forgotten when its subject is deleted, never rewritten to point elsewhere.
CREATE OR REPLACE FUNCTION data_revisions_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."companyIds" IS DISTINCT FROM OLD."companyIds"
     OR NEW."sourceArtifactIds" IS DISTINCT FROM OLD."sourceArtifactIds"
     OR NEW."mappingVersionIds" IS DISTINCT FROM OLD."mappingVersionIds"
     OR NEW."periodFrom" IS DISTINCT FROM OLD."periodFrom"
     OR NEW."periodTo" IS DISTINCT FROM OLD."periodTo"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
     OR (NEW."createdById" IS DISTINCT FROM OLD."createdById"
         AND NEW."createdById" IS NOT NULL)
     OR (NEW."supersedesId" IS DISTINCT FROM OLD."supersedesId"
         AND NEW."supersedesId" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'data_revisions is immutable: the pinned source state of revision % cannot be updated; create a superseding revision instead', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_revisions_immutable ON "data_revisions";
CREATE TRIGGER data_revisions_immutable
  BEFORE UPDATE ON "data_revisions"
  FOR EACH ROW
  EXECUTE FUNCTION data_revisions_reject_mutation();
