/**
 * Phase 5.2 — AsyncLocalStorage context for the active request's orgId.
 *
 * Foundation layer for [docs/ADR-RLS.md](../../../docs/ADR-RLS.md) Stage 1
 * precondition #7. The intent is to thread `orgId` through the request
 * implicitly so nested data-access helpers don't all need to take an
 * orgId argument.
 *
 * ## Usage
 *
 * ```ts
 * // At the top of a route handler:
 * import { runWithOrgScope, getCurrentOrgId } from "@/lib/db/org-scope-context"
 *
 * export async function GET(req: NextRequest) {
 *   const session = await getSession(req)
 *   return runWithOrgScope(session.orgId, async () => {
 *     // Any code in this async tree can now read getCurrentOrgId()
 *     // without prop-drilling the orgId arg.
 *     return doMatrixComputation()
 *   })
 * }
 * ```
 *
 * Combined with `withOrgScope(orgId, fn)`: that helper opens the
 * Postgres transaction + emits SET LOCAL. The ALS context provides
 * the orgId source for `withOrgScope()` callers that don't already
 * have it threaded through arguments.
 *
 * ## Deferred to Architect Round-2
 *
 * The architect Round-1 brief proposed an automatic Prisma
 * `$extends({query})` middleware that would read ALS + wrap every
 * query in a transaction with SET LOCAL — making RLS coverage
 * automatic for every route without explicit `withOrgScope` calls.
 *
 * Prisma's `$extends({query})` does NOT support pre-query
 * transaction wrapping out-of-the-box (the query callback runs INSIDE
 * the implicit transaction Prisma opens; we can't open our own around
 * it). Workarounds: (a) batch into `prisma.$transaction([raw, query])`
 * arrays per call; (b) use `$use` middleware (deprecated in Prisma 6,
 * removed in some preview features); (c) accept that explicit
 * `withOrgScope` wrap is the only safe path.
 *
 * **Pending architect Round-2 decision** on whether to pursue an
 * automatic extension (high engineering cost, uncertain feasibility)
 * or commit to the explicit-wrapper-per-route approach (500-1000
 * mechanical edits, but well-understood).
 *
 * This module ships the ALS context regardless — it's useful for
 * threading orgId through nested helpers even if we end with the
 * explicit-wrapper path.
 */

import { AsyncLocalStorage } from "node:async_hooks"

interface OrgScopeContext {
  orgId: string
}

const orgScopeStore = new AsyncLocalStorage<OrgScopeContext>()

/**
 * Run `fn` with `orgId` available via `getCurrentOrgId()` in any
 * downstream async work. The context is propagated automatically
 * across `await` boundaries; it does NOT cross out of the `fn`
 * callback.
 *
 * Pattern: call once at the top of an API route handler, after
 * `getSession()` resolves. All nested data access can then use
 * `withOrgScope(getCurrentOrgId(), ...)` without prop-drilling.
 */
export function runWithOrgScope<T>(
  orgId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!orgId || orgId.trim() === "") {
    throw new Error("runWithOrgScope: orgId is required")
  }
  // Same cuid-shape guard as `withOrgScope` (defense-in-depth: catches
  // a misconfigured fixture passing a short id before it can land in
  // a SET LOCAL statement downstream).
  if (!/^[a-z0-9]{20,32}$/i.test(orgId)) {
    throw new Error(
      `runWithOrgScope: orgId must be a 20-32 char cuid-shaped string; got ${JSON.stringify(orgId)}`,
    )
  }
  return orgScopeStore.run({ orgId }, fn)
}

/**
 * Read the orgId set by the nearest enclosing `runWithOrgScope` call.
 * Returns `null` when called outside any scope — caller must decide
 * whether that's an error or a legitimate cron/admin path.
 */
export function getCurrentOrgId(): string | null {
  return orgScopeStore.getStore()?.orgId ?? null
}

/**
 * Like `getCurrentOrgId()` but throws if no scope is active. Use this
 * in code that must NEVER run outside a request context (most data
 * access).
 */
export function requireCurrentOrgId(): string {
  const orgId = getCurrentOrgId()
  if (!orgId) {
    throw new Error(
      "requireCurrentOrgId: no orgId in scope. Wrap your handler in runWithOrgScope(orgId, ...) first.",
    )
  }
  return orgId
}
