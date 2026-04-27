/**
 * Phase B1 (Bloomberg uplift plan) — Server-Sent Events stream endpoint.
 *
 * GET /api/events/stream
 *
 * Long-lived HTTP connection that streams JSON-encoded events to the
 * client. Clients use the standard EventSource API (or our custom
 * `useEventStream` hook with reconnect logic).
 *
 * Auth: `viewer` role + same-org. The stream emits org-scoped data only;
 * even at viewer tier, real-time visibility into one's own org is
 * acceptable (no cross-org data leakage). Manager+ gating happens
 * server-side at the read endpoints (e.g. /api/audit/events) — the
 * stream just signals "something changed", payload-shape is sparse.
 *
 * Event types emitted:
 *   - `audit:changed`        — { id, action, organizationId, createdAt }
 *   - `indicator:changed`    — { id, indicatorId, companyId, status, period, organizationId }
 *   - `heartbeat`            — emitted every 25s to keep proxies/browsers
 *                              from closing the idle connection.
 *
 * All payloads are JSON. Each SSE event is formatted as:
 *
 *   event: <type>
 *   data: <json>
 *
 *   <blank line>
 *
 * Reconnect protocol: clients reconnect on disconnect; the stream is
 * stateless (no event-id replay). Brief gaps lose events — acceptable
 * because clients also poll the REST endpoints periodically. Phase 7.G
 * may add cursor-based replay if needed.
 */

import { NextRequest } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { subscribe } from '@/lib/events/postgres-listener';

export const dynamic = 'force-dynamic';
// SSE is incompatible with Next's edge runtime (no long-lived streams);
// require Node runtime explicitly.
export const runtime = 'nodejs';

const HEARTBEAT_MS = 25_000;

export async function GET(request: NextRequest) {
  const session = await requireRole(request, 'viewer');
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return new Response(JSON.stringify({ error: 'User has no organization' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  const orgId = session.orgId;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      // Hoisted so onAbort can null-check even if abort fires before
      // the `await subscribe(...)` resolves below (rapid open-then-close
      // race on browser refresh storms).
      let unsubAudit: (() => void) | null = null;
      let unsubIndicator: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Stream may have been torn down between the closed check and
          // the enqueue — treat as closed.
          closed = true;
        }
      };

      const sendEvent = (type: string, data: unknown) => {
        safeEnqueue(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubAudit?.();
        unsubIndicator?.();
        try {
          controller.close();
        } catch {
          // Already closed by the stream lifecycle.
        }
      };

      // Tear-down on client disconnect (browser close, navigate-away).
      // Wired BEFORE subscribe() so an abort during the await still
      // results in proper cleanup of whichever subscriptions did resolve.
      request.signal.addEventListener('abort', cleanup);

      // Send hello first so the EventSource onopen fires regardless of
      // whether the Postgres subscriptions succeed.
      sendEvent('hello', { orgId, ts: Date.now() });

      // Subscribe to Postgres NOTIFY channels; filter by orgId before
      // forwarding to the client. If the subscription throws (DB down,
      // env misconfigured), surface a graceful 'error' event + close —
      // otherwise the client gets a half-streamed Response that just
      // hangs.
      try {
        unsubAudit = await subscribe('audit_events_changed', (payload) => {
          if (payload.organizationId !== orgId) return;
          sendEvent('audit:changed', payload);
        });
        unsubIndicator = await subscribe(
          'indicator_values_changed',
          (payload) => {
            if (payload.organizationId !== orgId) return;
            sendEvent('indicator:changed', payload);
          },
        );
      } catch (err) {
        sendEvent('error', {
          message: 'subscribe_failed',
          detail: err instanceof Error ? err.message : 'unknown',
        });
        cleanup();
        return;
      }

      heartbeat = setInterval(() => {
        sendEvent('heartbeat', { ts: Date.now() });
      }, HEARTBEAT_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Prevent buffering by Vercel/proxy. Some serverless platforms
      // (Vercel Edge specifically) ignore this; that's why runtime is
      // forced to 'nodejs' above.
      'x-accel-buffering': 'no',
    },
  });
}
