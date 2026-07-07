/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 5.2 Stage 3 — RLS-ENFORCED Prisma client (the flip's workhorse).
 *
 * Mirrors `prisma-admin.ts` but points the other way: `DATABASE_URL_APP`
 * must connect as `budgetpro_app` (LOGIN, NOBYPASSRLS — provisioned by
 * scripts/sql/create-app-role.sql), so every `tenant_isolation` policy
 * actually filters rows. `withOrgScope` uses THIS client by default —
 * each wrapped route gets real DB-layer isolation the moment it is
 * wrapped, without flipping the global client (see
 * docs/RLS_STAGE3_FLIP_PLAN.md, Decision 1).
 *
 * Falls back to the default `prisma` client (superuser today) when
 * `DATABASE_URL_APP` is unset, with a one-time warning — dev machines
 * and the not-yet-provisioned prod keep working during the rollout.
 * In production the fallback is logged at ERROR level: it means the
 * flip is incomplete and RLS is NOT enforcing.
 */
import { prisma as defaultPrisma } from "@/lib/prisma"
import { getLogger } from "@/lib/log"

const log = getLogger("db:prisma-app")

let cached: typeof defaultPrisma | null = null
let warned = false
let asserted = false

export function getPrismaApp(): typeof defaultPrisma {
  if (cached) return cached
  // Unit tests mock `@/lib/prisma` and MUST NOT be handed a real client
  // just because the runner's env carries DATABASE_URL_APP (dotenv leaks
  // through some import graphs). The RLS integration test passes its own
  // client explicitly via `opts.client`, so it is unaffected.
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    cached = defaultPrisma
    return cached
  }
  const appUrl = process.env.DATABASE_URL_APP
  if (!appUrl) {
    if (!warned) {
      const msg =
        "DATABASE_URL_APP not set — withOrgScope falls back to the default client. " +
        "RLS policies are NOT enforced in this process (Stage 3 flip incomplete)."
      if (process.env.NODE_ENV === "production") log.error(msg)
      else log.warn(msg)
      warned = true
    }
    cached = defaultPrisma
    return cached
  }
  let PrismaClientClass: any
  try {
    PrismaClientClass = require("@prisma/client").PrismaClient
  } catch {
    cached = defaultPrisma
    return cached
  }
  cached = new PrismaClientClass({
    datasourceUrl: appUrl,
  }) as unknown as typeof defaultPrisma

  // Boot-time role assertion (fire-and-forget, first use only): the whole
  // Stage-3 guarantee rests on this connection NOT having BYPASSRLS. If a
  // misconfigured URL points at the superuser, say so loudly.
  if (!asserted && typeof window === "undefined") {
    asserted = true
    void (cached as any)
      .$queryRawUnsafe(
        "SELECT current_user AS role, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user",
      )
      .then((rows: Array<{ role: string; rolbypassrls: boolean; rolsuper: boolean }>) => {
        const r = rows?.[0]
        if (!r) return
        if (r.rolbypassrls || r.rolsuper) {
          log.error(
            `DATABASE_URL_APP connects as "${r.role}" with BYPASSRLS/superuser — RLS is NOT enforced. Point it at budgetpro_app.`,
          )
        } else {
          log.info(`RLS-enforced client active as "${r.role}" (no bypass).`)
        }
      })
      .catch(() => {
        // Connection failures surface on the first real query; don't
        // crash module init over the assertion probe.
      })
  }
  return cached
}

/** Convenience alias mirroring `prismaAdmin`'s import style. */
export const prismaApp = getPrismaApp()
