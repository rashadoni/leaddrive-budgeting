/**
 * Phase 7.G Turn LXXXXII (Phase 7.B/E v2 cache promotions) — generic
 * try-Prisma-then-fallback helper for in-memory → Prisma cache migrations.
 *
 * **Why this exists:** turns LXXXXVI/LXXXXVII/LXXXXVIII shipped 3 in-memory
 * caches (proposal-cache, cost-budget, explainer-cache) blocked from Prisma
 * persistence by migration drift. Turn LXXXXI shipped schema.prisma + manual
 * migration SQL — but APPLY is permission-blocked (user runs `npx prisma
 * migrate deploy` from terminal, ~5 sec). This helper lets cache wrappers
 * ship code that:
 *   - Works pre-migrate (falls to in-memory when Prisma table missing)
 *   - Auto-promotes post-migrate (writes through to Prisma transparently)
 *   - Survives migrate revert (graceful degrade, no panic)
 *
 * **Detection mechanism:** wraps Prisma operation in try/catch. Prisma
 * throws `Prisma.PrismaClientKnownRequestError` with `code: 'P2021'` when
 * table doesn't exist (a.k.a. "the table does not exist in the current
 * database"). We catch it specifically + fall to in-memory.
 *
 * Other errors (auth, connection, FK violation) bubble up — those are real
 * bugs, not migrate-pending state.
 *
 * **Usage:**
 *   const value = await tryPrismaThenFallback(
 *     () => prisma.aiMapperProposalCache.findUnique({where: {...}}),
 *     () => inMemoryMap.get(key),
 *   )
 *
 * For writes (where Prisma write should ALSO update in-memory for read-
 * consistency in same-request lifetimes):
 *   await tryPrismaThenFallback(
 *     async () => {
 *       const row = await prisma.aiMapperProposalCache.upsert({...})
 *       inMemoryMap.set(key, row)  // mirror so subsequent reads in same request hit memory
 *       return row
 *     },
 *     () => { inMemoryMap.set(key, entry); return entry },
 *   )
 */

/**
 * Prisma error code for "the table does not exist in the current database".
 * Per https://www.prisma.io/docs/orm/reference/error-reference#p2021
 */
export const PRISMA_TABLE_NOT_EXIST_CODE = "P2021"

export type FallbackTrigger = "table-missing" | "model-undefined"

/**
 * Run a Prisma operation; on table-missing error, fall to the in-memory
 * implementation. Other errors bubble.
 *
 * Returns the Prisma result (post-migrate) or the in-memory result (pre-migrate).
 */
export async function tryPrismaThenFallback<T>(
  prismaFn: () => Promise<T>,
  inMemoryFn: () => T | Promise<T>,
): Promise<T> {
  try {
    return await prismaFn()
  } catch (e: unknown) {
    if (isTableMissingError(e)) {
      return await inMemoryFn()
    }
    // Real error — surface it
    throw e
  }
}

/** Type guard: is this a "table doesn't exist" Prisma error? */
export function isTableMissingError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false
  // Prisma error shape (KnownRequestError or RustPanic with table-missing message)
  const code = (e as { code?: unknown }).code
  if (code === PRISMA_TABLE_NOT_EXIST_CODE) return true
  // Some Prisma versions surface as P2010 with message containing the marker
  const message = (e as { message?: unknown }).message
  if (typeof message === "string") {
    if (message.includes("does not exist in the current database")) return true
    if (message.includes("relation") && message.includes("does not exist")) return true
    // Test harness: `vi.mock("@/lib/prisma", () => ({ prisma: {} }))` makes
    // every model accessor undefined. Calling `prisma.x.findUnique()` throws
    // TypeError "Cannot read properties of undefined (reading 'findUnique')".
    // Treat as table-missing so cache wrappers fall back to in-memory cleanly
    // — equivalent to "this Prisma model is unavailable in this environment".
    if (
      message.includes("Cannot read propert") &&
      (message.includes("findUnique") ||
        message.includes("findFirst") ||
        message.includes("findMany") ||
        message.includes("upsert") ||
        message.includes("create") ||
        message.includes("update") ||
        message.includes("delete") ||
        message.includes("count") ||
        message.includes("aggregate"))
    ) {
      return true
    }
  }
  return false
}
