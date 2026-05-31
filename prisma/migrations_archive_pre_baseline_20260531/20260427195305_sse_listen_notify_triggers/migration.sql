-- Phase B1 (Bloomberg uplift plan): Postgres LISTEN/NOTIFY triggers for
-- Server-Sent-Events stream. Subscribers (`/api/events/stream`) listen
-- on these channels and forward payloads to connected clients.
--
-- Channels:
--   audit_events_changed       — fires on INSERT into audit_events.
--   indicator_values_changed   — fires on UPDATE OR INSERT into indicator_values.
--
-- Payload shape (JSON via row_to_json on a sparse projection):
--   audit_events:     { id, action, organizationId, createdAt }
--   indicator_values: { id, indicatorId, companyId, organizationId,
--                       status, period }
--
-- The payload is intentionally MINIMAL — clients re-fetch full rows via
-- the existing REST endpoints when needed. This keeps NOTIFY payloads
-- under the 8000-byte Postgres limit and avoids leaking unnecessary
-- columns into the wire format.
--
-- Org-scoping happens client-side: subscribers join the
-- `audit:org-<id>` / `indicators:org-<id>` channels and the SSE handler
-- filters NOTIFY payloads by organizationId before forwarding. We don't
-- create per-org channels at the Postgres level because that would
-- require dynamic CREATE CHANNEL on every new tenant — fixed channels +
-- payload-based routing is the standard pattern.

-- audit_events trigger ------------------------------------------------

CREATE OR REPLACE FUNCTION notify_audit_events_changed()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'audit_events_changed',
    json_build_object(
      'id', NEW.id,
      'action', NEW.action,
      'organizationId', NEW."organizationId",
      'createdAt', NEW."createdAt"
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_notify_trg ON audit_events;
CREATE TRIGGER audit_events_notify_trg
  AFTER INSERT ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION notify_audit_events_changed();

-- indicator_values trigger -------------------------------------------

CREATE OR REPLACE FUNCTION notify_indicator_values_changed()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'indicator_values_changed',
    json_build_object(
      'id', NEW.id,
      'indicatorId', NEW."indicatorId",
      'companyId', NEW."companyId",
      'organizationId', NEW."organizationId",
      'status', NEW.status,
      'period', NEW.period
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS indicator_values_notify_trg ON indicator_values;
CREATE TRIGGER indicator_values_notify_trg
  AFTER INSERT OR UPDATE ON indicator_values
  FOR EACH ROW
  EXECUTE FUNCTION notify_indicator_values_changed();
