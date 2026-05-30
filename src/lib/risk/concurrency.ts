/**
 * Order-preserving, concurrency-capped async map — no external deps.
 *
 * Runs `fn` over `items` with at most `limit` promises in flight, preserving
 * input order in the result array. Used to parallelize the per-(company,
 * indicator) recompute loops (scenario re-derivation + matrix preview) ~5-8×
 * over a sequential loop while staying well under the Prisma connection pool.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()))
  return results
}
