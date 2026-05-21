/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 5.2 Stage 2 — admin Prisma client backed by the BYPASSRLS role.
 *
 * The default `prisma` from `src/lib/prisma.ts` connects via
 * `DATABASE_URL` (regular non-BYPASSRLS role). Per ADR Round-2,
 * the following callers MUST use `prismaAdmin` instead:
 *
 *   • Cron / scheduler scripts that cross orgs
 *     (e.g. scripts/intel-scheduler-bootstrap.ts, scripts/compute-sparklines.ts)
 *   • Background workers performing cross-org maintenance
 *     (e.g. archive prune, drift watchdog, smoke tests)
 *   • Prisma migration scripts
 *     (prisma migrate dev / deploy invoked via Bash subshell with
 *      DATABASE_URL=$DATABASE_URL_ADMIN)
 *
 * Falls back to the regular `prisma` client when `DATABASE_URL_ADMIN`
 * is not set, with a one-time console.warn — keeps single-tenant
 * single-machine setups working unchanged during the rollout.
 */
import { prisma as defaultPrisma } from "@/lib/prisma"

let cached: typeof defaultPrisma | null = null
let warned = false

export function getPrismaAdmin(): typeof defaultPrisma {
  if (cached) return cached
  const adminUrl = process.env.DATABASE_URL_ADMIN
  if (!adminUrl) {
    if (!warned) {
      console.warn(
        "[prisma-admin] DATABASE_URL_ADMIN not set — falling back to default prisma. " +
          "RLS-protected tables will require explicit withOrgScope() in this process.",
      )
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
    datasourceUrl: adminUrl,
  }) as unknown as typeof defaultPrisma
  return cached
}

/** Convenience alias mirroring the codebase's `prisma` import style. */
export const prismaAdmin = getPrismaAdmin()
