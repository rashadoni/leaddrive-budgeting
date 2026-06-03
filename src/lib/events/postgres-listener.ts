/**
 * Phase B1 (Bloomberg uplift plan) — Postgres LISTEN/NOTIFY wrapper.
 *
 * Opens a dedicated long-lived `pg.Client` connection (separate from
 * Prisma's pool which doesn't support LISTEN) and exposes a typed
 * subscription API. Each subscriber gets all NOTIFY payloads on the
 * given channel; org-scoping happens at the SSE-route level.
 *
 * Singleton pattern: one client per Node process. Multiple SSE handlers
 * share the connection and each registers its own listener; on the last
 * subscriber unregister, the connection stays open (cheap to keep) but
 * no listeners fire.
 *
 * Channels (matching the migration triggers):
 *   - `audit_events_changed`
 *   - `indicator_values_changed`
 */

import { Client } from 'pg';
import { getLogger } from '@/lib/log';

// Phase 8 D4 continuation (2026-05-28) — structured logger for the
// shared Postgres LISTEN/NOTIFY wrapper. 3 console.error → logger:
// listener-threw, client-error, reconnect-failed.
const log = getLogger('events:postgres-listener');

export type PostgresChannel =
  | 'audit_events_changed'
  | 'indicator_values_changed';

export interface AuditEventChangePayload {
  id: string;
  action: string;
  organizationId: string;
  /**
   * User who performed the action. `null` for CLI / cron / system-
   * originated events. Added by migration
   * `20260428220000_audit_events_notify_actoruserid`.
   */
  actorUserId: string | null;
  createdAt: string;
}

export interface IndicatorValueChangePayload {
  id: string;
  indicatorId: string;
  companyId: string;
  organizationId: string;
  status: string;
  period: string;
}

type ChannelPayload<C extends PostgresChannel> =
  C extends 'audit_events_changed'
    ? AuditEventChangePayload
    : IndicatorValueChangePayload;

type Listener<C extends PostgresChannel> = (
  payload: ChannelPayload<C>,
) => void;

let clientPromise: Promise<Client> | null = null;
const listeners: Map<PostgresChannel, Set<Listener<PostgresChannel>>> = new Map();

async function getClient(): Promise<Client> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    // Outer ref so the catch can tear down a half-open client. The connected
    // client is bound to `c` (a const) below so the long-lived event-handler
    // closures keep a non-nullable reference.
    let client: Client | undefined;
    try {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL not set');
      const c = new Client({ connectionString: url });
      client = c;
      await c.connect();
      c.on('notification', (msg) => {
        if (!msg.channel || !msg.payload) return;
        const channel = msg.channel as PostgresChannel;
        const set = listeners.get(channel);
        if (!set) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(msg.payload);
        } catch {
          return;
        }
        set.forEach((l) => {
          try {
            l(parsed as ChannelPayload<PostgresChannel>);
          } catch (err) {
            log.error('listener threw', {
              channel,
              err: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
          }
        });
      });
      c.on('error', (err) => {
        log.error('client error', {
          err: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        // On connection-loss, immediately re-establish the client so
        // existing subscribers in the shared `listeners` Map keep
        // receiving notifications without each having to re-subscribe.
        // The new client's `notification` handler reads from the same
        // module-level `listeners`, so once LISTEN is re-issued on the
        // fresh connection, payloads flow again automatically.
        clientPromise = null;
        c.end().catch(() => {});
        // Fire-and-forget reconnect; if it throws (DB still down), the
        // next `subscribe()` call will retry. Existing SSE handlers stay
        // registered for whichever connection eventually wins.
        void getClient().catch((reconnectErr) => {
          log.error('reconnect failed (will retry on next subscribe)', {
            err: reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr),
          });
        });
      });
      // Begin LISTEN on both channels — cheap, fixed list, no need to
      // dynamically subscribe per call site.
      await c.query('LISTEN audit_events_changed');
      await c.query('LISTEN indicator_values_changed');
      return c;
    } catch (err) {
      // First-connect / LISTEN failure (DB cold-start, restart, or a transient
      // blip at the moment of the first subscribe after a deploy). The module
      // singleton was already assigned this about-to-reject promise BEFORE the
      // await, and the only other reset lives inside the 'error' event handler
      // which is (a) registered after connect and (b) keyed to a client event,
      // not a connect()/query() promise rejection. Without this reset the
      // rejected promise would be cached forever, so every later subscribe()
      // re-throws and SSE live updates stay dead process-wide until redeploy.
      // Null the singleton so the next subscribe() retries a fresh connection,
      // and tear down the half-open client so its 'error' handler can't fire a
      // competing reconnect.
      clientPromise = null;
      if (client) client.end().catch(() => {});
      throw err;
    }
  })();
  return clientPromise;
}

/**
 * Subscribe to a channel. Returns an unsubscribe function. Lazily
 * connects to Postgres on first subscriber.
 */
export async function subscribe<C extends PostgresChannel>(
  channel: C,
  listener: Listener<C>,
): Promise<() => void> {
  await getClient();
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(listener as Listener<PostgresChannel>);
  return () => {
    const s = listeners.get(channel);
    if (!s) return;
    s.delete(listener as Listener<PostgresChannel>);
  };
}
