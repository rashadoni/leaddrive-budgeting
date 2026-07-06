-- CreateEnum
CREATE TYPE "TradeSpendEntryKind" AS ENUM ('plan', 'accrued', 'actual');

-- CreateTable
CREATE TABLE "trade_spend_ledger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryKind" "TradeSpendEntryKind" NOT NULL,
    "spendTypeId" TEXT NOT NULL,
    "campaignId" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'AZN',
    "regionId" TEXT,
    "channelId" TEXT,
    "salesRepId" TEXT,
    "outletId" TEXT,
    "skuId" TEXT,
    "sourceDocument" TEXT,
    "entryGroupKey" TEXT,
    "importBatchId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,

    CONSTRAINT "trade_spend_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_spend_ledger_organizationId_year_month_entryKind_idx" ON "trade_spend_ledger"("organizationId", "year", "month", "entryKind");

-- CreateIndex
CREATE INDEX "trade_spend_ledger_organizationId_spendTypeId_entryDate_idx" ON "trade_spend_ledger"("organizationId", "spendTypeId", "entryDate");

-- CreateIndex
CREATE INDEX "trade_spend_ledger_organizationId_campaignId_idx" ON "trade_spend_ledger"("organizationId", "campaignId");

-- AddForeignKey
ALTER TABLE "trade_spend_ledger" ADD CONSTRAINT "trade_spend_ledger_spendTypeId_fkey" FOREIGN KEY ("spendTypeId") REFERENCES "trade_spend_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RLS tenant isolation (same policy as the 2026-07-06 trade_* batch).
ALTER TABLE "trade_spend_ledger" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_spend_ledger";
CREATE POLICY tenant_isolation ON "trade_spend_ledger" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));
