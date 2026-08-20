/**
 * Reusable API-route test harness for Next.js App Router handlers.
 *
 * Background: route files (`src/app/api/**\/route.ts`) transitively import
 * `@/lib/auth` → `next-auth`, which crashes vitest's node ESM resolver
 * with "Cannot find module 'next/server'" (next-auth's internal helper
 * uses subpath imports vitest doesn't honor). We sidestep the entire
 * next-auth chain by stubbing `@/lib/auth` in the consuming test file:
 *
 * ```ts
 * import { vi } from 'vitest';
 * vi.mock('@/lib/auth', () => ({
 *   auth: vi.fn(),  // configured per-test via mockSession()
 * }));
 * import { mockSession, makeRequest, makePrisma } from '@/test/api-harness';
 * import { PATCH } from '@/app/api/companies/[id]/route';
 * ```
 *
 * The harness exposes three primitives:
 *
 *  - `mockSession({ orgId, userId, role, ... } | null)` — sets the
 *    session that the next `requireAuth` / `requireRole` call will see.
 *    Pass `null` to simulate an unauthenticated caller.
 *
 *  - `makeRequest(url, init)` — builds a `NextRequest` with sensible
 *    defaults (POST/PATCH bodies are JSON-encoded automatically when
 *    `init.json` is provided).
 *
 *  - `makePrisma(overrides)` — a lazy proxy returning `vi.fn()` for
 *    every accessed model.method, so tests only set the methods they
 *    actually exercise. `overrides` lets a test pre-stub a specific
 *    method without writing the full proxy boilerplate.
 *
 * The harness intentionally does NOT mock `@/lib/prisma` automatically —
 * that's the test's job, since the mock shape changes per route. We
 * provide `makePrisma()` as a builder, the test wires it via its own
 * `vi.mock('@/lib/prisma', ...)`.
 */

import { NextRequest } from 'next/server';
import { vi, type MockInstance } from 'vitest';

/** Shape returned by `getSession` in `@/lib/api-auth`. */
export interface MockedSession {
  orgId: string;
  userId: string;
  role: 'admin' | 'manager' | 'editor' | 'viewer';
  email?: string;
  name?: string;
}

/**
 * Configure what the next Auth.js lookup (inside `requireAuth` /
 * `requireRole`) will see. Supports both the Server Component `auth()` form
 * and the App Router `auth(handler)` form used by the shared API helper.
 * `null` simulates an unauthenticated caller.
 *
 * Resolves the mocked `@/lib/auth` module dynamically so callers don't
 * have to import the mock symbol themselves.
 */
export async function mockSession(session: MockedSession | null): Promise<void> {
  const authModule = await import('@/lib/auth');
  // The session shape `getSession` reads is `{ user: { id, email, name,
  // role, organizationId } }` (see `src/lib/api-auth.ts:13-30`). We mirror
  // that exactly so the production accessor code is the thing under test.
  const value = session
    ? {
        user: {
          id: session.userId,
          email: session.email ?? `${session.userId}@test.local`,
          name: session.name ?? 'Test User',
          role: session.role,
          organizationId: session.orgId,
        },
      }
    : null;
  // `auth` is mocked at the test file's top via `vi.mock('@/lib/auth', ...)`.
  // Preserve the zero-arg behavior for Server Components, while the handler
  // overload decorates the explicit request exactly as Auth.js does.
  (authModule.auth as unknown as MockInstance).mockImplementation(
    (handler?: unknown) => {
      if (typeof handler !== 'function') return Promise.resolve(value);
      return async (req: NextRequest, context: unknown) => {
        const authenticatedRequest = Object.assign(req, { auth: value });
        return (handler as (
          request: NextRequest & { auth: typeof value },
          context: unknown,
        ) => unknown)(authenticatedRequest, context);
      };
    },
  );
}

export interface MakeRequestInit extends Omit<RequestInit, 'body'> {
  /** Convenience: when set, JSON-encoded into body + content-type set. */
  json?: unknown;
}

/**
 * Build a `NextRequest` with sane defaults.
 *
 * Accepts a relative path (`/api/companies/abc`) which is resolved
 * against a fake origin so `NextRequest`'s URL parser doesn't reject it.
 */
export function makeRequest(
  pathOrUrl: string,
  init: MakeRequestInit = {},
): NextRequest {
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `http://localhost${pathOrUrl}`;
  const { json, headers, ...rest } = init;
  const finalHeaders = new Headers(headers);
  let body: BodyInit | undefined;
  if (json !== undefined) {
    body = JSON.stringify(json);
    if (!finalHeaders.has('content-type')) {
      finalHeaders.set('content-type', 'application/json');
    }
  }
  // Cast: NextRequest's RequestInit is stricter on `signal` than the lib
  // dom types — `null` is permitted by Web Fetch but not by Next's typing.
  // We never pass `signal: null` from the harness, so the cast is safe.
  // TODO: drop once Next's RequestInit accepts signal: null.
  const initForNext = {
    ...rest,
    headers: finalHeaders,
    body,
  } as unknown as ConstructorParameters<typeof NextRequest>[1];
  return new NextRequest(url, initForNext);
}

/**
 * Lazy Prisma mock — every accessed `prisma.<model>.<method>` is a fresh
 * `vi.fn()` that returns `undefined` by default. Tests override only what
 * they exercise. Pre-stubbed values can be passed via `overrides`:
 *
 * ```ts
 * const prisma = makePrisma({
 *   company: {
 *     findFirst: vi.fn().mockResolvedValue({ id: 'c1', code: 'AAC', role: 'operational' }),
 *   },
 * });
 * ```
 */
export type MockPrisma = Record<string, Record<string, ReturnType<typeof vi.fn>>>;

export function makePrisma(overrides: Partial<MockPrisma> = {}): MockPrisma {
  const cache: MockPrisma = {};
  return new Proxy(cache, {
    get(target, modelName: string) {
      if (typeof modelName !== 'string') return undefined;
      if (!target[modelName]) {
        // Seed the per-model proxy with a copy of the overrides for this
        // model (if any), then layer auto-`vi.fn()` over MISSING methods.
        // The earlier implementation replaced the whole model with the
        // overrides bag and lost auto-fn fallback for unspecified methods
        // — a test that overrode `company.findFirst` then called
        // `company.update` got `undefined`. Layering fixes that.
        const seeded: Record<string, ReturnType<typeof vi.fn>> = {
          ...(overrides[modelName] ?? {}),
        };
        target[modelName] = new Proxy(seeded, {
          get(modelTarget, methodName: string) {
            if (typeof methodName !== 'string') return undefined;
            if (!modelTarget[methodName]) {
              modelTarget[methodName] = vi.fn();
            }
            return modelTarget[methodName];
          },
        });
      }
      return target[modelName];
    },
  }) as MockPrisma;
}
