-- CreateTable
CREATE TABLE "trade_budget_pools" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "grainKey" TEXT NOT NULL DEFAULT 'org',
    "salesPlanAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "budgetPct" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "budgetAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isManualAmount" BOOLEAN NOT NULL DEFAULT false,
    "currencyCode" TEXT NOT NULL DEFAULT 'AZN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_budget_pools_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_budget_pools_organizationId_year_idx" ON "trade_budget_pools"("organizationId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "trade_budget_pools_organizationId_year_month_grainKey_key" ON "trade_budget_pools"("organizationId", "year", "month", "grainKey");


-- RLS tenant isolation (same policy as the 2026-07-06 trade_* batch).
ALTER TABLE "trade_budget_pools" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_budget_pools";
CREATE POLICY tenant_isolation ON "trade_budget_pools" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));
