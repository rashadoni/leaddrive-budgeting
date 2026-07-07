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
 * Bypass for admin / system scripts:
 *   await withOrgScope(orgId, fn, { bypass: true })
 *   → sets `app.bypass_rls = 'true'` so policies short-circuit.
 *
 * IMPORTANT: tables NOT yet covered by RLS migrations behave
 * identically with or without this wrapper — adoption is
 * incremental. Apply to high-traffic / cross-tenant sensitive
 * tables first (indicator_values, companies, audit_events).
 */

import { prisma as defaultPrisma } from "@/lib/prisma"
import { getPrismaApp } from "@/lib/db/prisma-app"
import type { Prisma, PrismaClient } from "@prisma/client"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("db:with-org-scope")

type Tx = Omit<
  ReturnType<typeof defaultPrisma.$transaction>,
  "$on" | "$connect" | "$disconnect" | "$use" | "$extends" | "$transaction"
>

interface WithOrgScopeOpts {
  /** When true, sets app.bypass_rls=true so policies short-circuit. */
  bypass?: boolean
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
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL "app.organization_id" = '${organizationId}'`,
    )
    if (opts.bypass) {
      // Phase 5.2 Stage 2 Round-2 verdict (2026-05-21) — bypass via
      // `withOrgScope` is deprecated. Use the dedicated `prismaAdmin`
      // client (`src/lib/db/prisma-admin.ts`) backed by the
      // `DATABASE_URL_ADMIN` connection string. The bypass flag stays
      // wired for 2 weeks so existing cron / migration callers keep
      // working; remove on the Stage 2 closure PR (2026-06-04).
      log.warn(
        "bypass:true is deprecated. Use `prismaAdmin` from @/lib/db/prisma-admin for cross-org / cron / migration paths.",
      )
      await tx.$executeRawUnsafe(`SET LOCAL "app.bypass_rls" = 'true'`)
    }
    return fn(tx)
  }, txOptions)
}

// Re-export the Tx type for callers that want to type their fn arg.
export type { Tx }
