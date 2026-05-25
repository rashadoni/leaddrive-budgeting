-- Phase 1.4 (2026-05-26) — additive enum value for the soft-delete
-- physical-purge cron emitted from the BullMQ cleanup processor.
-- Mirrors the data_archive/data_restore lifecycle: archive sets
-- deletedAt, restore clears it, soft_delete_purge physically removes
-- rows whose deletedAt is older than the 30-day retention window.
--
-- Idempotent (IF NOT EXISTS pattern via DO block since ALTER TYPE
-- ADD VALUE doesn't support IF NOT EXISTS in all PG versions).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'soft_delete_purge'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'soft_delete_purge';
  END IF;
END$$;
