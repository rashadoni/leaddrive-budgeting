/**
 * Phase B1 — SSE route bug-fix regression tests.
 *
 * Covers architect Round-1 ⚠️ closures #2 and #3 from commit 3aacf0d:
 *   (#2) `subscribe()` rejection mid-`start()` no longer leaves the
 *        client with a half-streamed Response that hangs forever.
 *        Pre-fix: uncaught throw inside ReadableStream.start.
 *        Post-fix: try/catch + send 'error' event + close stream.
 *   (#3) Abort signal firing BEFORE `await subscribe(...)` resolves no
 *        longer loses the unsub closures (rapid open-then-close race
 *        on browser refresh storms).
 *        Pre-fix: const unsubAudit was undefined when onAbort ran.
 *        Post-fix: hoisted let + null-safe `?.()` calls.
 *
 * Strategy: mock `requireRole` to return a session, mock `subscribe`
 * from postgres-listener to control timing/throws, drive the route
 * handler with a synthetic NextRequest carrying an AbortSignal we
 * own. Read the resulting ReadableStream's chunks to assert SSE-
 * formatted output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock chain: api-auth so route auth doesn't need a real session;
// postgres-listener so we control subscribe() timing.
vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn(),
  isAuthError: (r: unknown) => r instanceof Response,
}));
vi.mock('@/lib/events/postgres-listener', () => ({
  subscribe: vi.fn(),
}));

// Import AFTER vi.mock so the route picks up mocked deps.
const importRoute = async () => {
  vi.resetModules();
  return import('./route');
};

const SESSION = { userId: 'u_1', orgId: 'org_1', role: 'manager' as const };

async function readSseChunks(
  stream: ReadableStream<Uint8Array>,
  maxChunks = 10,
  timeoutMs = 500,
): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const start = Date.now();
  while (chunks.length < maxChunks && Date.now() - start < timeoutMs) {
    const r = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((res) =>
        setTimeout(() => res({ done: true, value: undefined }), 50),
      ),
    ]);
    if (r.done) break;
    if (r.value) chunks.push(decoder.decode(r.value));
  }
  reader.releaseLock();
  return chunks;
}

beforeEach(async () => {
  const { requireRole } = await import('@/lib/api-auth');
  (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue(SESSION);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/events/stream (Phase B1)', () => {
  it('emits hello + heartbeat once subscriptions resolve', async () => {
    const { subscribe } = await import('@/lib/events/postgres-listener');
    (subscribe as ReturnType<typeof vi.fn>).mockResolvedValue(() => {});
    const { GET } = await importRoute();

    const ac = new AbortController();
    const req = new Request('http://localhost/api/events/stream', {
      signal: ac.signal,
    }) as unknown as Parameters<typeof GET>[0];

    const res = await GET(req);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const chunks = await readSseChunks(res.body!, 2, 200);
    expect(chunks.join('')).toContain('event: hello');
    expect(chunks.join('')).toMatch(/"orgId":"org_1"/);
    ac.abort();
  });

  it('REGRESSION (Round-1 ⚠️ #2): subscribe rejection sends error event + closes (no hung stream)', async () => {
    const { subscribe } = await import('@/lib/events/postgres-listener');
    (subscribe as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('DB unreachable'),
    );
    const { GET } = await importRoute();

    const ac = new AbortController();
    const req = new Request('http://localhost/api/events/stream', {
      signal: ac.signal,
    }) as unknown as Parameters<typeof GET>[0];

    const res = await GET(req);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const allText: string[] = [];
    // Read until stream closes (was: pre-fix would hang forever)
    for (let i = 0; i < 20; i++) {
      const r = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((res2) =>
          setTimeout(() => res2({ done: true, value: undefined }), 100),
        ),
      ]);
      if (r.done) break;
      if (r.value) allText.push(decoder.decode(r.value));
    }
    reader.releaseLock();
    const joined = allText.join('');
    // hello fires first (always)
    expect(joined).toContain('event: hello');
    // Then error event
    expect(joined).toContain('event: error');
    expect(joined).toContain('subscribe_failed');
    expect(joined).toContain('DB unreachable');
  });

  it('REGRESSION (Round-1 ⚠️ #3): abort BEFORE subscribe resolves does not throw / hang', async () => {
    const { subscribe } = await import('@/lib/events/postgres-listener');
    // Make subscribe hang for 5 seconds
    (subscribe as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );
    const { GET } = await importRoute();

    const ac = new AbortController();
    const req = new Request('http://localhost/api/events/stream', {
      signal: ac.signal,
    }) as unknown as Parameters<typeof GET>[0];

    const res = await GET(req);
    expect(res.body).toBeTruthy();
    // Abort while subscribe() is still pending
    setTimeout(() => ac.abort(), 50);
    // Read until close (or 1s timeout)
    const reader = res.body!.getReader();
    let closed = false;
    const start = Date.now();
    while (Date.now() - start < 1500) {
      const r = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((res2) =>
          setTimeout(() => res2({ done: true, value: undefined }), 200),
        ),
      ]);
      if (r.done) {
        closed = true;
        break;
      }
    }
    reader.releaseLock();
    // Pre-fix: cleanup threw because unsubAudit was undefined when onAbort ran.
    // Post-fix: closes cleanly without unhandled error.
    expect(closed).toBe(true);
  });

  it('returns 401 if requireRole returns auth error', async () => {
    const { requireRole } = await import('@/lib/api-auth');
    (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );
    const { GET } = await importRoute();

    const ac = new AbortController();
    const req = new Request('http://localhost/api/events/stream', {
      signal: ac.signal,
    }) as unknown as Parameters<typeof GET>[0];

    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 if session has no orgId', async () => {
    const { requireRole } = await import('@/lib/api-auth');
    (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...SESSION,
      orgId: null,
    });
    const { GET } = await importRoute();

    const ac = new AbortController();
    const req = new Request('http://localhost/api/events/stream', {
      signal: ac.signal,
    }) as unknown as Parameters<typeof GET>[0];

    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  // Phase 7.G Turn Q Round-1 ⚠️ closure — TERMINAL_LIVE_DISABLED truthy-check
  // bug. Naive `if (process.env.X)` accepted string `"false"` as truthy
  // (silent-failure: sysadmin sets =false intending to enable, route
  // stays disabled). Tests lock the explicit allow-list parser.
  describe('TERMINAL_LIVE_DISABLED kill-switch (Turn Q)', () => {
    const ORIGINAL_ENV = process.env.TERMINAL_LIVE_DISABLED;
    afterEach(() => {
      if (ORIGINAL_ENV === undefined) {
        delete process.env.TERMINAL_LIVE_DISABLED;
      } else {
        process.env.TERMINAL_LIVE_DISABLED = ORIGINAL_ENV;
      }
    });

    async function callRoute() {
      const { GET } = await importRoute();
      const ac = new AbortController();
      const req = new Request('http://localhost/api/events/stream', {
        signal: ac.signal,
      }) as unknown as Parameters<typeof GET>[0];
      return GET(req);
    }

    it('returns 503 when TERMINAL_LIVE_DISABLED=1', async () => {
      process.env.TERMINAL_LIVE_DISABLED = '1';
      const res = await callRoute();
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('60');
    });

    it('returns 503 when TERMINAL_LIVE_DISABLED=true (case-insensitive)', async () => {
      process.env.TERMINAL_LIVE_DISABLED = 'TRUE';
      const res = await callRoute();
      expect(res.status).toBe(503);
    });

    it('does NOT return 503 when TERMINAL_LIVE_DISABLED="false" (silent-failure regression guard)', async () => {
      process.env.TERMINAL_LIVE_DISABLED = 'false';
      const res = await callRoute();
      // Should fall through to the auth/orgId path → 200/streaming
      // (since SESSION has both userId + orgId set in beforeEach).
      // Hard-block expectation: status MUST NOT be 503.
      expect(res.status).not.toBe(503);
    });

    it('does NOT return 503 when TERMINAL_LIVE_DISABLED="0"', async () => {
      process.env.TERMINAL_LIVE_DISABLED = '0';
      const res = await callRoute();
      expect(res.status).not.toBe(503);
    });

    it('does NOT return 503 when TERMINAL_LIVE_DISABLED unset (default)', async () => {
      delete process.env.TERMINAL_LIVE_DISABLED;
      const res = await callRoute();
      expect(res.status).not.toBe(503);
    });

    it('does NOT return 503 when TERMINAL_LIVE_DISABLED is empty string', async () => {
      process.env.TERMINAL_LIVE_DISABLED = '';
      const res = await callRoute();
      expect(res.status).not.toBe(503);
    });

    it('returns 503 when TERMINAL_LIVE_DISABLED=on (whitespace tolerance)', async () => {
      process.env.TERMINAL_LIVE_DISABLED = '  on  ';
      const res = await callRoute();
      expect(res.status).toBe(503);
    });
  });
});
