-- CreateEnum
CREATE TYPE "TradeRiskStatus" AS ENUM ('ok', 'watch', 'high', 'critical');

-- CreateTable
CREATE TABLE "trade_plan_daily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "grainKey" TEXT NOT NULL,
    "plannedSalesAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedTradeBudgetAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "workingDayWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_plan_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_pacing_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "grainKey" TEXT NOT NULL,
    "campaignId" TEXT,
    "salesPlanMtd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salesActualMtd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "budgetMonth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "controlSpendMtd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accruedSpendMtd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualSpendMtd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "forecastSalesMonth" DOUBLE PRECISION,
    "forecastSpendMonth" DOUBLE PRECISION,
    "forecastBudgetVariance" DOUBLE PRECISION,
    "forecastSalesGap" DOUBLE PRECISION,
    "riskStatus" "TradeRiskStatus" NOT NULL,
    "math" JSONB NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_pacing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_plan_daily_organizationId_year_month_idx" ON "trade_plan_daily"("organizationId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "trade_plan_daily_organizationId_date_grainKey_key" ON "trade_plan_daily"("organizationId", "date", "grainKey");

-- CreateIndex
CREATE INDEX "trade_pacing_snapshots_organizationId_period_riskStatus_idx" ON "trade_pacing_snapshots"("organizationId", "period", "riskStatus");

-- CreateIndex
CREATE UNIQUE INDEX "trade_pacing_snapshots_organizationId_asOfDate_period_grain_key" ON "trade_pacing_snapshots"("organizationId", "asOfDate", "period", "grainKey");
