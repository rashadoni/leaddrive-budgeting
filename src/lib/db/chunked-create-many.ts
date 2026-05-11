/**
 * Phase 7.G Turn CXXIII (Phase 1.1 — chunked savepoints) — chunked
 * `createMany` helper with PostgreSQL SAVEPOINTs per chunk.
 *
 * Closes the long-deferred ROADMAP §1.1 item «Split into chunks with
 * savepoints every 5000 rows». Used by `import-excel/route.ts` (and any
 * future bulk-insert call site) to:
 *   - Bound per-statement payload size (DB locks shorter, memory predictable)
 *   - Make intermediate progress observable in `pg_stat_activity`
 *   - Wrap each chunk in a SAVEPOINT so a failed chunk rolls back to its
 *     starting point instead of poisoning the OUTER transaction state
 *
 * **Outer-transaction contract:** the OUTER `prisma.$transaction` still
 * wraps the entire operation. If the helper re-throws (chunk-level
 * failure that ROLLBACK TO SAVEPOINT recovered to), the outer transaction
 * still aborts → all prior chunks (released savepoints) roll back too.
 * Atomicity preserved end-to-end. The savepoint mechanic is about
 * leaving the transaction state CLEAN after a chunk failure (so further
 * statements in the same transaction don't hit "current transaction is
 * aborted, commands ignored until end of transaction block").
 *
 * **Small-payload optimization:** when `data.length <= chunkSize`, skip
 * SAVEPOINT entirely — direct createMany call. SAVEPOINT overhead is ~1ms
 * per name; not worth it for sub-5000-row imports (the typical AZMADE
 * case has ~500 rows per company).
 *
 * **Why raw SQL for SAVEPOINT:** Prisma doesn't expose SAVEPOINT in its
 * typed API. `tx.$executeRawUnsafe('SAVEPOINT name')` is the canonical
 * escape hatch. SQL injection risk is zero — savepoint names are
 * hardcoded prefix + numeric chunk index, never user input.
 */

import type { Prisma } from "@prisma/client"

/** Minimal delegate interface — works with any Prisma model that has
 *  `createMany`. Using a structural interface (not a full
 *  `Prisma.<Model>Delegate`) keeps the helper polymorphic over all tables. */
export interface CreateManyDelegate<T> {
  createMany: (args: { data: T[]; skipDuplicates?: boolean }) => Promise<unknown>
}

export interface ChunkedCreateManyOptions {
  /** Rows per chunk. Default 5000. Below this, no savepoint overhead. */
  chunkSize?: number
  /** Pass-through to Prisma createMany. Default false (caller decides). */
  skipDuplicates?: boolean
  /** Prefix for SAVEPOINT name (must match SQL identifier rules: letters,
   *  digits, underscores, no leading digit). Defaults to "chunk". Suffix
   *  is `_<index>` (0-indexed). */
  savepointPrefix?: string
}

export interface ChunkedCreateManyResult {
  /** Total rows passed to createMany (across all chunks). */
  totalInserted: number
  /** Number of chunks executed. 0 when data is empty. 1 when below
   *  chunkSize (and skipped savepoint). */
  chunkCount: number
  /** Whether SAVEPOINT was used (false on small-payload optimization path). */
  usedSavepoints: boolean
}

const DEFAULT_CHUNK_SIZE = 5000
const SAVEPOINT_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Insert `data` via the supplied Prisma delegate's `createMany`, splitting
 * into chunks of `chunkSize` rows. Wraps each chunk in a PostgreSQL
 * SAVEPOINT so a chunk failure rolls back ONLY that chunk's writes (and
 * re-throws to let the OUTER transaction decide whether to abort fully).
 *
 * Small payloads (≤ chunkSize) skip SAVEPOINT entirely.
 *
 * @throws on any chunk's createMany failure (after ROLLBACK TO SAVEPOINT).
 */
export async function chunkedCreateMany<T>(
  tx: Prisma.TransactionClient,
  delegate: CreateManyDelegate<T>,
  data: T[],
  opts: ChunkedCreateManyOptions = {},
): Promise<ChunkedCreateManyResult> {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE
  const skipDuplicates = opts.skipDuplicates
  const savepointPrefix = opts.savepointPrefix ?? "chunk"

  if (chunkSize < 1) {
    throw new Error(`chunkedCreateMany: chunkSize must be ≥ 1 (got ${chunkSize})`)
  }
  if (!SAVEPOINT_NAME_REGEX.test(savepointPrefix)) {
    throw new Error(
      `chunkedCreateMany: savepointPrefix must match /^[A-Za-z_][A-Za-z0-9_]*$/ (got "${savepointPrefix}")`,
    )
  }

  if (data.length === 0) {
    return { totalInserted: 0, chunkCount: 0, usedSavepoints: false }
  }

  // Small-payload fast path: no chunking, no savepoint
  if (data.length <= chunkSize) {
    await delegate.createMany({ data, skipDuplicates })
    return { totalInserted: data.length, chunkCount: 1, usedSavepoints: false }
  }

  // Chunked path with SAVEPOINTs
  let totalInserted = 0
  let chunkCount = 0
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize)
    const sp = `${savepointPrefix}_${chunkCount}`
    await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`)
    try {
      await delegate.createMany({ data: chunk, skipDuplicates })
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`)
      totalInserted += chunk.length
      chunkCount += 1
    } catch (err) {
      // Roll back to before this chunk; outer transaction still decides
      // whether to abort entirely. Re-throw so caller's $transaction
      // propagates the failure.
      try {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`)
      } catch {
        // If rollback itself fails (transaction already aborted),
        // swallow — the original error is more informative.
      }
      throw err
    }
  }

  return { totalInserted, chunkCount, usedSavepoints: true }
}
