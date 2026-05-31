-- Phase 7.N C5 v2 — per-indicator weight for weighted composite risk score.
-- Non-destructive: adds nullable column with default 1.0.
-- All existing rows automatically get weight=1.0 (no back-fill needed;
-- the default value applies at the DB level).

ALTER TABLE "indicator_definitions" ADD COLUMN "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
