-- Phase 7.E AI-suite — add `ai_variance_explainer_run` to AuditAction enum.
-- Back-fills the `npx prisma db push` applied during Turn 38 sub-turn 8
-- to keep migrate-status clean.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ai_variance_explainer_run';
