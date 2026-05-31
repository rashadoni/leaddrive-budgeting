-- Phase 7.G Turn LXXXXI batch — drift-resolution + 7 v2 model promotions.
--
-- 8 new AuditAction enum values + 5 new tables (3 caches + 1 commodity-data
-- + 1 predictive-breach scanner output).
--
-- Apply via: npx prisma migrate dev (developer-side, after migration drift
-- resolved via prisma migrate resolve --applied 20260509070239_phase7g_turnlxxv_chartofaccount_role).

-- ─── AuditAction enum extensions ────────────────────────────────────
-- Phase 7.G Turn LXXXXI: 8 new audit action values for v2 surfaces.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'coa_role_change';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ai_mapper_proposal_cache_run';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ai_mapper_template_promote';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ai_mapper_template_apply';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ai_token_budget_exceeded';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'intel_data_source_run';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'predictive_breach_compute';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ai_breach_digest';

-- ─── ai_mapper_proposal_cache (Phase 7.B v2 Day 3 + 5) ──────────────

CREATE TABLE "ai_mapper_proposal_cache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "structureHash" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "proposal" JSONB NOT NULL,
    "llmAnomalies" JSONB NOT NULL,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "templateName" TEXT,
    "applyCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_mapper_proposal_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_mapper_proposal_cache_organizationId_structureHash_promptVersion_modelName_key"
  ON "ai_mapper_proposal_cache"("organizationId", "structureHash", "promptVersion", "modelName");

CREATE INDEX "ai_mapper_proposal_cache_organizationId_isTemplate_lastUsedAt_idx"
  ON "ai_mapper_proposal_cache"("organizationId", "isTemplate", "lastUsedAt" DESC);

ALTER TABLE "ai_mapper_proposal_cache"
  ADD CONSTRAINT "ai_mapper_proposal_cache_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ai_token_usage (Phase 7.B v2 Day 6) ────────────────────────────

CREATE TABLE "ai_token_usage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_token_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_token_usage_organizationId_date_key"
  ON "ai_token_usage"("organizationId", "date");

CREATE INDEX "ai_token_usage_organizationId_date_idx"
  ON "ai_token_usage"("organizationId", "date" DESC);

ALTER TABLE "ai_token_usage"
  ADD CONSTRAINT "ai_token_usage_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── intel_data_points (Phase 7.E #1 D.5b) ──────────────────────────

CREATE TABLE "intel_data_points" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "raw" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intel_data_points_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "intel_data_points_organizationId_sourceCode_metric_datetime_key"
  ON "intel_data_points"("organizationId", "sourceCode", "metric", "datetime");

CREATE INDEX "intel_data_points_organizationId_sourceCode_datetime_idx"
  ON "intel_data_points"("organizationId", "sourceCode", "datetime" DESC);

ALTER TABLE "intel_data_points"
  ADD CONSTRAINT "intel_data_points_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── variance_explanations (Phase 7.E #2 v2 E.1a) ───────────────────

CREATE TABLE "variance_explanations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "indicatorValueId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variance_explanations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variance_explanations_org_iv_lang_pv_hash_key"
  ON "variance_explanations"("organizationId", "indicatorValueId", "language", "promptVersion", "snapshotHash");

CREATE INDEX "variance_explanations_organizationId_indicatorValueId_cachedAt_idx"
  ON "variance_explanations"("organizationId", "indicatorValueId", "cachedAt" DESC);

ALTER TABLE "variance_explanations"
  ADD CONSTRAINT "variance_explanations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── predictive_breaches (Phase 7.E #3 E.2b) ────────────────────────

CREATE TABLE "predictive_breaches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "indicatorCode" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "horizonStep" INTEGER NOT NULL,
    "currentStatus" TEXT NOT NULL,
    "predictedStatus" TEXT NOT NULL,
    "forecastConfidence" DOUBLE PRECISION NOT NULL,
    "confidenceBand" TEXT NOT NULL,
    "predictedValue" DOUBLE PRECISION NOT NULL,
    "predictedLower" DOUBLE PRECISION,
    "predictedUpper" DOUBLE PRECISION,
    "drivers" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predictive_breaches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "predictive_breaches_org_period_co_ind_horizon_key"
  ON "predictive_breaches"("organizationId", "period", "companyId", "indicatorCode", "horizonStep");

CREATE INDEX "predictive_breaches_organizationId_period_horizonStep_confidenceBand_idx"
  ON "predictive_breaches"("organizationId", "period", "horizonStep", "confidenceBand");

ALTER TABLE "predictive_breaches"
  ADD CONSTRAINT "predictive_breaches_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
