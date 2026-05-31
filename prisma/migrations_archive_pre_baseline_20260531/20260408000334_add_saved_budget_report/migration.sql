-- CreateTable
CREATE TABLE "saved_budget_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdBy" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT NOT NULL,
    "planId" TEXT,
    "columns" JSONB NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '[]',
    "groupBy" TEXT,
    "periodGroupBy" TEXT,
    "sortBy" TEXT,
    "sortOrder" TEXT NOT NULL DEFAULT 'desc',
    "chartType" TEXT NOT NULL DEFAULT 'table',
    "chartConfig" JSONB,
    "computedFields" JSONB,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_budget_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_budget_reports_organizationId_idx" ON "saved_budget_reports"("organizationId");

-- CreateIndex
CREATE INDEX "saved_budget_reports_organizationId_planId_idx" ON "saved_budget_reports"("organizationId", "planId");
