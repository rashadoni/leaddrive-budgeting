-- Phase 7.K Phase 5a: Add api_key_update enum value for AuditAction.
-- Tracks when admin sets/clears an external API key in
-- Organization.settings.apiKeys (EIA / USDA / Google Trends proxy).
--
-- Additive only — safe.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'api_key_update';
