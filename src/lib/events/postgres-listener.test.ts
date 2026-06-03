/**
 * Phase B1 — postgres-listener reconnect-bug regression tests.
 *
 * Covers the 3 architect Round-1 ⚠️ closures from commit 3aacf0d:
 *   (1) `subscribe()` registers a listener, NOTIFY message fires it.
 *   (2) Multiple subscribers on the same channel all fire.
 *   (3) `unsubscribe()` returned from subscribe() removes only that listener.
 *   (4) **The reconnect bug:** on `client.error`, the singleton client
 *       resets, immediately re-establishes a new client, AND existing
 *       listeners (still in the shared `listeners` Map) keep receiving
 *       NOTIFY messages routed via the new client. Pre-fix: existing
 *       subscribers lost LISTEN forever until a new subscribe() call.
 *
 * Strategy: mock the `pg` Client constructor with a fake EventEmitter-
 * style object exposing `connect`, `query`, `on`, `end`. The module's
 * `getClient()` is wrapped via lazy promise — we drive the test by
 * dispatching synthetic 'notification' / 'error' events on the fake.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Local poll-until-condition helper — vitest 4.x's `vi.waitFor` would
// also work but the project's vitest version doesn't expose it stably.
async function waitForCondition(
  fn: () => void | Promise<void>,
  timeoutMs = 1000,
  pollMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fn();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  await fn();
}

const fakeClients: Array<FakeClient> = [];

// When > 0, the next N FakeClient.connect() calls reject (simulating a DB
// cold-start / restart blip). Decremented per failed connect. Reset per test.
let failConnectsRemaining = 0;
// When > 0, the next N FakeClient.query() calls reject (simulating a LISTEN
// failure right after a successful connect). Decremented per failed query.
let failQueriesRemaining = 0;

class FakeClient {
  notificationListeners: Array<(msg: { channel: string; payload: string }) => void> = [];
  errorListeners: Array<(err: Error) => void> = [];
  connectCalls = 0;
  endCalls = 0;
  queries: string[] = [];
  ended = false;

  async connect() {
    this.connectCalls++;
    if (failConnectsRemaining > 0) {
      failConnectsRemaining--;
      throw new Error('connect failed (simulated cold-start)');
    }
  }
  on(event: string, cb: (...args: unknown[]) => void) {
    if (event === 'notification') this.notificationListeners.push(cb as never);
    if (event === 'error') this.errorListeners.push(cb as never);
  }
  async query(sql: string) {
    if (failQueriesRemaining > 0) {
      failQueriesRemaining--;
      throw new Error('LISTEN failed (simulated)');
    }
    this.queries.push(sql);
  }
  async end() {
    this.endCalls++;
    this.ended = true;
  }
  // Test helpers (not part of pg.Client API)
  fireNotification(channel: string, payload: object) {
    if (this.ended) return;
    this.notificationListeners.forEach((l) =>
      l({ channel, payload: JSON.stringify(payload) }),
    );
  }
  fireError(err: Error) {
    this.errorListeners.forEach((l) => l(err));
  }
}

vi.mock('pg', () => ({
  Client: class {
    constructor() {
      const c = new FakeClient();
      fakeClients.push(c);
      return c as unknown as never;
    }
  },
}));

// Import AFTER vi.mock so the mocked Client is what postgres-listener uses.
const importListener = async () => {
  vi.resetModules();
  fakeClients.length = 0;
  // Reset module state so each test gets a fresh singleton
  return import('./postgres-listener');
};

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
  fakeClients.length = 0;
  failConnectsRemaining = 0;
  failQueriesRemaining = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('postgres-listener (Phase B1)', () => {
  it('subscribe() registers listener; NOTIFY fires it with parsed payload', async () => {
    const { subscribe } = await importListener();
    const received: Array<unknown> = [];
    await subscribe('audit_events_changed', (p) => {
      received.push(p);
    });
    // First fakeClient was instantiated lazily on subscribe()
    expect(fakeClients.length).toBe(1);
    fakeClients[0].fireNotification('audit_events_changed', {
      id: 'evt_1',
      action: 'budget_plan_create',
      organizationId: 'org_1',
      createdAt: '2026-04-28T00:00:00Z',
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      id: 'evt_1',
      action: 'budget_plan_create',
      organizationId: 'org_1',
      createdAt: '2026-04-28T00:00:00Z',
    });
  });

  it('multiple subscribers on same channel all fire', async () => {
    const { subscribe } = await importListener();
    const a: unknown[] = [];
    const b: unknown[] = [];
    await subscribe('audit_events_changed', (p) => a.push(p));
    await subscribe('audit_events_changed', (p) => b.push(p));
    fakeClients[0].fireNotification('audit_events_changed', { id: 'x', action: 'a', organizationId: 'o', createdAt: 't' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('unsubscribe() removes only the corresponding listener', async () => {
    const { subscribe } = await importListener();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsubA = await subscribe('audit_events_changed', (p) => a.push(p));
    await subscribe('audit_events_changed', (p) => b.push(p));
    unsubA();
    fakeClients[0].fireNotification('audit_events_changed', { id: 'x', action: 'a', organizationId: 'o', createdAt: 't' });
    expect(a).toHaveLength(0); // unsubscribed
    expect(b).toHaveLength(1); // still active
  });

  it('REGRESSION (Round-1 ⚠️ #1): on client.error, existing subscribers keep receiving NOTIFY via new client', async () => {
    const { subscribe } = await importListener();
    const received: unknown[] = [];
    await subscribe('audit_events_changed', (p) => received.push(p));
    // Initial NOTIFY works
    fakeClients[0].fireNotification('audit_events_changed', { id: 'before', action: 'a', organizationId: 'o', createdAt: 't' });
    expect(received).toHaveLength(1);
    // Simulate connection drop
    fakeClients[0].fireError(new Error('connection lost'));
    // Poll until reconnect completes — the void getClient() inside the
    // error handler races with this assertion. Pre-fix: only 1 fakeClient
    // would ever exist; post-fix: a new fakeClient is created during the
    // error handler. Polling avoids brittle setTimeout-based timing.
    await waitForCondition(() => expect(fakeClients.length).toBe(2));
    expect(fakeClients[0].ended).toBe(true);
    // The new client re-issued LISTEN on both channels
    expect(fakeClients[1].queries).toContain('LISTEN audit_events_changed');
    expect(fakeClients[1].queries).toContain('LISTEN indicator_values_changed');
    // CRITICAL: existing listener still in shared Map → NOTIFY on NEW client fires the SAME listener
    fakeClients[1].fireNotification('audit_events_changed', { id: 'after', action: 'a', organizationId: 'o', createdAt: 't' });
    expect(received).toHaveLength(2);
    expect((received[1] as { id: string }).id).toBe('after');
  });

  it('REGRESSION (terminal-audit P1): a first-connect rejection does NOT poison the singleton — next subscribe() retries a fresh connection', async () => {
    const { subscribe } = await importListener();
    // First connect rejects (DB cold-start blip at first subscribe after deploy).
    failConnectsRemaining = 1;
    await expect(
      subscribe('audit_events_changed', () => {}),
    ).rejects.toThrow(/connect failed/);
    // First attempt created a client whose connect rejected.
    expect(fakeClients.length).toBe(1);
    // Pre-fix: clientPromise held the cached REJECTED promise, so this second
    // subscribe() would re-throw forever and never create a new client.
    // Post-fix: the singleton was reset, so a fresh connect succeeds.
    const received: unknown[] = [];
    await subscribe('audit_events_changed', (p) => received.push(p));
    expect(fakeClients.length).toBe(2);
    // The recovered client re-issued LISTEN and routes NOTIFY to the listener.
    expect(fakeClients[1].queries).toContain('LISTEN audit_events_changed');
    fakeClients[1].fireNotification('audit_events_changed', {
      id: 'recovered',
      action: 'a',
      organizationId: 'o',
      createdAt: 't',
    });
    expect(received).toHaveLength(1);
    expect((received[0] as { id: string }).id).toBe('recovered');
  });

  it('REGRESSION (terminal-audit P1): a LISTEN-query rejection (connect ok) also resets the singleton', async () => {
    const { subscribe } = await importListener();
    // connect() succeeds; the first LISTEN query rejects — exercised by the
    // same try/catch, since the 'error' event handler does not fire on a
    // query() promise rejection.
    failQueriesRemaining = 1;
    await expect(
      subscribe('indicator_values_changed', () => {}),
    ).rejects.toThrow(/LISTEN failed/);
    expect(fakeClients.length).toBe(1);
    expect(fakeClients[0].ended).toBe(true); // half-open client torn down
    // Singleton reset → next subscribe builds a fresh, fully-listening client.
    const received: unknown[] = [];
    await subscribe('indicator_values_changed', (p) => received.push(p));
    expect(fakeClients.length).toBe(2);
    expect(fakeClients[1].queries).toContain('LISTEN indicator_values_changed');
    fakeClients[1].fireNotification('indicator_values_changed', {
      id: 'iv_1',
      indicatorId: 'ind_1',
      companyId: 'c_1',
      organizationId: 'o_1',
      status: 'red',
      period: '2026',
    });
    expect(received).toHaveLength(1);
  });

  it('malformed NOTIFY payload (non-JSON) is silently dropped, not crashed', async () => {
    const { subscribe } = await importListener();
    const received: unknown[] = [];
    await subscribe('audit_events_changed', (p) => received.push(p));
    // Fire raw payload bypassing JSON.stringify
    fakeClients[0].notificationListeners.forEach((l) =>
      l({ channel: 'audit_events_changed', payload: 'not-json' }),
    );
    expect(received).toHaveLength(0);
  });
});
