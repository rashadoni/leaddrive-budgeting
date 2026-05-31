-- Phase 7.H Feature B — news sentiment scoring on IntelItem.
--
-- Adds a nullable sentimentScore column (-1..+1, NULL = unscored).
-- Crawler batch-scores new items at insert time; backfill script can
-- score legacy rows. NULL is the natural "unknown" value — resolver
-- skips NULL rows when averaging.
--
-- Idempotent: uses IF NOT EXISTS so re-runs on already-migrated DBs
-- are safe.

ALTER TABLE "intel_items"
  ADD COLUMN IF NOT EXISTS "sentimentScore" DOUBLE PRECISION;

-- Index for resolver query: company-tag filter + recent fetch + non-null
-- sentiment. Partial index keeps it small (legacy NULL rows excluded).
CREATE INDEX IF NOT EXISTS "intel_items_sentiment_lookup_idx"
  ON "intel_items" ("organizationId", "fetchedAt" DESC)
  WHERE "sentimentScore" IS NOT NULL;
