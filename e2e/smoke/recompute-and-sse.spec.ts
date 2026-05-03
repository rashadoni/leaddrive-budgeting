/**
 * Phase 7.G Turn D.3 — Recompute pipeline + SSE event E2E smoke.
 *
 * Locks the load-bearing real-time push infrastructure end-to-end:
 *   - POST /api/indicators (manager role) recompute API contract
 *   - SSE /api/events/stream long-lived connection
 *   - Postgres LISTEN/NOTIFY trigger → SSE event delivery to browser
 *
 * Without these tests, the entire production claim from
 * `docs/DESIGN_SSE_SERVERLESS.md` (recommendation = stay on Option C
 * because it works on Docker Compose) is unverified at runtime —
 * just code-review-and-pray.
 *
 * Test scope (3 cases):
 *   1. POST /api/indicators with single (companyId, indicatorCode)
 *      → returns 200 + recompute result shape (locks API contract)
 *   2. SSE /api/events/stream opens + emits 'hello' event within 5s
 *      (locks basic transport against accidental endpoint regression)
 *   3. SSE → recompute trigger → 'indicator:changed' event arrives
 *      end-to-end (locks the entire LISTEN/NOTIFY pipeline)
 *
 * Test 3 is the load-bearing case — it's the only test in the suite
 * that proves Postgres trigger → pg_notify → singleton pg.Client →
 * SSE handler → ReadableStream → browser EventSource works in real
 * production.
 */

import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

test.describe('Phase 7.G smoke — recompute + SSE', () => {
  test('POST /api/indicators with single target returns 200 + correct shape', async ({
    page,
    request,
  }) => {
    // Need session cookie for the API call — login via the page
    // context first, then reuse cookies on the request.
    await loginAs(page);

    // Pick a real (companyId, indicatorCode) pair from the matrix
    // endpoint so we know it exists in DB.
    const matrixRes = await request.get('/api/indicators/matrix?period=2026', {
      headers: { cookie: (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ') },
    });
    expect(matrixRes.status()).toBe(200);
    const matrix = await matrixRes.json();
    expect(matrix.companies?.length, 'matrix must have ≥1 company').toBeGreaterThan(0);
    expect(matrix.indicators?.length, 'matrix must have ≥1 indicator').toBeGreaterThan(0);

    const company = matrix.companies.find((c: { isSubgroup?: boolean }) => !c.isSubgroup);
    expect(company, 'expected ≥1 operational (non-subgroup) company').toBeTruthy();
    const indicator = matrix.indicators[0];

    // POST /api/indicators with the narrow target.
    const postRes = await request.post('/api/indicators', {
      headers: {
        cookie: (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; '),
        'content-type': 'application/json',
      },
      data: {
        period: '2026',
        companyId: company.id,
        indicatorCode: indicator.code,
      },
    });

    expect(
      postRes.status(),
      `POST /api/indicators should return 200 for valid (company, indicator) target; got ${postRes.status()}`,
    ).toBe(200);

    const body = await postRes.json();
    // Lock the response shape per `src/app/api/indicators/route.ts:289-292`:
    //   { period, processed, ok, unknown, error, results }
    expect(body, 'response should include period').toHaveProperty('period');
    expect(body.period).toBe('2026');
    expect(body, 'response should include processed count').toHaveProperty(
      'processed',
    );
    expect(typeof body.processed).toBe('number');
    expect(
      body.processed,
      'expected ≥1 processed since we narrowed to a real pair',
    ).toBeGreaterThan(0);
    expect(body, 'response should include ok/unknown/error counters').toMatchObject({
      ok: expect.any(Number),
      unknown: expect.any(Number),
      error: expect.any(Number),
    });
    expect(Array.isArray(body.results), 'results should be an array').toBe(true);
    expect(body.results.length).toBe(body.processed);
  });

  test('SSE /api/events/stream opens + emits hello event within 5s', async ({ page }) => {
    await loginAs(page);

    // Open EventSource in browser context (so cookies are sent).
    // Resolve when the first 'hello' event arrives or reject after 5s.
    const helloPayload = await page.evaluate(async () => {
      return new Promise<{ orgId?: string; ts?: number; error?: string }>(
        (resolve) => {
          const es = new EventSource('/api/events/stream');
          const timeoutId = setTimeout(() => {
            es.close();
            resolve({ error: 'no hello event within 5s' });
          }, 5000);
          es.addEventListener('hello', (ev: MessageEvent) => {
            clearTimeout(timeoutId);
            es.close();
            try {
              resolve(JSON.parse(ev.data));
            } catch (err) {
              resolve({ error: `hello payload not JSON: ${String(err)}` });
            }
          });
          es.addEventListener('error', () => {
            // EventSource reconnects on error; we treat error-before-
            // hello as the failure mode worth reporting.
            // Don't reject here — let the timeout fire if hello never
            // comes; reconnect-loop is acceptable for the smoke.
          });
        },
      );
    });

    expect(
      helloPayload.error,
      `expected 'hello' SSE event; instead saw error: ${helloPayload.error}`,
    ).toBeUndefined();
    expect(
      helloPayload.orgId,
      'hello event should include orgId (server-emitted at sendEvent("hello", {orgId, ts: Date.now()})',
    ).toBeTruthy();
    expect(typeof helloPayload.ts).toBe('number');
  });

  test('end-to-end LISTEN/NOTIFY: recompute → indicator:changed event arrives via SSE', async ({
    page,
    request,
  }) => {
    await loginAs(page);

    // Pick a real target from the matrix.
    const cookies = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    const matrixRes = await request.get('/api/indicators/matrix?period=2026', {
      headers: { cookie: cookies },
    });
    const matrix = await matrixRes.json();
    const company = matrix.companies.find((c: { isSubgroup?: boolean }) => !c.isSubgroup);
    const indicator = matrix.indicators[0];

    // Open SSE in browser context, register listener for
    // indicator:changed BEFORE triggering the recompute (to avoid
    // race where event fires before subscribe lands). Then resolve
    // the promise from inside Node by triggering the recompute via
    // request.post() and waiting for the in-browser EventSource to
    // capture the matching event.
    //
    // Pattern: open SSE → wait for hello (proves subscribe done) →
    // trigger recompute → wait for indicator:changed.
    const result = await page.evaluate(
      async ({ companyId, period, indicatorCode }) => {
        return new Promise<{
          helloOk: boolean;
          changedOk: boolean;
          changedEvent: { id?: string; companyId?: string; indicatorId?: string; status?: string; period?: string } | null;
          error?: string;
        }>((resolve) => {
          const es = new EventSource('/api/events/stream');
          let helloOk = false;
          const timeoutId = setTimeout(() => {
            es.close();
            resolve({
              helloOk,
              changedOk: false,
              changedEvent: null,
              error: helloOk
                ? 'hello arrived but no indicator:changed within 30s'
                : 'no hello event within 30s',
            });
          }, 30_000);

          es.addEventListener('hello', async () => {
            helloOk = true;
            // Now trigger recompute. The server-side recompute path
            // upserts IndicatorValue → trigger fires pg_notify →
            // postgres-listener forwards → our SSE handler emits
            // indicator:changed.
            try {
              const res = await fetch('/api/indicators', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ period, companyId, indicatorCode }),
              });
              if (!res.ok) {
                clearTimeout(timeoutId);
                es.close();
                resolve({
                  helloOk,
                  changedOk: false,
                  changedEvent: null,
                  error: `recompute POST returned ${res.status}`,
                });
              }
            } catch (err) {
              clearTimeout(timeoutId);
              es.close();
              resolve({
                helloOk,
                changedOk: false,
                changedEvent: null,
                error: `recompute POST threw: ${String(err)}`,
              });
            }
          });

          es.addEventListener('indicator:changed', (ev: MessageEvent) => {
            try {
              const payload = JSON.parse(ev.data);
              // Filter to OUR change (avoid false positive from
              // unrelated background recompute that may be running).
              if (
                payload.companyId === companyId
              ) {
                clearTimeout(timeoutId);
                es.close();
                resolve({
                  helloOk,
                  changedOk: true,
                  changedEvent: payload,
                });
              }
            } catch (err) {
              // Don't resolve on parse error — keep waiting for a
              // valid event within the timeout.
            }
          });
        });
      },
      { companyId: company.id, period: '2026', indicatorCode: indicator.code },
    );

    expect(result.error, `LISTEN/NOTIFY pipeline error: ${result.error}`).toBeUndefined();
    expect(result.helloOk, 'expected hello event before triggering recompute').toBe(true);
    expect(
      result.changedOk,
      'expected indicator:changed event for the targeted company within 30s',
    ).toBe(true);
    expect(result.changedEvent?.companyId).toBe(company.id);
    expect(result.changedEvent?.period).toBe('2026');
    expect(result.changedEvent?.status).toMatch(/^(green|amber|red|unknown)$/);
  });
});
