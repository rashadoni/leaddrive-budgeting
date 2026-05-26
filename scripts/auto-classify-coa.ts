/**
 * Phase 2.1 polish (2026-05-26) — auto-classify ChartOfAccount rows
 * with `role IS NULL` or `role = 'unknown'` using the shared
 * `deriveRoleFromCode` helper. Only updates rows where derivation
 * returns a non-'unknown' classification (i.e. the code matches a
 * known SAP prefix).
 *
 * Background: after Session 1's auto-upsert wired into AI Auto Import
 * handlers, every NEW CoA row creates with role='unknown' for admin
 * reclassification. Many of those codes follow the standard 6xx/7xx
 * convention (601 revenue / 701 cogs / 711 opex / etc.) and can be
 * auto-classified without admin intervention.
 *
 * Idempotent: re-running on already-classified data is a no-op
 * (the script only touches rows where role IS NULL or 'unknown').
 *
 * Usage:
 *   npx tsx scripts/auto-classify-coa.ts            # dry-run (default)
 *   npx tsx scripts/auto-classify-coa.ts --execute  # apply updates
 */

import { PrismaClient } from "@prisma/client"
import { deriveRoleFromCode } from "../src/lib/budgeting/coa-role"

const prisma = new PrismaClient()
const EXECUTE = process.argv.includes("--execute")

/**
 * Two-pass classifier:
 *   1. Try `deriveRoleFromCode` (matches legacy SAP 6xx/7xx prefixes).
 *   2. If that returns 'unknown', fall back to `accountType` mapping
 *      (revenue → revenue, cogs → cogs, expense → opex — the default
 *      P&L bucket for unclassified opex). Asset/liability/equity codes
 *      stay 'unknown' because P&L role doesn't apply to balance-sheet
 *      accounts.
 */
function classify(code: string, accountType: string | null): string {
  const fromCode = deriveRoleFromCode(code)
  if (fromCode !== "unknown") return fromCode
  if (accountType === "revenue") return "revenue"
  if (accountType === "cogs") return "cogs"
  if (accountType === "expense") return "opex"
  // asset / liability / equity → P&L role doesn't apply
  return "unknown"
}

async function main(): Promise<void> {
  console.log(
    `[auto-classify-coa] mode: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`,
  )

  const candidates = await prisma.chartOfAccount.findMany({
    where: { OR: [{ role: null }, { role: "unknown" }] },
    select: { id: true, code: true, role: true, accountType: true },
  })
  console.log(`[auto-classify-coa] ${candidates.length} candidates`)

  const buckets: Record<string, number> = {
    revenue: 0,
    cogs: 0,
    opex: 0,
    finance: 0,
    tax_costs: 0,
    non_operating: 0,
    tax: 0,
    "unchanged (still unknown — BS account)": 0,
  }
  const toUpdate: Array<{ id: string; newRole: string }> = []

  for (const row of candidates) {
    const derived = classify(row.code, row.accountType)
    if (derived === "unknown") {
      buckets["unchanged (still unknown — BS account)"]++
      continue
    }
    buckets[derived] = (buckets[derived] ?? 0) + 1
    toUpdate.push({ id: row.id, newRole: derived })
  }

  console.log("\nBuckets:")
  for (const [k, v] of Object.entries(buckets)) {
    if (v > 0) console.log(`  ${k.padEnd(30)} ${String(v).padStart(5)}`)
  }
  console.log(`\nWould update: ${toUpdate.length} rows`)

  if (!EXECUTE) {
    console.log("[auto-classify-coa] dry-run; re-run with --execute to apply.")
    return
  }

  if (toUpdate.length === 0) {
    console.log("[auto-classify-coa] nothing to update.")
    return
  }

  // Group by new role for batch updates.
  const byRole = new Map<string, string[]>()
  for (const u of toUpdate) {
    if (!byRole.has(u.newRole)) byRole.set(u.newRole, [])
    byRole.get(u.newRole)!.push(u.id)
  }
  let updated = 0
  for (const [role, ids] of byRole.entries()) {
    const r = await prisma.chartOfAccount.updateMany({
      where: { id: { in: ids } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { role: role as any },
    })
    updated += r.count
    console.log(`  ✓ ${role.padEnd(15)} ${r.count} rows updated`)
  }
  console.log(`\n[auto-classify-coa] total updated: ${updated}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
