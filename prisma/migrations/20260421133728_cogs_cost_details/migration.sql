-- CreateTable
CREATE TABLE "cogs_cost_details" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "productLineId" TEXT NOT NULL,
    "costType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "accountCode" TEXT,
    "stage" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantity" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cogs_cost_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cogs_cost_details_organizationId_idx" ON "cogs_cost_details"("organizationId");

-- CreateIndex
CREATE INDEX "cogs_cost_details_planId_idx" ON "cogs_cost_details"("planId");

-- CreateIndex
CREATE INDEX "cogs_cost_details_productLineId_idx" ON "cogs_cost_details"("productLineId");

-- AddForeignKey
ALTER TABLE "cogs_cost_details" ADD CONSTRAINT "cogs_cost_details_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cogs_cost_details" ADD CONSTRAINT "cogs_cost_details_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cogs_cost_details" ADD CONSTRAINT "cogs_cost_details_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES "product_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
