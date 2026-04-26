-- AlterTable
ALTER TABLE "budget_lines" ADD COLUMN     "companyId" TEXT;

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentCompanyId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAz" TEXT,
    "nameRu" TEXT,
    "nameEn" TEXT,
    "industry" TEXT,
    "level" INTEGER NOT NULL DEFAULT 2,
    "country" TEXT,
    "baseCurrencyCode" TEXT,
    "settings" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industries" (
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAz" TEXT,
    "nameRu" TEXT,
    "category" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "indicator_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAz" TEXT,
    "nameRu" TEXT,
    "category" TEXT NOT NULL,
    "industries" TEXT[],
    "unit" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "sparklineFormula" TEXT,
    "thresholds" JSONB NOT NULL,
    "hintTemplateEn" TEXT,
    "hintTemplateAz" TEXT,
    "hintTemplateRu" TEXT,
    "requiredInputs" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indicator_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_indicators" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "customThreshold" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_values" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "sparkline" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicator_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "arrivalDate" TIMESTAMP(3) NOT NULL,
    "departureDate" TIMESTAMP(3) NOT NULL,
    "nights" INTEGER NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,
    "currencyCode" TEXT,
    "exchangeRate" DOUBLE PRECISION,
    "sourceCountry" TEXT NOT NULL,
    "roomsBooked" INTEGER,
    "channel" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_facts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceRef" JSONB NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "condition" JSONB NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAz" TEXT,
    "nameRu" TEXT,
    "description" TEXT,
    "overrides" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companies_organizationId_parentCompanyId_industry_idx" ON "companies"("organizationId", "parentCompanyId", "industry");

-- CreateIndex
CREATE INDEX "companies_organizationId_level_idx" ON "companies"("organizationId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "companies_organizationId_code_key" ON "companies"("organizationId", "code");

-- CreateIndex
CREATE INDEX "indicator_definitions_organizationId_idx" ON "indicator_definitions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "indicator_definitions_organizationId_code_key" ON "indicator_definitions"("organizationId", "code");

-- CreateIndex
CREATE INDEX "company_indicators_indicatorId_idx" ON "company_indicators"("indicatorId");

-- CreateIndex
CREATE UNIQUE INDEX "company_indicators_companyId_indicatorId_key" ON "company_indicators"("companyId", "indicatorId");

-- CreateIndex
CREATE INDEX "indicator_values_organizationId_companyId_period_idx" ON "indicator_values"("organizationId", "companyId", "period");

-- CreateIndex
CREATE INDEX "indicator_values_indicatorId_idx" ON "indicator_values"("indicatorId");

-- CreateIndex
CREATE UNIQUE INDEX "indicator_values_companyId_indicatorId_period_key" ON "indicator_values"("companyId", "indicatorId", "period");

-- CreateIndex
CREATE INDEX "bookings_companyId_arrivalDate_idx" ON "bookings"("companyId", "arrivalDate");

-- CreateIndex
CREATE INDEX "bookings_organizationId_idx" ON "bookings"("organizationId");

-- CreateIndex
CREATE INDEX "operational_facts_companyId_date_metric_idx" ON "operational_facts"("companyId", "date", "metric");

-- CreateIndex
CREATE INDEX "operational_facts_organizationId_idx" ON "operational_facts"("organizationId");

-- CreateIndex
CREATE INDEX "alerts_organizationId_triggeredAt_idx" ON "alerts"("organizationId", "triggeredAt");

-- CreateIndex
CREATE INDEX "alerts_organizationId_acknowledgedAt_idx" ON "alerts"("organizationId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "alert_rules_organizationId_idx" ON "alert_rules"("organizationId");

-- CreateIndex
CREATE INDEX "scenarios_organizationId_idx" ON "scenarios"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_organizationId_code_key" ON "scenarios"("organizationId", "code");

-- CreateIndex
CREATE INDEX "budget_lines_companyId_idx" ON "budget_lines"("companyId");

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_parentCompanyId_fkey" FOREIGN KEY ("parentCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_definitions" ADD CONSTRAINT "indicator_definitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_indicators" ADD CONSTRAINT "company_indicators_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_indicators" ADD CONSTRAINT "company_indicators_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicator_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicator_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_facts" ADD CONSTRAINT "operational_facts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
