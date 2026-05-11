-- Phase 7.H Feature 1: AI news summary audit action.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'AuditAction' AND e.enumlabel = 'ai_news_summary_run'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'ai_news_summary_run';
  END IF;
END$$;
