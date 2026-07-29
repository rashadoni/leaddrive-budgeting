/**
 * Phase 11.8 (2026-07-29) — mutual exclusion for AI Auto Import.
 *
 * The defect this closes
 * ──────────────────────
 * `/api/import/ai-auto-multi` had exactly ONE guard against concurrency: a
 * rate limit of 10 requests per hour. That permits ten simultaneous applies.
 * No `ImportStaging` row was claimed, no advisory lock was taken, and no
 * `DataRevision` was written — unlike the legacy staging routes, which do
 * claim their row race-safely (`updateMany({ where: { id, status: 'pending' }})`
 * + `if (claim.count !== 1) throw 'STAGING_RACE'`).
 *
 * Under READ COMMITTED that is not theoretical. Every import batch is
 * clean-slate: archive the rows in scope, then insert. Two concurrent imports
 * of the same scope interleave as
 *
 *   A: archive N rows → insert N rows
 *   B: archive 0 rows (A already archived them) → insert N rows
 *
 * leaving a full DUPLICATE set. `assertNoCollateralDeletion` cannot catch it:
 * that guard fires on over-deletion, and B under-deleted. None of the target
 * tables carries a unique constraint that would have rejected the second copy
 * either.
 *
 * Why a dedicated connection
 * ──────────────────────────
 * A `pg_advisory_xact_lock` inside the orchestrator would only serialize ONE
 * group's transaction — the multi-file orchestrator commits each file-type
 * group in its own transaction, so two imports could still interleave between
 * groups. The lock has to span the whole request, which means a SESSION lock,
 * which means one pinned connection: Prisma's pool may run the acquire and the
 * release on different connections, and a session lock released on the wrong
 * connection is not released at all. Same reasoning as
 * `src/lib/intel/refresh-feeds-lock.ts`, whose shape this mirrors.
 *
 * Scope: `(organizationId, year)`. Two orgs, or the same org importing
 * different years, proceed in parallel — they clean-slate disjoint row sets.
 */
import { Client } from "pg"

interface AdvisoryLockClient {
  connect(): Promise<unknown>
  query<T extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
  end(): Promise<void>
}

export interface ImportLock {
  acquired: boolean
  /** Human-readable scope, for the 409 body and logs. */
  scope: string
  release(): Promise<void>
}

export type ImportLockClientFactory = () => AdvisoryLockClient

function defaultClientFactory(): AdvisoryLockClient {
  const connectionString =
    process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_ADMIN or DATABASE_URL is required for the import lock",
    )
  }
  return new Client({ connectionString })
}

/** Lock key text. `hashtext()` maps it to the bigint the lock API wants. */
export function importLockScope(organizationId: string, year: number): string {
  return `ai-import:${organizationId}:${year}`
}

/**
 * Try to take the import lock for `(organizationId, year)`.
 *
 * Non-blocking by design: a second import must be REFUSED with a clear
 * message, not silently queued behind a multi-minute LLM + apply run whose
 * clean-slate would then race the first one's inserts anyway.
 *
 * Always `release()` in a `finally` — the caller owns a real connection until
 * it does. Closing the client is the fail-safe if the unlock itself errors.
 */
export async function acquireImportLock(
  organizationId: string,
  year: number,
  createClient: ImportLockClientFactory = defaultClientFactory,
): Promise<ImportLock> {
  const scope = importLockScope(organizationId, year)
  const client = createClient()
  await client.connect()

  let acquired = false
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [scope],
    )
    acquired = result.rows[0]?.locked === true
  } catch (error) {
    await client.end()
    throw error
  }

  let released = false
  return {
    acquired,
    scope,
    async release(): Promise<void> {
      if (released) return
      released = true
      try {
        if (acquired) {
          await client.query(
            "SELECT pg_advisory_unlock(hashtext($1)) AS unlocked",
            [scope],
          )
        }
      } finally {
        await client.end()
      }
    },
  }
}
