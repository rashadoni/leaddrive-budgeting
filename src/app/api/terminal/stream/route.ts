// Next.js Route Handler for Server-Sent Events (SSE)
// This endpoint allows the Bloomberg-style terminal to receive real-time push updates
// without polling the database every 30 seconds.

import type { NextRequest } from 'next/server';
import { getOrgId } from '@/lib/api-auth';
import { getLogger } from '@/lib/log';

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger('api:terminal:stream');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Phase 8 G3 F1 — gate the SSE. Today it only emits no-data heartbeats, but
  // the TODO below will hook in real org-scoped recompute events; an ungated
  // stream would then leak cross-tenant events. Gating now also closes the
  // anonymous open-connection surface. `getOrgId` resolves the NextAuth
  // session from the request cookies (the authed terminal page already
  // connects with them) and returns null when unauthenticated.
  const orgId = await getOrgId(request as NextRequest);
  if (!orgId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();

  // Create a TransformStream to stream data to the client
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Helper function to push messages to the client
  const sendEvent = async (event: string, data: unknown) => {
    try {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(message));
    } catch (e) {
      log.error('Error writing to SSE stream', {
        event,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // 1. Send initial connection success message
  sendEvent('connected', { timestamp: new Date().toISOString() });

  // 2. Here you would typically hook into your background job queue (e.g. BullMQ events)
  // or a Pub/Sub system (Redis) to listen for "indicator_computed" events.
  // For the architectural skeleton, we will set up a heartbeat interval.
  const intervalId = setInterval(() => {
    sendEvent('heartbeat', { status: 'alive', time: new Date().toISOString() });
  }, 15000);

  // Clean up when the client disconnects
  request.signal.addEventListener('abort', () => {
    clearInterval(intervalId);
    writer.close();
  });

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
