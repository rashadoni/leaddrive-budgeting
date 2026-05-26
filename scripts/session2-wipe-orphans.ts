/**
 * Phase 2.1 session 2 (2026-05-26) — one-shot wipe of orphan rows
 * (accountId IS NULL) across the 4 ledger tables that Session 3 will
 * migrate to NOT NULL.
 *
 * Authorized by user 2026-05-26: «потеря данных не проблема, эти все
 * файлы у нас в папке заново сможем загрузить». Pre-flight audit
 * showed 21895 orphan rows total:
 *
 *   budget_lines        | 12703
 *   cogs_budget_lines   |    72
 *   balance_sheet_lines |  8165
 *   cash_flow_entries   |  5955
 *
 * After Session 1 (commits 3aa5d9d / 902c399 / b9addba), every NEW
 * row written by the AI Auto Import handlers carries a real accountId
 * FK. The 21895 orphan rows above are the pre-Session-1 backlog that
 * the user will re-import via /budgeting/admin/ai-import multi-file
 * mode (Guvven Fin.xlsx + Çıxarışların uçotu.xlsx + Farming strategy -
 * Guvven.xlsx) once this wipe completes.
 *
 * Safety:
 *   - Dry-run by default. Use `--execute` to actually delete.
 *   - All 4 deletes run inside a single $transaction (atomic — either
 *     all 4 tables purge orphans or none do).
 *   - Cascade-via-FK applies for BudgetPlan-owned children, but these
 *     leaf rows don't carry their own children, so no fan-out beyond
 *     the row count printed.
 *   - Idempotent: a second run with --execute is safe (cleared table
 *     prints zero counts).
 *
 * Usage:
 *   npx tsx scripts/session2-wipe-orphans.ts            # dry-run (default)
 *   npx tsx scripts/session2-wipe-orphans.ts --execute  # commit deletes
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const EXECUTE = process.argv.includes("--execute")

interface OrphanCounts {
  budgetLines: number
  cogsBudgetLines: number
  balanceSheetLines: number
  cashFlowEntries: number
  total: number
}

async function countOrphans(): Promise<OrphanCounts> {
  const where = { accountId: null } as const
  const [
    budgetLines,
    cogsBudgetLines,
    balanceSheetLines,
    cashFlowEntries,
  ] = await Promise.all([
    prisma.budgetLine.count({ where }),
    prisma.cOGSBudgetLine.count({ where }),
    prisma.balanceSheetLine.count({ where }),
    prisma.cashFlowEntry.count({ where }),
  ])
  return {
    budgetLines,
    cogsBudgetLines,
    balanceSheetLines,
    cashFlowEntries,
    total:
      budgetLines + cogsBudgetLines + balanceSheetLines + cashFlowEntries,
  }
}

function printCounts(label: string, c: OrphanCounts): void {
  console.log(`\n${label}`)
  console.log(`  budget_lines        | ${String(c.budgetLines).padStart(6)}`)
  console.log(`  cogs_budget_lines   | ${String(c.cogsBudgetLines).padStart(6)}`)
  console.log(`  balance_sheet_lines | ${String(c.balanceSheetLines).padStart(6)}`)
  console.log(`  cash_flow_entries   | ${String(c.cashFlowEntries).padStart(6)}`)
  console.log(`  ─────────────────────────────────────`)
  console.log(`  TOTAL               | ${String(c.total).padStart(6)}`)
}

async function main(): Promise<void> {
  console.log(
    `[wipe-orphans] mode: ${EXECUTE ? "EXECUTE (will delete)" : "DRY-RUN (no writes)"}`,
  )

  const before = await countOrphans()
  printCounts("BEFORE — orphan rows (accountId IS NULL):", before)

  if (before.total === 0) {
    console.log(
      "\n[wipe-orphans] nothing to do — all rows already carry accountId FK.",
    )
    return
  }

  if (!EXECUTE) {
    console.log(
      "\n[wipe-orphans] dry-run complete. Re-run with --execute to commit.",
    )
    return
  }

  console.log("\n[wipe-orphans] EXECUTE: deleting inside a single transaction…")
  const startedAt = Date.now()
  const where = { accountId: null } as const
  const [bl, cogs, bs, cf] = await prisma.$transaction([
    prisma.budgetLine.deleteMany({ where }),
    prisma.cOGSBudgetLine.deleteMany({ where }),
    prisma.balanceSheetLine.deleteMany({ where }),
    prisma.cashFlowEntry.deleteMany({ where }),
  ])
  const durationMs = Date.now() - startedAt

  printCounts("DELETED:", {
    budgetLines: bl.count,
    cogsBudgetLines: cogs.count,
    balanceSheetLines: bs.count,
    cashFlowEntries: cf.count,
    total: bl.count + cogs.count + bs.count + cf.count,
  })
  console.log(`\n[wipe-orphans] tx committed in ${durationMs}ms`)

  const after = await countOrphans()
  printCounts("AFTER — orphan rows remaining:", after)

  if (after.total === 0) {
    console.log(
      "\n[wipe-orphans] ✓ DB is clean. Re-import via:",
    )
    console.log(
      "  1. /budgeting/admin/ai-import (multi-file mode) → drop:",
    )
    console.log("     - Guvven Fin.xlsx")
    console.log("     - Çıxarışların uçotu.xlsx")
    console.log("     - Farming strategy - Guvven.xlsx")
    console.log("  2. npx tsx scripts/import-risk-registry.ts")
    console.log("  3. npx tsx scripts/import-court-disputes.ts")
  } else {
    console.warn(
      `\n[wipe-orphans] ⚠️ ${after.total} orphan rows still present — investigate.`,
    )
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
