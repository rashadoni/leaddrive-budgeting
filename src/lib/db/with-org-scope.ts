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

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type Tx = Omit<
  ReturnType<typeof prisma.$transaction>,
  "$on" | "$connect" | "$disconnect" | "$use" | "$extends" | "$transaction"
>

interface WithOrgScopeOpts {
  /** When true, sets app.bypass_rls=true so policies short-circuit. */
  bypass?: boolean
}

export async function withOrgScope<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: WithOrgScopeOpts = {},
): Promise<T> {
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
      // eslint-disable-next-line no-console
      console.warn(
        "[withOrgScope] bypass:true is deprecated. Use `prismaAdmin` from " +
          "@/lib/db/prisma-admin for cross-org / cron / migration paths.",
      )
      await tx.$executeRawUnsafe(`SET LOCAL "app.bypass_rls" = 'true'`)
    }
    return fn(tx)
  })
}

// Re-export the Tx type for callers that want to type their fn arg.
export type { Tx }
