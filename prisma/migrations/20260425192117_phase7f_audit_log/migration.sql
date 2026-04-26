-- Phase 7.F (Turn 11): audit log of high-business-impact writes on the
-- holding tree. New table is purely additive — no existing data touched.
-- Retention policy is 365 days (enforced by future Phase 6 cron, not in
-- this migration; until then the table grows monotonically).

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM (
  'company_role_change',
  'budget_plan_create',
  'budget_plan_approve',
  'import_budget_create',
  'import_staging_apply',
  'import_staging_expired',
  'indicator_override_create',
  'indicator_override_update',
  'indicator_override_delete'
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_organizationId_createdAt_idx"
  ON "audit_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_organizationId_entityType_entityId_idx"
  ON "audit_events"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_organizationId_action_createdAt_idx"
  ON "audit_events"("organizationId", "action", "createdAt");

-- AddForeignKey (Organization model has no @@map; lives at PascalCase
-- table name unlike most other Phase 0-6 models)
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
