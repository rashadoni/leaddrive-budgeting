/**
 * Phase 2.1 polish (2026-05-26) — bulk recompute all AZSEKER
 * (company × indicator × 2026) pairs after Session 2 re-import + CoA
 * role auto-classify. Ensures HeatMap reflects the canonical FK-joined
 * P&L classification (revenue/cogs/opex via account.role) instead of
 * stale pre-import values.
 *
 * One-shot script. Caller for the cron handler is
 * `src/lib/risk/recompute-trigger.ts:runRecomputeForCompanies`.
 */

import { PrismaClient } from "@prisma/client"
import { runRecomputeForCompanies } from "../src/lib/risk/recompute-trigger"

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { slug: "azmade" },
    select: { id: true, slug: true, name: true },
  })
  if (!org) throw new Error("No 'azmade' org found")
  console.log(`[polish-recompute] org=${org.slug} (${org.name})`)

  const cos = await prisma.company.findMany({
    where: { organizationId: org.id, code: { startsWith: "AZSEKER" }, level: 2, isActive: true },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  })
  const affected = cos.map((c) => ({ companyId: c.id, year: 2026 }))
  console.log(
    `[polish-recompute] ${cos.length} operational AZSEKER entities × 2026:`,
    cos.map((c) => c.code).join(", "),
  )

  const startedAt = Date.now()
  // RecomputeTriggerLogger callbacks: start/done take a free-form
  // string label; pairError takes (label, err: unknown).
  const result = await runRecomputeForCompanies(prisma, org.id, affected, {
    start: (msg) => console.log(`  → ${msg}`),
    done: (msg) => console.log(`  ✓ ${msg}`),
    pairError: (label, err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ ${label}: ${msg}`)
    },
  })
  const durationMs = Date.now() - startedAt
  console.log(
    `\n[polish-recompute] result: ${JSON.stringify(result)} in ${durationMs}ms`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
