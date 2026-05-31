-- Phase 7.E C6 v2 — add `alert_thresholds_update` to AuditAction enum.
-- Emitted on PATCH /api/organizations/settings when an admin edits
-- alertThresholds (per-org alert-rule threshold tuning, sub-9 closure).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'alert_thresholds_update';
