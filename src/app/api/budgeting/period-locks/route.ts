/**
 * Phase 7.G Turn LXX (Phase 4.2 closure) — admin API for period locks.
 *
 * GET — list current org's lockedPeriods (any authenticated org member;
 *       same exposure-level rationale as /api/organizations/settings:
 *       the lock state is already user-visible via 423 responses, so
 *       reading the configured list adds no privilege).
 * POST — add a lock (admin-only; CFO close action). Body: {period, reason?}.
 *        Idempotent: re-adding an already-locked period preserves the
 *        original lockedAt/lockedBy (matches `addPeriodLock` semantics).
 * DELETE — remove a lock (admin-only; re-open trail). Body: {period}.
 *          Idempotent: removing a non-existent lock is a no-op 200.
 *
 * Audit: POST emits `period_lock_add`, DELETE emits `period_lock_remove`.
 * Both are awaited (compliance-grade events; CFO needs to know if the
 * audit row didn't write so they can re-trigger the action).
 *
 * Rate-limit: 10/min keyed on userId. Same as org-settings PATCH.
 *
 * Period validation: must match `parsePeriod` regex — "YYYY" / "YYYY-Q[1-4]"
 * / "YYYY-MM". Any other shape returns 400 (defensive — the equality-only
 * matching engine has no notion of bad inputs, so we screen at the API
 * boundary).
 */

import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireAuth, requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { enforceRateLimit } from "@/lib/rate-limit"
import { getLogger } from "@/lib/log"

// Phase 8 D4 final (2026-05-29) — structured logger.
const log = getLogger("api:budgeting:period-locks")
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import {
  parseLockedPeriods,
  addPeriodLock,
  removePeriodLock,
  findLockForPeriod,
  type LockedPeriod,
} from "@/lib/budgeting/period-lock"
import type { Prisma } from "@prisma/client"

const RATE_LIMIT = { name: "period-locks", max: 10, windowMs: 60_000 }

/** Period format gate — matches `parsePeriod` from `src/lib/risk/periods.ts`. */
const PERIOD_REGEX = /^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/

const addBodySchema = z
  .object({
    period: z.string().regex(PERIOD_REGEX, {
      message: "period must be YYYY / YYYY-Q[1-4] / YYYY-MM",
    }),
    reason: z.string().max(500).optional(),
  })
  .strict()

const removeBodySchema = z
  .object({
    period: z.string().regex(PERIOD_REGEX, {
      message: "period must be YYYY / YYYY-Q[1-4] / YYYY-MM",
    }),
  })
  .strict()

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId
  // Stage 3 RLS — org + snapshot reads in one org-scoped tx.
  const result = await withOrgScope(orgId, async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { lockedPeriods: true },
    })
    if (!org) return null
    const locks = parseLockedPeriods(org.lockedPeriods)

    // Financial-truth-infra Phase L10 — enrich each lock with its latest
    // PeriodSnapshot row (signed-off hash + aggregates) so the admin
    // periods page can show "Revenue 50.6M, signed by X on Y" alongside
    // the lock entry. Sequential findFirst per period (tx serializes on
    // one connection — no Promise.all parallelism inside an interactive tx).
    const snapshots: Array<{ period: string; snapshot: unknown }> = []
    for (const lock of locks) {
      const snap = await tx.periodSnapshot.findFirst({
        where: { organizationId: orgId, period: lock.period },
        orderBy: { signedAt: "desc" },
        select: {
          id: true,
          signedAt: true,
          signedBy: true,
          ivHash: true,
          budgetHash: true,
          aggregates: true,
        },
      })
      snapshots.push({ period: lock.period, snapshot: snap })
    }
    return { locks, snapshots }
  })
  if (!result) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  }
  const snapshotByPeriod = Object.fromEntries(
    result.snapshots.map((s) => [s.period, s.snapshot]),
  )

  return NextResponse.json({ locks: result.locks, snapshots: snapshotByPeriod })
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  let parsed
  try {
    parsed = addBodySchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const orgId = session.orgId
  const newLock: LockedPeriod = {
    period: parsed.period,
    lockedAt: new Date().toISOString(),
    lockedBy: session.userId,
    reason: parsed.reason,
  }

  // Stage 3 RLS — org read, lock update, snapshot + audit in one
  // org-scoped tx (snapshot hashing reads IV + BudgetLine, so give it
  // headroom over the 5s default).
  const outcome = await withOrgScope(
    orgId,
    async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: orgId },
        select: { id: true, lockedPeriods: true },
      })
      if (!org) return { notFound: true as const }

      const currentLocks = parseLockedPeriods(org.lockedPeriods)
      const nextLocks = addPeriodLock(currentLocks, newLock)

      // addPeriodLock is idempotent — re-add returns input unchanged. Detect
      // the no-op so the API can return 200 + isNew=false for the UI to surface
      // "already locked since ..." instead of a misleading 201.
      const wasNew = nextLocks.length !== currentLocks.length

      await tx.organization.update({
        where: { id: org.id },
        data: { lockedPeriods: nextLocks as unknown as Prisma.InputJsonValue },
      })

      // Financial-truth-infra Phase E.1 — when a period is newly locked,
      // also persist an immutable PeriodSnapshot (SHA-256 of all IV +
      // BudgetLine rows scoped to that period). Failure is non-fatal — the
      // lock committed; surface `snapshotStale` so the admin UI flags it.
      let snapshotStale = false
      if (wasNew) {
        try {
          const { createPeriodSnapshot } = await import("@/lib/budgeting/period-snapshot")
          await createPeriodSnapshot(tx, orgId, parsed.period, session.userId, parsed.reason ?? null)
        } catch (e) {
          log.error("snapshot create failed", {
            period: parsed.period,
            err: e instanceof Error ? e.message : String(e),
          })
          snapshotStale = true
        }
      }

      // Audit emission — awaited (compliance-grade).
      let auditStale = false
      if (wasNew) {
        const auditResult = await logAuditEvent(tx, {
          organizationId: orgId,
          actorUserId: session.userId,
          event: {
            action: "period_lock_add",
            entityType: "Organization",
            entityId: org.id,
            metadata: {
              period: parsed.period,
              reason: parsed.reason,
            },
          },
          context: buildAuditContext({
            route: "/api/budgeting/period-locks",
            userAgent: req.headers.get("user-agent") ?? undefined,
          }),
        })
        if (!auditResult.ok) auditStale = true
      }

      return { wasNew, nextLocks, snapshotStale, auditStale }
    },
    { timeoutMs: 20_000 },
  )

  if ("notFound" in outcome) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  }

  const responseBody: {
    lock: LockedPeriod
    isNew: boolean
    auditStale?: boolean
    snapshotStale?: boolean
  } = {
    lock: findLockForPeriod(outcome.nextLocks, parsed.period) ?? newLock,
    isNew: outcome.wasNew,
  }
  if (outcome.auditStale) responseBody.auditStale = true
  if (outcome.snapshotStale) responseBody.snapshotStale = true

  return NextResponse.json(responseBody, { status: outcome.wasNew ? 201 : 200 })
}

export async function DELETE(req: NextRequest) {
  const session = await requireRole(req, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  let parsed
  try {
    parsed = removeBodySchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const orgId = session.orgId
  // Stage 3 RLS — org read, lock removal + audit in one org-scoped tx.
  const outcome = await withOrgScope(orgId, async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { id: true, lockedPeriods: true },
    })
    if (!org) return { notFound: true as const }

    const currentLocks = parseLockedPeriods(org.lockedPeriods)
    const removedLock = findLockForPeriod(currentLocks, parsed.period)
    const nextLocks = removePeriodLock(currentLocks, parsed.period)

    // removePeriodLock is idempotent — non-existent removal is no-op.
    const wasRemoved = nextLocks.length !== currentLocks.length

    if (wasRemoved) {
      await tx.organization.update({
        where: { id: org.id },
        data: { lockedPeriods: nextLocks as unknown as Prisma.InputJsonValue },
      })
    }

    let auditStale = false
    if (wasRemoved && removedLock) {
      const auditResult = await logAuditEvent(tx, {
        organizationId: orgId,
        actorUserId: session.userId,
        event: {
          action: "period_lock_remove",
          entityType: "Organization",
          entityId: org.id,
          metadata: {
            period: parsed.period,
            removedLock: {
              lockedAt: removedLock.lockedAt,
              lockedBy: removedLock.lockedBy,
              reason: removedLock.reason,
            },
          },
        },
        context: buildAuditContext({
          route: "/api/budgeting/period-locks",
          userAgent: req.headers.get("user-agent") ?? undefined,
        }),
      })
      if (!auditResult.ok) auditStale = true
    }

    return { wasRemoved, auditStale }
  })

  if ("notFound" in outcome) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  }

  const responseBody: { period: string; removed: boolean; auditStale?: boolean } = {
    period: parsed.period,
    removed: outcome.wasRemoved,
  }
  if (outcome.auditStale) responseBody.auditStale = true

  return NextResponse.json(responseBody, { status: 200 })
}
