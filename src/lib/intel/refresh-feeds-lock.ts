import { Client } from "pg"

// Stable namespace-specific bigint. Session advisory locks are intentionally
// global to the database: a VM timer, direct curl and a future second host must
// all contend on the same key before any provider I/O starts.
export const REFRESH_FEEDS_LOCK_KEY = "73194622810417"

interface AdvisoryLockClient {
  connect(): Promise<unknown>
  query<T extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
  end(): Promise<void>
}

export interface RefreshFeedsLock {
  acquired: boolean
  release(): Promise<void>
}

export type RefreshFeedsLockClientFactory = () => AdvisoryLockClient

function defaultClientFactory(): AdvisoryLockClient {
  const connectionString =
    process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_ADMIN or DATABASE_URL is required for refresh-feeds lock",
    )
  }
  return new Client({ connectionString })
}

/**
 * Hold a PostgreSQL session advisory lock on one dedicated connection.
 *
 * Prisma pool queries cannot safely acquire and release a session lock because
 * the two statements may run on different connections. This helper owns one
 * pg Client until `release()`, and closing that client is the final fail-safe
 * that releases the lock even if `pg_advisory_unlock` itself errors.
 */
export async function acquireRefreshFeedsLock(
  createClient: RefreshFeedsLockClientFactory = defaultClientFactory,
): Promise<RefreshFeedsLock> {
  const client = createClient()
  await client.connect()

  let acquired = false
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [REFRESH_FEEDS_LOCK_KEY],
    )
    acquired = result.rows[0]?.locked === true
  } catch (error) {
    await client.end()
    throw error
  }

  let released = false
  return {
    acquired,
    async release(): Promise<void> {
      if (released) return
      released = true
      try {
        if (acquired) {
          await client.query(
            "SELECT pg_advisory_unlock($1::bigint) AS unlocked",
            [REFRESH_FEEDS_LOCK_KEY],
          )
        }
      } finally {
        await client.end()
      }
    },
  }
}
