/**
 * Phase 5.2 — Postgres row-level security helper.
 *
 * Wraps a block of Prisma calls in a transaction that sets the
 * tenant session variable `app.organization_id`. RLS policies on
 * org-scoped tables read this variable to filter rows server-side.
 *
 * Usage:
 *   const matrix = await withOrgScope(orgId, async (tx) => {
 *     return tx.indicatorValue.findMany({ where: { ... } })
 *   })
 *
 * Why a transaction: `SET LOCAL` only persists for the duration of
 * the surrounding txn — perfect for connection pooling. The `SET`
 * (without LOCAL) would leak to subsequent queries on the same
 * pooled connection (silent cross-tenant exposure).
 *
 * Admin / cross-organization work must use the dedicated `prismaAdmin`
 * client backed by PostgreSQL's native BYPASSRLS role. A user-settable custom
 * GUC is never an authorization boundary.
 */

import { prisma as defaultPrisma } from "@/lib/prisma"
import { getPrismaApp } from "@/lib/db/prisma-app"
import type { Prisma, PrismaClient } from "@prisma/client"
type Tx = Omit<
  ReturnType<typeof defaultPrisma.$transaction>,
  "$on" | "$connect" | "$disconnect" | "$use" | "$extends" | "$transaction"
>

interface WithOrgScopeOpts {
  /**
   * Override the Prisma client used for the transaction.
   * Defaults to the RLS-enforced app client (DATABASE_URL_APP). Pass an
   * explicit client to exercise a specific role in integration tests.
   */
  client?: PrismaClient
  /**
   * Stage 3 — interactive-tx timeout override (ms). Prisma's default is
   * 5000, too tight for multi-month derive/recompute loops. Use for
   * routes doing bounded-but-long DB work; NEVER to accommodate non-DB
   * slow work (LLM calls, file parses) — split those out of the scope.
   */
  timeoutMs?: number
  /** Pool-acquire wait override (ms; Prisma default 2000). */
  maxWaitMs?: number
}

export async function withOrgScope<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: WithOrgScopeOpts = {},
): Promise<T> {
  // Stage 3 (2026-07-07) — default flipped from the global superuser
  // client to the RLS-ENFORCED app client (DATABASE_URL_APP). Falls
  // back to the global client when the app URL is unset (dev machines
  // mid-rollout / prod pre-provisioning) — see prisma-app.ts.
  const prisma = opts.client ?? getPrismaApp()
  if (!organizationId || organizationId.trim() === "") {
    throw new Error("withOrgScope: organizationId is required")
  }
  // Validate to prevent SQL injection — the orgId is interpolated
  // into a SET LOCAL statement (parameterized form not supported by
  // SET). cuid() ids are alphanumeric, 20-32 chars (default cuid is 25).
  //
  // Phase 5.2 architect review 2026-05-16 — tightened from `[a-z0-9]+`
  // to length-bound `{20,32}` to prevent a misconfigured test fixture
  // passing a single-char id like "x". A short id passes the original
  // charset guard, runs without error, but matches zero rows once RLS
  // is enabled — silent breakage (empty arrays returned where data was
  // expected). The length bound catches this fixture-class footgun
  // at the helper boundary.
  if (!/^[a-z0-9]{20,32}$/i.test(organizationId)) {
    throw new Error(
      `withOrgScope: organizationId must be a 20-32 char cuid-shaped string; got ${JSON.stringify(organizationId)}`,
    )
  }

  const txOptions =
    opts.timeoutMs || opts.maxWaitMs
      ? {
          ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
          ...(opts.maxWaitMs ? { maxWait: opts.maxWaitMs } : {}),
        }
      : undefined
  // Fail closed for stale JavaScript callers compiled before the option was
  // removed. TypeScript rejects it at compile time; this guard prevents an
  // untyped caller from believing it still received cross-org access.
  if (Object.prototype.hasOwnProperty.call(opts, "bypass")) {
    throw new Error(
      "withOrgScope: bypass option was removed; use prismaAdmin for explicit cross-org work",
    )
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL "app.organization_id" = '${organizationId}'`,
    )
    return fn(tx)
  }, txOptions)
}

// Re-export the Tx type for callers that want to type their fn arg.
export type { Tx }
