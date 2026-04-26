/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Prisma client with multi-tenant extensions.
 *
 * NOTE: PrismaClient will be available after `npx prisma generate` is run
 * (requires network for engine download). Until then, this exports a placeholder.
 * Run `npx prisma generate` after Docker setup (Task 0.16).
 */

let PrismaClientClass: any

try {
  PrismaClientClass = require("@prisma/client").PrismaClient
} catch {
  // PrismaClient not generated yet — provide stub for build
  PrismaClientClass = class StubPrismaClient {
    $extends() { return this }
  }
}

const globalForPrisma = globalThis as unknown as { prisma: InstanceType<typeof PrismaClientClass> }

const basePrisma = globalForPrisma.prisma ?? new PrismaClientClass()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = basePrisma

export const prisma = basePrisma

// Phase 7.F (Turn 13) — dev-only stale-Prisma-client detector. Fires once
// per Node process, async, never throws. Catches the Turn 12 class of
// bug where a `prisma migrate` left the dev-server's @prisma/client
// out of sync (new models 500 silently). Lazy-import keeps the
// production bundle clean — `dev-prisma-check.ts` references DMMF
// metadata that's server-only.
//
// `typeof window === 'undefined'` guard: Next.js bundles `@/lib/prisma`
// imports for both server and client (because legacy code uses
// `prisma` symbol from this module in places that get tree-shaken on
// the client). Without the window check, the module loads in the
// browser too and `Prisma.dmmf` is undefined → spurious console warnings.
if (
  process.env.NODE_ENV !== "production" &&
  typeof window === "undefined"
) {
  void import("./dev-prisma-check")
    .then(({ startDevPrismaCheck }) => startDevPrismaCheck(basePrisma))
    .catch(() => {
      // Stub PrismaClient (build-time without `prisma generate`) — silently skip.
    })
}

/**
 * Create a tenant-scoped prisma client.
 * All queries automatically filter by organizationId.
 * All creates automatically inject organizationId.
 */
export function tenantPrisma(organizationId: string) {
  return basePrisma.$extends({
    query: {
      $allModels: {
        async findMany({ args, query }: any) {
          args.where = { ...args.where, organizationId }
          return query(args)
        },
        async findFirst({ args, query }: any) {
          args.where = { ...args.where, organizationId }
          return query(args)
        },
        async findUnique({ args, query }: any) {
          const result = await query(args)
          // Verify tenant isolation: reject if result belongs to a different org
          if (result && "organizationId" in result && result.organizationId !== organizationId) {
            return null
          }
          return result
        },
        async create({ args, query }: any) {
          if (args.data && typeof args.data === "object" && !Array.isArray(args.data)) {
            args.data.organizationId = organizationId
          }
          return query(args)
        },
        async update({ args, query }: any) {
          args.where = { ...args.where, organizationId }
          return query(args)
        },
        async delete({ args, query }: any) {
          args.where = { ...args.where, organizationId }
          return query(args)
        },
        async count({ args, query }: any) {
          args.where = { ...args.where, organizationId }
          return query(args)
        },
      },
    },
  })
}

/** Fire-and-forget audit log entry */
export function logAudit(orgId: string, action: string, entityType: string, entityId: string, entityName?: string, extra?: { oldValue?: any; newValue?: any }) {
  prisma.auditLog.create({
    data: {
      organizationId: orgId,
      action,
      entityType,
      entityId,
      entityName: entityName || undefined,
      oldValue: extra?.oldValue || undefined,
      newValue: extra?.newValue || undefined,
    },
  }).catch(() => {})
}

/** Fire-and-forget budget change log for Time Machine */
export function logBudgetChange(opts: {
  orgId: string
  planId: string
  entityType: string
  entityId: string
  action: string
  field?: string
  oldValue?: any
  newValue?: any
  snapshot?: any
  userId?: string
}) {
  prisma.budgetChangeLog.create({
    data: {
      organizationId: opts.orgId,
      planId: opts.planId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      field: opts.field || undefined,
      oldValue: opts.oldValue ?? undefined,
      newValue: opts.newValue ?? undefined,
      snapshot: opts.snapshot ?? undefined,
      userId: opts.userId || undefined,
    },
  }).catch(() => {})
}
