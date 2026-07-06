-- CreateEnum
CREATE TYPE "TradeCampaignStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'paused', 'completed', 'cancelled');

-- AlterEnum
ALTER TYPE "ApprovalRequestType" ADD VALUE 'trade_campaign_activate';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'trade_campaign_review';

-- CreateTable
CREATE TABLE "trade_campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "TradeCampaignStatus" NOT NULL DEFAULT 'draft',
    "plannedBudgetAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedSalesUpliftAmount" DOUBLE PRECISION,
    "expectedSalesUpliftPct" DOUBLE PRECISION,
    "approvalRequestId" TEXT,
    "ownerUserId" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'AZN',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "trade_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_campaign_scopes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "scopeValue" TEXT,
    "include" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_campaign_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_campaigns_organizationId_status_startDate_endDate_idx" ON "trade_campaigns"("organizationId", "status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "trade_campaigns_organizationId_deletedAt_idx" ON "trade_campaigns"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trade_campaigns_organizationId_code_key" ON "trade_campaigns"("organizationId", "code");

-- CreateIndex
CREATE INDEX "trade_campaign_scopes_organizationId_campaignId_idx" ON "trade_campaign_scopes"("organizationId", "campaignId");

-- AddForeignKey
ALTER TABLE "trade_campaign_scopes" ADD CONSTRAINT "trade_campaign_scopes_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "trade_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
