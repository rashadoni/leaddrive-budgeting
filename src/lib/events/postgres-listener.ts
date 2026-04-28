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
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL not set');
    const client = new Client({ connectionString: url });
    await client.connect();
    client.on('notification', (msg) => {
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
          console.error('[postgres-listener] listener threw:', err);
        }
      });
    });
    client.on('error', (err) => {
      console.error('[postgres-listener] client error:', err);
      // On connection-loss, immediately re-establish the client so
      // existing subscribers in the shared `listeners` Map keep
      // receiving notifications without each having to re-subscribe.
      // The new client's `notification` handler reads from the same
      // module-level `listeners`, so once LISTEN is re-issued on the
      // fresh connection, payloads flow again automatically.
      clientPromise = null;
      client.end().catch(() => {});
      // Fire-and-forget reconnect; if it throws (DB still down), the
      // next `subscribe()` call will retry. Existing SSE handlers stay
      // registered for whichever connection eventually wins.
      void getClient().catch((reconnectErr) => {
        console.error(
          '[postgres-listener] reconnect failed (will retry on next subscribe):',
          reconnectErr,
        );
      });
    });
    // Begin LISTEN on both channels — cheap, fixed list, no need to
    // dynamically subscribe per call site.
    await client.query('LISTEN audit_events_changed');
    await client.query('LISTEN indicator_values_changed');
    return client;
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
