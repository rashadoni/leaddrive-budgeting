-- Phase C2 v2 (sub-22) — add `ai_forecast_explainer_run` to AuditAction enum.
-- Mirror of `20260427180000_audit_action_ai_variance_explainer_run`.
-- Emitted on POST /api/indicators/values/[id]/forecast/explain.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ai_forecast_explainer_run';
