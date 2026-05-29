/**
 * Prisma client with multi-tenant extensions.
 *
 * NOTE: PrismaClient will be available after `npx prisma generate` is run
 * (requires network for engine download). Until then, this exports a placeholder.
 * Run `npx prisma generate` after Docker setup (Task 0.16).
 */

import type { PrismaClient as PrismaClientType, Prisma } from "@prisma/client"

// Phase 8 D3 final (2026-05-29) — retired the file-level `eslint-disable
// @typescript-eslint/no-explicit-any` + the `PrismaClientClass: any` /
// `prisma: any` exports. `prisma` is now strictly typed `PrismaClient`,
// so every consumer gets real model types instead of `any`. The latent
// bugs the `any` masked (dropped columns, missing models, null derefs)
// were fixed in separate commits ahead of this tighten.

interface PrismaCtor {
  new (): PrismaClientType
}

let PrismaClientClass: PrismaCtor

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PrismaClientClass = require("@prisma/client").PrismaClient as PrismaCtor
} catch {
  // PrismaClient not generated yet — provide stub for build. Only
  // `$extends` is callable on the stub instance; the `as unknown` bridge
  // satisfies the constructor shape without the full client type.
  PrismaClientClass = class StubPrismaClient {
    $extends() {
      return this
    }
  } as unknown as PrismaCtor
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClientType }

const basePrisma = globalForPrisma.prisma ?? new PrismaClientClass()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = basePrisma

export const prisma: PrismaClientType = basePrisma

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

// Phase 5.2 architect review 2026-05-16 — REMOVED `tenantPrisma()` orphan
// abstraction (0 production callers found via grep). It was a first-draft
// app-layer tenant guard that competed with the new Postgres-RLS direction
// (`src/lib/db/with-org-scope.ts` + the ALS+$extends middleware per
// `docs/ADR-RLS.md`). Keeping the orphan around would mislead future
// contributors into a third tenant-isolation pattern. RLS is the chosen
// path; explicit `withOrgScope()` is the cron/admin escape hatch.

// Phase 8 D3 final (2026-05-29) — removed dead `logAudit()`. It
// referenced `prisma.auditLog`, a model that does not exist in
// schema.prisma (the audit table is `AuditEvent`, written via
// `logAuditEvent` in `@/lib/audit/log` — 105 call sites). `logAudit`
// had 0 callers and its `prisma.auditLog.create()` would have thrown
// (caught by the `.catch(()=>{})`), so it never logged. The
// `prisma: any` export masked the missing-model error.

/** Fire-and-forget budget change log for Time Machine */
export function logBudgetChange(opts: {
  orgId: string
  planId: string
  entityType: string
  entityId: string
  action: string
  field?: string
  oldValue?: unknown
  newValue?: unknown
  snapshot?: unknown
  userId?: string
  // Phase 5.2 Stage 2 (2026-05-21) — optional tx so callers wrapped
  // in `withOrgScope` can route the write through their transaction
  // (SET LOCAL "app.organization_id" applies to RLS-protected
  // budget_change_logs once the migration lands). When omitted, falls
  // back to the global prisma client — preserves the fire-and-forget
  // contract for ~20 existing callsites.
  db?: typeof prisma
}) {
  const client = opts.db ?? prisma
  client.budgetChangeLog.create({
    data: {
      organizationId: opts.orgId,
      planId: opts.planId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      field: opts.field || undefined,
      oldValue: (opts.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (opts.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
      snapshot: (opts.snapshot ?? undefined) as Prisma.InputJsonValue | undefined,
      userId: opts.userId || undefined,
    },
  }).catch(() => {})
}
