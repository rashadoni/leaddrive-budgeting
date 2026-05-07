-- Phase 7.G Turn XLIII (Phase D.2) — add `intel_crawl_run` to AuditAction enum.
-- Mirror of `20260429100000_audit_action_ai_forecast_explainer_run`.
-- Emitted on POST /api/intel/refresh (admin-triggered AI Web Crawler run).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'intel_crawl_run';
