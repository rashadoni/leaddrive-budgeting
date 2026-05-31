-- Phase 7.J — Counterparty register
CREATE TABLE "counterparties" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sharePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "annualAmount" DOUBLE PRECISION,
  "contractExpiry" TIMESTAMP(3),
  "paymentTermsDays" INTEGER,
  "singleSource" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "period" TEXT NOT NULL DEFAULT '2026',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "counterparties_companyId_role_name_period_key"
  ON "counterparties"("companyId", "role", "name", "period");
CREATE INDEX "counterparties_organizationId_idx" ON "counterparties"("organizationId");
CREATE INDEX "counterparties_companyId_role_idx" ON "counterparties"("companyId", "role");
CREATE INDEX "counterparties_role_sharePct_idx" ON "counterparties"("role", "sharePct");
ALTER TABLE "counterparties"
  ADD CONSTRAINT "counterparties_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "counterparties"
  ADD CONSTRAINT "counterparties_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
