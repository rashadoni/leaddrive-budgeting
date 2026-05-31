-- Phase 7.E C6 v3 (Turn III) — AlertEvent immutable-log table.
-- Companion to existing `alerts` (user-acknowledgeable inbox); this is an
-- evaluator-output replay log: delete-by-(orgId,period) + insertMany on every
-- recompute pass, supports digest emails, audit trail, historical drift queries.
-- Idempotent: `IF NOT EXISTS` on table + indexes lets re-runs after a partial
-- migration succeed cleanly.

CREATE TABLE IF NOT EXISTS "alert_events" (
    "id"                       TEXT       NOT NULL,
    "organizationId"           TEXT       NOT NULL,
    "period"                   TEXT       NOT NULL,
    "ruleId"                   TEXT       NOT NULL,
    "ruleName"                 TEXT       NOT NULL,
    "severity"                 TEXT       NOT NULL,
    "message"                  TEXT       NOT NULL,
    "messageKey"               TEXT       NOT NULL,
    "messageParams"            JSONB      NOT NULL,
    "affectedCompanyIds"       TEXT[]     NOT NULL,
    "affectedIndicatorCodes"   TEXT[]     NOT NULL DEFAULT ARRAY[]::TEXT[],
    "emittedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- FK: same cascade pattern as `alerts`.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'alert_events_organizationId_fkey'
    ) THEN
        ALTER TABLE "alert_events"
        ADD CONSTRAINT "alert_events_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END$$;

-- Replay-by-period query path.
CREATE INDEX IF NOT EXISTS "alert_events_organizationId_period_emittedAt_idx"
    ON "alert_events" ("organizationId", "period", "emittedAt");

-- Per-rule digest queries (e.g. "all RULE_CRITICAL_INDICATOR firings this quarter").
CREATE INDEX IF NOT EXISTS "alert_events_organizationId_ruleId_emittedAt_idx"
    ON "alert_events" ("organizationId", "ruleId", "emittedAt");
