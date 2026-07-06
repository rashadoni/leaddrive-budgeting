-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "domain" TEXT NOT NULL DEFAULT 'risk',
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "alerts_organizationId_domain_resolvedAt_idx" ON "alerts"("organizationId", "domain", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_organizationId_dedupeKey_key" ON "alerts"("organizationId", "dedupeKey");

