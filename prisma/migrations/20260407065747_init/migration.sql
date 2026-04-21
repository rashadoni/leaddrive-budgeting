-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "avatar" TEXT,
    "phone" TEXT,
    "department" TEXT,
    "lastLogin" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_rate_history" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "rateDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_rate_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_integrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "categoryMapping" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_imports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT,
    "planId" TEXT NOT NULL,
    "fileName" TEXT,
    "importType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "matchedRows" INTEGER NOT NULL DEFAULT 0,
    "unmatchedRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rolling_forecast_months" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'forecast',
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rolling_forecast_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_flow_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "entryType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'AZN',
    "description" TEXT,
    "paymentDate" TIMESTAMP(3),
    "isProjected" BOOLEAN NOT NULL DEFAULT true,
    "activityType" TEXT NOT NULL DEFAULT 'operating',
    "category" TEXT,
    "counterpartyId" TEXT,
    "plannedAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_flow_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_flow_alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "alertType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION,
    "projectedBalance" DOUBLE PRECISION NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_flow_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_change_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "snapshot" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_cost_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "costModelPattern" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "allocationMethod" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_cost_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_departments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "serviceKey" TEXT,
    "hasRevenue" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodType" TEXT NOT NULL DEFAULT 'monthly',
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "quarter" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "amendmentOf" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "versionLabel" TEXT,
    "snapshotData" JSONB,
    "isRolling" BOOLEAN NOT NULL DEFAULT false,
    "rollingMonths" INTEGER NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "department" TEXT,
    "lineType" TEXT NOT NULL DEFAULT 'expense',
    "lineSubtype" TEXT,
    "plannedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "forecastAmount" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "unitCost" DOUBLE PRECISION,
    "quantity" INTEGER,
    "costModelKey" TEXT,
    "isAutoPlanned" BOOLEAN NOT NULL DEFAULT true,
    "isAutoActual" BOOLEAN NOT NULL DEFAULT false,
    "costTypeId" TEXT,
    "departmentId" TEXT,
    "vatIncluded" BOOLEAN NOT NULL DEFAULT false,
    "vatRate" DOUBLE PRECISION,
    "amountExVat" DOUBLE PRECISION,
    "currencyCode" TEXT,
    "exchangeRate" DOUBLE PRECISION,
    "originalAmount" DOUBLE PRECISION,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_actuals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "department" TEXT,
    "lineType" TEXT NOT NULL DEFAULT 'expense',
    "actualAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expenseDate" TEXT,
    "description" TEXT,
    "currencyCode" TEXT,
    "exchangeRate" DOUBLE PRECISION,
    "originalAmount" DOUBLE PRECISION,
    "costTypeId" TEXT,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_actuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_sections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectionType" TEXT NOT NULL DEFAULT 'expense',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_forecast_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "lineType" TEXT NOT NULL DEFAULT 'expense',
    "forecastAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costTypeId" TEXT,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_forecast_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_direction_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lineType" TEXT NOT NULL DEFAULT 'revenue',
    "lineSubtype" TEXT,
    "defaultAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION,
    "unitCost" DOUBLE PRECISION,
    "quantity" INTEGER,
    "costModelKey" TEXT,
    "department" TEXT,
    "costTypeId" TEXT,
    "departmentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_direction_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_forecasts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_forecasts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "costTypeId" TEXT NOT NULL,
    "departmentId" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_department_owners" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canEdit" BOOLEAN NOT NULL DEFAULT true,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_department_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_approval_comments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_approval_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_email_key" ON "users"("organizationId", "email");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_organizationId_code_key" ON "currencies"("organizationId", "code");

-- CreateIndex
CREATE INDEX "currency_rate_history_organizationId_currencyCode_rateDate_idx" ON "currency_rate_history"("organizationId", "currencyCode", "rateDate");

-- CreateIndex
CREATE INDEX "accounting_integrations_organizationId_idx" ON "accounting_integrations"("organizationId");

-- CreateIndex
CREATE INDEX "accounting_imports_organizationId_idx" ON "accounting_imports"("organizationId");

-- CreateIndex
CREATE INDEX "accounting_imports_planId_idx" ON "accounting_imports"("planId");

-- CreateIndex
CREATE INDEX "rolling_forecast_months_organizationId_idx" ON "rolling_forecast_months"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "rolling_forecast_months_planId_year_month_key" ON "rolling_forecast_months"("planId", "year", "month");

-- CreateIndex
CREATE INDEX "cash_flow_entries_organizationId_year_month_idx" ON "cash_flow_entries"("organizationId", "year", "month");

-- CreateIndex
CREATE INDEX "cash_flow_entries_organizationId_activityType_idx" ON "cash_flow_entries"("organizationId", "activityType");

-- CreateIndex
CREATE INDEX "cash_flow_alerts_organizationId_idx" ON "cash_flow_alerts"("organizationId");

-- CreateIndex
CREATE INDEX "budget_change_logs_planId_createdAt_idx" ON "budget_change_logs"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "budget_change_logs_organizationId_idx" ON "budget_change_logs"("organizationId");

-- CreateIndex
CREATE INDEX "budget_cost_types_organizationId_idx" ON "budget_cost_types"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_cost_types_organizationId_key_key" ON "budget_cost_types"("organizationId", "key");

-- CreateIndex
CREATE INDEX "budget_departments_organizationId_idx" ON "budget_departments"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_departments_organizationId_key_key" ON "budget_departments"("organizationId", "key");

-- CreateIndex
CREATE INDEX "budget_plans_organizationId_idx" ON "budget_plans"("organizationId");

-- CreateIndex
CREATE INDEX "budget_lines_organizationId_idx" ON "budget_lines"("organizationId");

-- CreateIndex
CREATE INDEX "budget_lines_planId_idx" ON "budget_lines"("planId");

-- CreateIndex
CREATE INDEX "budget_lines_parentId_idx" ON "budget_lines"("parentId");

-- CreateIndex
CREATE INDEX "budget_lines_costTypeId_idx" ON "budget_lines"("costTypeId");

-- CreateIndex
CREATE INDEX "budget_lines_departmentId_idx" ON "budget_lines"("departmentId");

-- CreateIndex
CREATE INDEX "budget_actuals_organizationId_idx" ON "budget_actuals"("organizationId");

-- CreateIndex
CREATE INDEX "budget_actuals_planId_idx" ON "budget_actuals"("planId");

-- CreateIndex
CREATE INDEX "budget_actuals_costTypeId_idx" ON "budget_actuals"("costTypeId");

-- CreateIndex
CREATE INDEX "budget_actuals_departmentId_idx" ON "budget_actuals"("departmentId");

-- CreateIndex
CREATE INDEX "budget_sections_organizationId_idx" ON "budget_sections"("organizationId");

-- CreateIndex
CREATE INDEX "budget_sections_planId_idx" ON "budget_sections"("planId");

-- CreateIndex
CREATE INDEX "budget_forecast_entries_organizationId_idx" ON "budget_forecast_entries"("organizationId");

-- CreateIndex
CREATE INDEX "budget_forecast_entries_planId_idx" ON "budget_forecast_entries"("planId");

-- CreateIndex
CREATE INDEX "budget_forecast_entries_costTypeId_idx" ON "budget_forecast_entries"("costTypeId");

-- CreateIndex
CREATE INDEX "budget_forecast_entries_departmentId_idx" ON "budget_forecast_entries"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_forecast_entries_planId_year_month_category_lineType_key" ON "budget_forecast_entries"("planId", "year", "month", "category", "lineType");

-- CreateIndex
CREATE INDEX "budget_direction_templates_organizationId_idx" ON "budget_direction_templates"("organizationId");

-- CreateIndex
CREATE INDEX "budget_direction_templates_costTypeId_idx" ON "budget_direction_templates"("costTypeId");

-- CreateIndex
CREATE INDEX "budget_direction_templates_departmentId_idx" ON "budget_direction_templates"("departmentId");

-- CreateIndex
CREATE INDEX "sales_forecasts_organizationId_idx" ON "sales_forecasts"("organizationId");

-- CreateIndex
CREATE INDEX "sales_forecasts_organizationId_year_idx" ON "sales_forecasts"("organizationId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "sales_forecasts_organizationId_departmentId_year_month_key" ON "sales_forecasts"("organizationId", "departmentId", "year", "month");

-- CreateIndex
CREATE INDEX "expense_forecasts_organizationId_idx" ON "expense_forecasts"("organizationId");

-- CreateIndex
CREATE INDEX "expense_forecasts_organizationId_year_idx" ON "expense_forecasts"("organizationId", "year");

-- CreateIndex
CREATE INDEX "expense_forecasts_organizationId_costTypeId_departmentId_ye_idx" ON "expense_forecasts"("organizationId", "costTypeId", "departmentId", "year", "month");

-- CreateIndex
CREATE INDEX "budget_department_owners_organizationId_idx" ON "budget_department_owners"("organizationId");

-- CreateIndex
CREATE INDEX "budget_department_owners_userId_idx" ON "budget_department_owners"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_department_owners_organizationId_departmentId_userId_key" ON "budget_department_owners"("organizationId", "departmentId", "userId");

-- CreateIndex
CREATE INDEX "budget_approval_comments_planId_createdAt_idx" ON "budget_approval_comments"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "budget_approval_comments_organizationId_idx" ON "budget_approval_comments"("organizationId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_rate_history" ADD CONSTRAINT "currency_rate_history_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_integrations" ADD CONSTRAINT "accounting_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_imports" ADD CONSTRAINT "accounting_imports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_imports" ADD CONSTRAINT "accounting_imports_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "accounting_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_imports" ADD CONSTRAINT "accounting_imports_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolling_forecast_months" ADD CONSTRAINT "rolling_forecast_months_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolling_forecast_months" ADD CONSTRAINT "rolling_forecast_months_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_flow_entries" ADD CONSTRAINT "cash_flow_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_flow_alerts" ADD CONSTRAINT "cash_flow_alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_cost_types" ADD CONSTRAINT "budget_cost_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_departments" ADD CONSTRAINT "budget_departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_costTypeId_fkey" FOREIGN KEY ("costTypeId") REFERENCES "budget_cost_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "budget_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_actuals" ADD CONSTRAINT "budget_actuals_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_actuals" ADD CONSTRAINT "budget_actuals_costTypeId_fkey" FOREIGN KEY ("costTypeId") REFERENCES "budget_cost_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_actuals" ADD CONSTRAINT "budget_actuals_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "budget_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_sections" ADD CONSTRAINT "budget_sections_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_forecast_entries" ADD CONSTRAINT "budget_forecast_entries_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_forecast_entries" ADD CONSTRAINT "budget_forecast_entries_costTypeId_fkey" FOREIGN KEY ("costTypeId") REFERENCES "budget_cost_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_forecast_entries" ADD CONSTRAINT "budget_forecast_entries_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "budget_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_direction_templates" ADD CONSTRAINT "budget_direction_templates_costTypeId_fkey" FOREIGN KEY ("costTypeId") REFERENCES "budget_cost_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_direction_templates" ADD CONSTRAINT "budget_direction_templates_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "budget_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_forecasts" ADD CONSTRAINT "sales_forecasts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_forecasts" ADD CONSTRAINT "sales_forecasts_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "budget_departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_forecasts" ADD CONSTRAINT "expense_forecasts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_forecasts" ADD CONSTRAINT "expense_forecasts_costTypeId_fkey" FOREIGN KEY ("costTypeId") REFERENCES "budget_cost_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_forecasts" ADD CONSTRAINT "expense_forecasts_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "budget_departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_department_owners" ADD CONSTRAINT "budget_department_owners_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_department_owners" ADD CONSTRAINT "budget_department_owners_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "budget_departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_department_owners" ADD CONSTRAINT "budget_department_owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_approval_comments" ADD CONSTRAINT "budget_approval_comments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_approval_comments" ADD CONSTRAINT "budget_approval_comments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
