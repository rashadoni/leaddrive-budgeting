#!/usr/bin/env tsx
/**
 * Phase 7.M Step 6 (2026-05-19) — recompute IndicatorValue rows for
 * AzerSheker after the workbook batch import.
 *
 * Why
 * ───
 * `runImportBatch` already accepts a `recompute` hook, but the import
 * script left it off so the bit-perfect P&L verification could run
 * isolated. This one-shot wraps `runRecomputeForCompanies` and
 * triggers the same logic the matrix endpoint would.
 *
 * Run:
 *   DATABASE_URL=... npx tsx scripts/recompute-azseker-workbook.ts
 */
import { PrismaClient } from "@prisma/client"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"

const ENTITY_CODES = [
  "AZSEKER-AZSF",
  "AZSEKER-CPC",
  "AZSEKER-EDEN",
  "AZSEKER-MALT",
]
const YEAR = 2026

async function main(): Promise<number> {
  const prisma = new PrismaClient()
  try {
    const org = await prisma.organization.findFirst({
      where: { slug: "azmade" },
      select: { id: true, name: true },
    })
    if (!org) throw new Error("Org azmade not found")

    const companies = await prisma.company.findMany({
      where: { organizationId: org.id, code: { in: ENTITY_CODES } },
      select: { id: true, code: true },
    })
    console.log(
      `Recomputing for ${companies.length} entities × year ${YEAR}: ${companies.map((c) => c.code).join(", ")}`,
    )

    const affected = companies.map((c) => ({ companyId: c.id, year: YEAR }))

    const t0 = Date.now()
    const result = await runRecomputeForCompanies(prisma, org.id, affected, {
      start: (msg: string) => console.log("[recompute]", msg),
      pairError: (label: string, err: unknown) =>
        console.warn("[recompute] FAIL", label, err),
    })
    const dt = Date.now() - t0
    console.log(`\nRecompute complete in ${dt}ms:`)
    console.log(`  targets:  ${result.targets}`)
    console.log(`  ok:       ${result.ok}`)
    console.log(`  unknown:  ${result.unknown}`)
    console.log(`  failed:   ${result.failed}`)
    return result.failed > 0 ? 1 : 0
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("[recompute-azseker-workbook] fatal:", e)
    process.exit(2)
  })
