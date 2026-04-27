"use client";

/**
 * Phase B1 (Bloomberg uplift plan) — client-side SSE consumer hook.
 *
 * Subscribes to the `/api/events/stream` SSE endpoint and dispatches
 * typed callbacks for each event type. Handles reconnection with
 * exponential backoff (capped at 30s) and pauses when the document is
 * hidden (Page Visibility API) to save server resources for inactive
 * tabs.
 *
 * Always-on: the SSE endpoint is auth-gated server-side (viewer+ + same
 * org), so unauth'd traffic gets a 401 and the EventSource closes. No
 * client-side build-time flag needed. Earlier `NEXT_PUBLIC_TERMINAL_LIVE`
 * gate was removed when Turbopack dev wasn't reliably inlining it; if
 * production deploys need to disable SSE later, the cleanest path is a
 * route-level guard (return 503) rather than a client flag.
 */

import { useEffect, useRef } from 'react';

export interface AuditChangedEvent {
  id: string;
  action: string;
  organizationId: string;
  createdAt: string;
}

export interface IndicatorChangedEvent {
  id: string;
  indicatorId: string;
  companyId: string;
  organizationId: string;
  status: string;
  period: string;
}

export interface UseEventStreamHandlers {
  onAuditChanged?: (e: AuditChangedEvent) => void;
  onIndicatorChanged?: (e: IndicatorChangedEvent) => void;
  /** Called when the stream first connects (or reconnects). */
  onConnect?: () => void;
  /** Called when the stream disconnects (will retry unless unmounted). */
  onDisconnect?: () => void;
}

const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 30_000;

export function useEventStream(handlers: UseEventStreamHandlers): void {
  // Stash handlers in a ref so the connect/reconnect effect doesn't
  // re-fire when the parent passes new function identities each render.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof EventSource === 'undefined') return;

    let source: EventSource | null = null;
    let backoffMs = RECONNECT_INITIAL_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const open = () => {
      if (cancelled) return;
      // Skip while document is hidden — reconnect on visibility change.
      if (document.visibilityState === 'hidden') return;
      source = new EventSource('/api/events/stream');
      source.addEventListener('open', () => {
        backoffMs = RECONNECT_INITIAL_MS;
        handlersRef.current.onConnect?.();
      });
      source.addEventListener('audit:changed', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as AuditChangedEvent;
          handlersRef.current.onAuditChanged?.(data);
        } catch {
          // Malformed payload — ignore; server should never emit non-JSON.
        }
      });
      source.addEventListener('indicator:changed', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as IndicatorChangedEvent;
          handlersRef.current.onIndicatorChanged?.(data);
        } catch {
          // Malformed payload — ignore.
        }
      });
      source.addEventListener('error', () => {
        if (cancelled) return;
        handlersRef.current.onDisconnect?.();
        source?.close();
        source = null;
        // Exponential backoff with jitter (50% randomization) so a
        // server restart doesn't get a thundering-herd reconnect.
        const jitter = backoffMs * (0.5 + Math.random() * 0.5);
        reconnectTimer = setTimeout(open, jitter);
        backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !source) {
        // Cancel any pending reconnect and reconnect immediately.
        if (reconnectTimer) clearTimeout(reconnectTimer);
        backoffMs = RECONNECT_INITIAL_MS;
        open();
      } else if (document.visibilityState === 'hidden' && source) {
        source.close();
        source = null;
        handlersRef.current.onDisconnect?.();
      }
    };

    open();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
      source = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
