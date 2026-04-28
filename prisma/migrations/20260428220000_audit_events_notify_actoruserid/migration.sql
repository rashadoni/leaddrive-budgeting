-- Phase B1 follow-up — extend audit_events NOTIFY payload with
-- `actorUserId` so AuditTicker UI can render a "who did this?" badge
-- without an extra DB round-trip per ticker tick. Architect Round-1
-- sub-1 closure (Turn 41): adding the field now (4 bytes per NOTIFY)
-- is cheaper than future re-migration when attribution surfaces.
--
-- Payload shape (post-migration):
--   audit_events: { id, action, organizationId, actorUserId, createdAt }
--
-- `actorUserId` is nullable in the schema (CLI-script / cron / system-
-- originated actions have no actor). The pg_notify projection emits it
-- as `null` JSON in those cases — clients should treat null as "system".

CREATE OR REPLACE FUNCTION notify_audit_events_changed()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'audit_events_changed',
    json_build_object(
      'id', NEW.id,
      'action', NEW.action,
      'organizationId', NEW."organizationId",
      'actorUserId', NEW."actorUserId",
      'createdAt', NEW."createdAt"
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger itself unchanged — the function body update propagates
-- automatically to the existing trigger binding.
