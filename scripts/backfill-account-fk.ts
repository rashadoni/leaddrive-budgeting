/**
 * One-shot backfill for Phase 2.1 — populates `accountId` on existing
 * BudgetLine rows by matching against ChartOfAccount codes.
 *
 * Run once after deploying the `accountid_fk` migration:
 *   npx tsx scripts/backfill-account-fk.ts
 *
 * Safe to re-run — only rows with accountId=null are touched.
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, slug: true } })
  console.log(`Found ${orgs.length} organizations`)

  let totalUpdated = 0
  let totalSkipped = 0

  for (const org of orgs) {
    // Build lookup for this org
    const accounts = await prisma.chartOfAccount.findMany({
      where: { organizationId: org.id },
      select: { id: true, code: true },
    })
    const byCode = new Map(accounts.map((a) => [a.code, a.id]))

    // Fetch pending rows — either after import refactor (code in department)
    // or legacy (code in category).
    const rows = await prisma.budgetLine.findMany({
      where: { organizationId: org.id, accountId: null },
      select: { id: true, category: true, department: true },
    })

    let updatedInOrg = 0
    let skippedInOrg = 0
    for (const row of rows) {
      // Try to find a matching code. First look at department (post-refactor),
      // then category (legacy).
      const candidates = [row.department, row.category].filter((s): s is string => Boolean(s))
      let accountId: string | null = null
      for (const s of candidates) {
        if (byCode.has(s)) {
          accountId = byCode.get(s)!
          break
        }
      }
      if (!accountId) {
        skippedInOrg++
        continue
      }
      await prisma.budgetLine.update({
        where: { id: row.id },
        data: { accountId },
      })
      updatedInOrg++
    }

    console.log(
      `  org ${org.slug ?? org.id.slice(0, 8)}: ${updatedInOrg} updated, ${skippedInOrg} skipped (no matching CoA row)`,
    )
    totalUpdated += updatedInOrg
    totalSkipped += skippedInOrg
  }

  console.log(`\nDone. ${totalUpdated} rows backfilled, ${totalSkipped} left untouched.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
