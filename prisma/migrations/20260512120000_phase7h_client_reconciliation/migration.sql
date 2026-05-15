-- Phase 7.H Feature 5 — client-reported reconciliation values.
-- Stores a parallel reference number per (company × period × indicatorKey)
-- so the P&L screen + future surfaces can show variance vs system EBITDA
-- without the recompute pipeline touching anything.

-- 1. Audit enum extension (idempotent — ALTER TYPE ADD VALUE doesn't support
--    IF NOT EXISTS in all PG versions).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'AuditAction' AND e.enumlabel = 'client_reconciliation_submit'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'client_reconciliation_submit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'AuditAction' AND e.enumlabel = 'client_reconciliation_delete'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'client_reconciliation_delete';
  END IF;
END$$;

-- 2. CreateTable
CREATE TABLE "client_reconciliations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "indicatorKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "note" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_reconciliations_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes
CREATE UNIQUE INDEX "client_reconciliations_companyId_period_indicatorKey_key"
    ON "client_reconciliations"("companyId", "period", "indicatorKey");

CREATE INDEX "client_reconciliations_organizationId_companyId_period_idx"
    ON "client_reconciliations"("organizationId", "companyId", "period");

-- 4. Foreign keys
ALTER TABLE "client_reconciliations"
    ADD CONSTRAINT "client_reconciliations_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
