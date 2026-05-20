/**
 * Phase 7.M (2026-05-19) — Sync AZSEKER child entities with Azik's
 * confirmation from Telegram:
 *
 *   1. "Farming Sales" → Eden Agro (= AZSEKER-EDEN) ← already correct,
 *      cost-center mapping updated separately to route QT/DAS/BO → EDEN
 *      (no AZSEKER-FARM legal entity).
 *
 *   2. "ProMalt Sales" → Promalt MMC (= NEW AZSEKER-PROMALT entity,
 *      separate from the malt-production subsidiary AZSEKER-MALT).
 *      This script CREATES AZSEKER-PROMALT if missing.
 *
 *   3. "AZSEKER-FARM mövcud deyil" — there is no legal entity by that
 *      name. This script ARCHIVES AZSEKER-FARM (status='archived') so
 *      it stops appearing in Risk Terminal but historical references
 *      (audit log, archived BudgetLines) remain queryable.
 *
 *   4. "AZSEKER-HORIZON boş qalacaq" — intentionally empty. No action.
 *
 * Idempotent: safe to run multiple times. Reports the actions it took.
 *
 * Usage:
 *   npx tsx scripts/sync-azseker-entities.ts                  # apply
 *   npx tsx scripts/sync-azseker-entities.ts --dry-run        # preview
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const ORG_SLUG = "azmade"
const DRY_RUN = process.argv.includes("--dry-run")

const PROMALT_SETTINGS = {
  // Promalt MMC handles malt sales — separate legal entity from the
  // malt-production subsidiary AZSEKER-MALT. Conservative defaults;
  // adjust via the admin UI when more facts arrive from Azik.
  legalEntity: "Promalt MMC",
  productCategory: "malt_sales",
  // No processing capacity — this is a sales/distribution entity, not
  // a production facility.
  topCustomerHhiTarget: 0.4,
}

async function main(): Promise<number> {
  console.log(
    `\n=== Sync AzerSheker entities${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`,
  )

  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  })
  if (!org) {
    console.error(`✗ Organization slug="${ORG_SLUG}" not found`)
    return 1
  }
  console.log(`Org: ${org.name} (${org.id})`)

  const azsekerParent = await prisma.company.findFirst({
    where: { organizationId: org.id, code: "AZSEKER", level: 1 },
    select: { id: true, name: true },
  })
  if (!azsekerParent) {
    console.error(`✗ AZSEKER parent (level=1) not found — run import-azseker.cjs first`)
    return 1
  }
  console.log(`Parent: ${azsekerParent.name} (${azsekerParent.id})\n`)

  // ── Action 1: CREATE AZSEKER-PROMALT ─────────────────────────────
  const existingPromalt = await prisma.company.findFirst({
    where: { organizationId: org.id, code: "AZSEKER-PROMALT" },
    select: { id: true, status: true, settings: true },
  })

  if (existingPromalt) {
    console.log(
      `↪ AZSEKER-PROMALT already exists (status=${existingPromalt.status})`,
    )
    if (existingPromalt.status === "archived") {
      console.log(`  ↑ unarchiving (status archived → active)`)
      if (!DRY_RUN) {
        await prisma.company.update({
          where: { id: existingPromalt.id },
          data: { status: "active", isActive: true },
        })
      }
    }
  } else {
    console.log(
      `+ Creating AZSEKER-PROMALT (Promalt MMC, level=2, food_processing)`,
    )
    if (!DRY_RUN) {
      await prisma.company.create({
        data: {
          organizationId: org.id,
          code: "AZSEKER-PROMALT",
          name: "Promalt MMC",
          nameAz: "Promalt MMC",
          nameRu: "Promalt MMC",
          nameEn: "Promalt MMC",
          level: 2,
          role: "operational",
          country: "AZ",
          baseCurrencyCode: "AZN",
          industry: "food_processing",
          parentCompanyId: azsekerParent.id,
          status: "active",
          isActive: true,
          settings: PROMALT_SETTINGS,
          sortOrder: 745, // between MALT (740) and HORIZON (750)
        },
      })
    }
  }

  // ── Action 2: ARCHIVE AZSEKER-FARM ───────────────────────────────
  const existingFarm = await prisma.company.findFirst({
    where: { organizationId: org.id, code: "AZSEKER-FARM" },
    select: { id: true, status: true, isActive: true },
  })

  if (!existingFarm) {
    console.log(`↪ AZSEKER-FARM not in DB (nothing to archive)`)
  } else if (existingFarm.status === "archived" && !existingFarm.isActive) {
    console.log(`↪ AZSEKER-FARM already archived`)
  } else {
    console.log(
      `× Archiving AZSEKER-FARM (Azik: legal entity does not exist)`,
    )
    if (!DRY_RUN) {
      await prisma.company.update({
        where: { id: existingFarm.id },
        data: { status: "archived", isActive: false },
      })
    }
  }

  // ── Diagnostic: list all AZSEKER children ────────────────────────
  console.log(`\n── Current AZSEKER children ──`)
  const allChildren = await prisma.company.findMany({
    where: {
      organizationId: org.id,
      code: { startsWith: "AZSEKER-" },
    },
    select: {
      code: true,
      name: true,
      industry: true,
      status: true,
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
  })
  for (const c of allChildren) {
    const flag =
      c.status === "active" && c.isActive
        ? "✓"
        : c.status === "archived"
          ? "×"
          : "?"
    console.log(
      `  ${flag} ${c.code.padEnd(20)} ${c.industry?.padEnd(16) ?? "(no industry)".padEnd(16)} status=${c.status}`,
    )
  }

  console.log(
    `\n=== ${DRY_RUN ? "DRY-RUN — no DB changes applied" : "DONE — DB updated"} ===\n`,
  )
  return 0
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
