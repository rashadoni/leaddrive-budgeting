/**
 * Phase 7.M Tier 4 (2026-05-19) — Clean-slate AZSEKER data.
 *
 * Soft-deletes ALL active AZSEKER budget_lines + balance_sheet_lines +
 * cash_flow_entries. Hard-deletes all archived rows (purge tail).
 * Hard-deletes operational_facts (no soft-delete column on that table).
 * Writes a single audit_event for the action.
 *
 * Companies themselves are NOT touched — they remain in DB as empty
 * shells, ready for fresh import. AZSEKER-FARM stays archived; PROMALT
 * stays active. AZSEKER-HORIZON placeholder data IS cleaned (per user
 * intent: full clean-slate).
 *
 * Usage:
 *   npx tsx scripts/clean-slate-azseker.ts                # apply
 *   npx tsx scripts/clean-slate-azseker.ts --dry-run     # preview only
 */
import { PrismaClient, Prisma } from "@prisma/client"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")
const ORG_SLUG = "azmade"
const SYSTEM_ACTOR = "clean-slate-script-2026-05-19"

async function main(): Promise<number> {
  console.log(
    `\n=== Clean-slate AZSEKER data${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`,
  )

  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  })
  if (!org) {
    console.error(`✗ Org slug=${ORG_SLUG} not found`)
    return 1
  }

  // Resolve all AZSEKER companies (including archived FARM)
  const companies = await prisma.company.findMany({
    where: {
      organizationId: org.id,
      OR: [{ code: { startsWith: "AZSEKER-" } }, { code: "AZSEKER" }],
    },
    select: { id: true, code: true, status: true },
    orderBy: { code: "asc" },
  })
  const companyIds = companies.map((c: { id: string }) => c.id)
  console.log(`Found ${companies.length} AZSEKER companies:`)
  for (const c of companies) {
    console.log(`  · ${c.code.padEnd(20)} status=${c.status}`)
  }
  console.log("")

  // ── 1. Snapshot what will be touched ───────────────────────
  const blLive = await prisma.budgetLine.count({
    where: { companyId: { in: companyIds }, deletedAt: null },
  })
  const blArchived = await prisma.budgetLine.count({
    where: { companyId: { in: companyIds }, deletedAt: { not: null } },
  })

  // BS scoped via companyId (Phase 2.1 session 3: accountCode column dropped).
  const bsLive = await prisma.balanceSheetLine.count({
    where: { companyId: { in: companyIds }, deletedAt: null },
  })
  const bsArchived = await prisma.balanceSheetLine.count({
    where: { companyId: { in: companyIds }, deletedAt: { not: null } },
  })

  // CF scoped via sourceId prefix (no companyId column)
  const cfLive = await prisma.cashFlowEntry.count({
    where: {
      deletedAt: null,
      OR: companies.map((c: { code: string }) => ({
        sourceId: { startsWith: c.code + "::" },
      })),
    },
  })
  const cfArchived = await prisma.cashFlowEntry.count({
    where: {
      deletedAt: { not: null },
      OR: companies.map((c: { code: string }) => ({
        sourceId: { startsWith: c.code + "::" },
      })),
    },
  })

  const ofCount = await prisma.operationalFact.count({
    where: { companyId: { in: companyIds } },
  })

  const ivCount = await prisma.indicatorValue.count({
    where: { companyId: { in: companyIds } },
  })

  console.log(`── Rows to affect ──`)
  console.log(`  budget_lines:        ${blLive} live → soft-delete · ${blArchived} archived → hard-delete`)
  console.log(`  balance_sheet_lines: ${bsLive} live → soft-delete · ${bsArchived} archived → hard-delete`)
  console.log(`  cash_flow_entries:   ${cfLive} live → soft-delete · ${cfArchived} archived → hard-delete`)
  console.log(`  operational_facts:   ${ofCount} → hard-delete (no soft-delete column)`)
  console.log(`  indicator_values:    ${ivCount} → recompute will refresh (not touched directly)`)

  if (DRY_RUN) {
    console.log(`\n=== DRY-RUN — no changes applied ===\n`)
    return 0
  }

  // ── 2. Apply inside one transaction ─────────────────────────
  const now = new Date()
  let blSoftDeleted = 0
  let blHardDeleted = 0
  let bsSoftDeleted = 0
  let bsHardDeleted = 0
  let cfSoftDeleted = 0
  let cfHardDeleted = 0
  let ofDeleted = 0

  await prisma.$transaction(async (tx) => {
    // budget_lines: hard-delete archived, soft-delete live
    const blHard = await tx.budgetLine.deleteMany({
      where: { companyId: { in: companyIds }, deletedAt: { not: null } },
    })
    blHardDeleted = blHard.count

    const blSoft = await tx.budgetLine.updateMany({
      where: { companyId: { in: companyIds }, deletedAt: null },
      data: { deletedAt: now, deletedBy: SYSTEM_ACTOR },
    })
    blSoftDeleted = blSoft.count

    // balance_sheet_lines: scoped via companyId (Phase 2.1 session 3).
    const bsHard = await tx.balanceSheetLine.deleteMany({
      where: { companyId: { in: companyIds }, deletedAt: { not: null } },
    })
    bsHardDeleted = bsHard.count

    const bsSoft = await tx.balanceSheetLine.updateMany({
      where: { companyId: { in: companyIds }, deletedAt: null },
      data: { deletedAt: now, deletedBy: SYSTEM_ACTOR },
    })
    bsSoftDeleted = bsSoft.count

    // cash_flow_entries: same
    const cfCompanyFilter: Prisma.CashFlowEntryWhereInput["OR"] =
      companies.map((c: { code: string }) => ({
        sourceId: { startsWith: c.code + "::" } as const,
      }))

    const cfHard = await tx.cashFlowEntry.deleteMany({
      where: { deletedAt: { not: null }, OR: cfCompanyFilter },
    })
    cfHardDeleted = cfHard.count

    const cfSoft = await tx.cashFlowEntry.updateMany({
      where: { deletedAt: null, OR: cfCompanyFilter },
      data: { deletedAt: now, deletedBy: SYSTEM_ACTOR },
    })
    cfSoftDeleted = cfSoft.count

    // operational_facts: hard-delete (no soft-delete column)
    const ofRes = await tx.operationalFact.deleteMany({
      where: { companyId: { in: companyIds } },
    })
    ofDeleted = ofRes.count

    // Audit event — single row for the bulk operation
    await tx.auditEvent.create({
      data: {
        organizationId: org.id,
        action: "data_archive",
        entityType: "BudgetLine", // representative — actual scope spans 4 tables (see metadata)
        entityId: null, // bulk operation
        metadata: {
          scope: "clean-slate-azseker",
          companies: companies.map((c: { code: string }) => c.code),
          budgetLinesSoftDeleted: blSoftDeleted,
          budgetLinesHardDeleted: blHardDeleted,
          balanceSheetSoftDeleted: bsSoftDeleted,
          balanceSheetHardDeleted: bsHardDeleted,
          cashFlowSoftDeleted: cfSoftDeleted,
          cashFlowHardDeleted: cfHardDeleted,
          operationalFactsHardDeleted: ofDeleted,
          reason: "User-authorized clean-slate before fresh import",
        },
      },
    })
  })

  console.log(`\n── Applied (in single transaction) ──`)
  console.log(`  budget_lines:        ${blSoftDeleted} soft-deleted, ${blHardDeleted} hard-deleted`)
  console.log(`  balance_sheet_lines: ${bsSoftDeleted} soft-deleted, ${bsHardDeleted} hard-deleted`)
  console.log(`  cash_flow_entries:   ${cfSoftDeleted} soft-deleted, ${cfHardDeleted} hard-deleted`)
  console.log(`  operational_facts:   ${ofDeleted} hard-deleted`)
  console.log(`  audit_event:         1 row written (action=data_archive)`)

  // ── 3. Verify ──────────────────────────────────────────────
  const blLiveAfter = await prisma.budgetLine.count({
    where: { companyId: { in: companyIds }, deletedAt: null },
  })
  const bsLiveAfter = await prisma.balanceSheetLine.count({
    where: { companyId: { in: companyIds }, deletedAt: null },
  })
  const cfLiveAfter = await prisma.cashFlowEntry.count({
    where: {
      deletedAt: null,
      OR: companies.map((c: { code: string }) => ({
        sourceId: { startsWith: c.code + "::" },
      })),
    },
  })
  const ofAfter = await prisma.operationalFact.count({
    where: { companyId: { in: companyIds } },
  })

  console.log(`\n── Verification (post-transaction) ──`)
  console.log(`  budget_lines live:        ${blLiveAfter} (expected: 0)`)
  console.log(`  balance_sheet_lines live: ${bsLiveAfter} (expected: 0)`)
  console.log(`  cash_flow_entries live:   ${cfLiveAfter} (expected: 0)`)
  console.log(`  operational_facts:        ${ofAfter} (expected: 0)`)
  const allZero =
    blLiveAfter === 0 && bsLiveAfter === 0 && cfLiveAfter === 0 && ofAfter === 0
  console.log(
    `\n${allZero ? "✓ Clean-slate succeeded — AZSEKER data fully archived/deleted" : "⚠ Some rows remain — investigate"}`,
  )

  console.log(`\n=== DONE ===\n`)
  return allZero ? 0 : 1
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(2)
  })
