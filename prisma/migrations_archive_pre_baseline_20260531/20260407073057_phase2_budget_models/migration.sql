-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAz" TEXT,
    "nameRu" TEXT,
    "nameEn" TEXT,
    "parentCode" TEXT,
    "accountType" TEXT NOT NULL,
    "category" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "revenueAccountCode" TEXT,
    "cogsAccountCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_budget_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "productLineId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_components" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productLineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "consumptionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cogs_budget_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "productLineId" TEXT NOT NULL,
    "accountCode" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "productionQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cogs_budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_sheet_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "lineType" TEXT NOT NULL,
    "subType" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balance_sheet_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_assumptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "period" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_assumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chart_of_accounts_organizationId_idx" ON "chart_of_accounts"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_organizationId_code_key" ON "chart_of_accounts"("organizationId", "code");

-- CreateIndex
CREATE INDEX "product_lines_organizationId_idx" ON "product_lines"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "product_lines_organizationId_code_key" ON "product_lines"("organizationId", "code");

-- CreateIndex
CREATE INDEX "sales_budget_lines_organizationId_idx" ON "sales_budget_lines"("organizationId");

-- CreateIndex
CREATE INDEX "sales_budget_lines_planId_idx" ON "sales_budget_lines"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_budget_lines_planId_productLineId_year_month_key" ON "sales_budget_lines"("planId", "productLineId", "year", "month");

-- CreateIndex
CREATE INDEX "cost_components_organizationId_idx" ON "cost_components"("organizationId");

-- CreateIndex
CREATE INDEX "cost_components_productLineId_idx" ON "cost_components"("productLineId");

-- CreateIndex
CREATE INDEX "cogs_budget_lines_organizationId_idx" ON "cogs_budget_lines"("organizationId");

-- CreateIndex
CREATE INDEX "cogs_budget_lines_planId_idx" ON "cogs_budget_lines"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "cogs_budget_lines_planId_productLineId_year_month_key" ON "cogs_budget_lines"("planId", "productLineId", "year", "month");

-- CreateIndex
CREATE INDEX "balance_sheet_lines_organizationId_idx" ON "balance_sheet_lines"("organizationId");

-- CreateIndex
CREATE INDEX "balance_sheet_lines_planId_idx" ON "balance_sheet_lines"("planId");

-- CreateIndex
CREATE INDEX "balance_sheet_lines_planId_year_month_idx" ON "balance_sheet_lines"("planId", "year", "month");

-- CreateIndex
CREATE INDEX "budget_assumptions_organizationId_idx" ON "budget_assumptions"("organizationId");

-- CreateIndex
CREATE INDEX "budget_assumptions_planId_idx" ON "budget_assumptions"("planId");

-- CreateIndex
CREATE INDEX "budget_assumptions_planId_category_idx" ON "budget_assumptions"("planId", "category");

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lines" ADD CONSTRAINT "product_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_budget_lines" ADD CONSTRAINT "sales_budget_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_budget_lines" ADD CONSTRAINT "sales_budget_lines_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_budget_lines" ADD CONSTRAINT "sales_budget_lines_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES "product_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES "product_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cogs_budget_lines" ADD CONSTRAINT "cogs_budget_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cogs_budget_lines" ADD CONSTRAINT "cogs_budget_lines_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cogs_budget_lines" ADD CONSTRAINT "cogs_budget_lines_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES "product_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_sheet_lines" ADD CONSTRAINT "balance_sheet_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_sheet_lines" ADD CONSTRAINT "balance_sheet_lines_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_assumptions" ADD CONSTRAINT "budget_assumptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_assumptions" ADD CONSTRAINT "budget_assumptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
