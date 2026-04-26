/**
 * Phase 7.F (Turn 13) — dev-time stale-Prisma-client detector.
 *
 * Catches the class of bug Turn 12 hit: a Prisma migration adds a new
 * model (`AuditEvent`), the schema is regenerated locally, but the
 * LaunchAgent dev-server's Node process holds the OLD `@prisma/client`
 * in module cache. Any code calling `prisma.auditEvent.*` then fails
 * with an opaque HTTP 500 — no error in `~/Library/Logs/budgetpro.log`,
 * just a stack trace inside Next.js's error overlay.
 *
 * What this module does:
 *   - On first import (NODE_ENV=development only), spawns an async
 *     check that compares `Prisma.dmmf.datamodel.models[].dbName` (the
 *     TypeScript-known model list) against `information_schema.tables`
 *     (the DB reality).
 *   - Logs a clear warning to console if any model is missing from
 *     either side, with a hint to run `launchctl kickstart` /
 *     `npx prisma generate`.
 *   - Production: bails immediately. The check is dev-ergonomics, not
 *     a runtime contract.
 *
 * Async + global-flag guard: the check fires once per Node process,
 * doesn't block any request, and never throws (errors are logged and
 * swallowed). If the DB is unreachable when we run, we silently retry
 * never — the error would be the user's first request anyway, and the
 * point of this detector is to surface schema drift, not network
 * health.
 */

import { Prisma } from "@prisma/client"
import type { PrismaClient } from "@prisma/client"

interface GlobalWithFlag {
  __devPrismaCheckRan?: boolean
}

const globalFlag = globalThis as unknown as GlobalWithFlag

interface SchemaTablesRow {
  table_name: string
}

/**
 * Compare Prisma DMMF model list (TS knowledge) vs actual DB tables.
 * Returns the missing-on-each-side sets so the caller can log them.
 */
async function diffModelsVsTables(
  prisma: PrismaClient,
): Promise<{ missingInDb: string[]; extraInDb: string[] }> {
  const dmmfTables = new Set(
    Prisma.dmmf.datamodel.models.map((m) => m.dbName ?? m.name),
  )

  const rows = await prisma.$queryRaw<SchemaTablesRow[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE '\\_prisma\\_%'
  `

  const dbTables = new Set(rows.map((r) => r.table_name))

  const missingInDb: string[] = []
  for (const t of dmmfTables) {
    if (!dbTables.has(t)) missingInDb.push(t)
  }

  const extraInDb: string[] = []
  for (const t of dbTables) {
    if (!dmmfTables.has(t)) extraInDb.push(t)
  }

  return { missingInDb, extraInDb }
}

/**
 * Fire-and-forget startup check. Idempotent across hot-reloads via the
 * `__devPrismaCheckRan` global. Bails on production. Errors are logged
 * but never thrown.
 */
export function startDevPrismaCheck(prisma: PrismaClient): void {
  if (process.env.NODE_ENV === "production") return
  if (globalFlag.__devPrismaCheckRan) return
  globalFlag.__devPrismaCheckRan = true

  // Defer to next tick so we don't block the importing module.
  void Promise.resolve()
    .then(() => diffModelsVsTables(prisma))
    .then(({ missingInDb, extraInDb }) => {
      if (missingInDb.length === 0 && extraInDb.length === 0) return

      const lines: string[] = [
        "[dev-prisma-check] Schema/DB drift detected:",
      ]
      if (missingInDb.length > 0) {
        lines.push(
          `  Models in Prisma client but NOT in DB: ${missingInDb.join(", ")}`,
          `    → run: npx prisma migrate deploy   (then restart dev server)`,
        )
      }
      if (extraInDb.length > 0) {
        lines.push(
          `  Tables in DB but NOT in Prisma client: ${extraInDb.join(", ")}`,
          `    → run: npx prisma generate          (then restart dev server)`,
          `    OR: launchctl kickstart -k gui/501/com.budgetpro.dev`,
        )
      }
      lines.push(
        "  This warning is dev-only. Production builds skip the check.",
      )
      console.warn(lines.join("\n"))
    })
    .catch((err) => {
      // DB not reachable / permissions / introspection failure — not
      // worth blocking the app over. Log once and move on.
      console.warn(
        "[dev-prisma-check] Could not verify schema/DB consistency:",
        err instanceof Error ? err.message : String(err),
      )
    })
}

// Exported for unit tests; not part of the public API.
export { diffModelsVsTables }
