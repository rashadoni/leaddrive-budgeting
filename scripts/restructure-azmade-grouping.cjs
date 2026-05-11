/**
 * Phase 7.G CXLVII — restructure AZMADE companies to mirror Azərşəkər
 * grouping in CompanyTree.
 *
 * Before (asymmetric):
 *   FO Holding
 *   ├── AAC (level=1)        ← AZMADE companies at level=1, no parent
 *   │   └── AAC-MAIN (level=2)
 *   ├── ATL (level=1)
 *   │   ├── ATL-MRKZ/DBZ/PMZ/TAZ (level=2)
 *   ├── SPARK, ZTP, LLS (level=1)
 *   └── AZSEKER (level=1)    ← Azərşəkər at level=1 WITH parent group
 *       ├── EDEN, AZSF, HORIZON, Farm, CPC (level=2)
 *
 * After (mirror Azərşəkər shape):
 *   FO Holding
 *   ├── AZMADE (level=1)     ← NEW umbrella, parent=null
 *   │   ├── AAC (level=2)    ← demoted to level=2, parent=AZMADE
 *   │   │   └── AAC-MAIN (level=3)
 *   │   ├── ATL (level=2)
 *   │   │   ├── ATL-MRKZ/DBZ/PMZ/TAZ (level=3)
 *   │   ├── SPARK (level=2)
 *   │   │   └── SPARK-MAIN (level=3)
 *   │   ├── ZTP (level=2)
 *   │   │   └── ZTP-MAIN (level=3)
 *   │   └── LLS (level=2)
 *   │       └── LLS-MAIN (level=3)
 *   └── AZSEKER (level=1)
 *       └── EDEN/AZSF/HORIZON/FARM/CPC (level=2)
 *
 * Idempotent: re-running detects AZMADE umbrella exists and skips.
 *
 * Run: `node scripts/restructure-azmade-grouping.cjs`
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const AZMADE_SUBGROUPS = ["AAC", "ATL", "SPARK", "ZTP", "LLS"]
const AZMADE_OPS = ["AAC-MAIN", "ATL-MRKZ", "ATL-DBZ", "ATL-PMZ", "ATL-TAZ", "SPARK-MAIN", "ZTP-MAIN", "LLS-MAIN"]

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error("Org not found")

  console.log("\n=== AZMADE grouping restructure ===\n")

  // 1. Create or fetch AZMADE umbrella
  let azmade = await prisma.company.findUnique({
    where: { organizationId_code: { organizationId: org.id, code: "AZMADE" } },
    select: { id: true },
  })
  if (!azmade) {
    azmade = await prisma.company.create({
      data: {
        organizationId: org.id, code: "AZMADE", name: "AZMADE",
        level: 1, role: "operational", country: "AZ", baseCurrencyCode: "AZN",
        sortOrder: 50, // BEFORE existing AAC (100) to position first
      },
      select: { id: true },
    })
    console.log(`✓ Created umbrella: AZMADE (id=${azmade.id})`)
  } else {
    console.log(`↪ Umbrella exists: AZMADE`)
  }

  // 2. Re-parent AAC/ATL/SPARK/ZTP/LLS → level=2, parent=AZMADE
  for (const code of AZMADE_SUBGROUPS) {
    const co = await prisma.company.findUnique({
      where: { organizationId_code: { organizationId: org.id, code } },
      select: { id: true, level: true, parentCompanyId: true },
    })
    if (!co) { console.log(`  ⚠ ${code} not found`); continue }
    if (co.level === 2 && co.parentCompanyId === azmade.id) {
      console.log(`  ↪ ${code} already level=2 + parent=AZMADE`)
      continue
    }
    await prisma.company.update({
      where: { id: co.id },
      data: { level: 2, parentCompanyId: azmade.id },
    })
    console.log(`  ✓ ${code}: level ${co.level}→2, parent → AZMADE`)
  }

  // 3. Demote operational entities (AAC-MAIN, ATL-*, etc.) to level=3
  for (const code of AZMADE_OPS) {
    const co = await prisma.company.findUnique({
      where: { organizationId_code: { organizationId: org.id, code } },
      select: { id: true, level: true },
    })
    if (!co) { console.log(`  ⚠ ${code} not found`); continue }
    if (co.level === 3) {
      console.log(`  ↪ ${code} already level=3`)
      continue
    }
    await prisma.company.update({
      where: { id: co.id },
      data: { level: 3 },
    })
    console.log(`  ✓ ${code}: level ${co.level}→3`)
  }

  // 4. Cleanup — delete rogue "Q1" plan (created during prior testing, no data)
  const q1 = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, name: "Q1", deletedAt: null },
    select: { id: true, _count: { select: { lines: true, actuals: true } } },
  })
  if (q1) {
    if (q1._count.lines === 0 && q1._count.actuals === 0) {
      await prisma.budgetPlan.delete({ where: { id: q1.id } })
      console.log(`\n✓ Deleted rogue "Q1" plan (empty)`)
    } else {
      console.log(`\n⚠ "Q1" plan has data (${q1._count.lines} lines / ${q1._count.actuals} actuals) — NOT deleting`)
    }
  }

  console.log(`\n=== DONE ===`)

  // Print final tree
  const all = await prisma.company.findMany({
    where: { organizationId: org.id },
    select: { code: true, name: true, level: true, parentCompanyId: true, role: true },
    orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
  })
  console.log(`\nFinal company tree (${all.length} companies):`)
  // Build & print hierarchically
  const byParent = new Map()
  byParent.set(null, [])
  for (const c of all) {
    const p = c.parentCompanyId
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p).push(c)
  }
  const idByCode = new Map(all.map((c) => [c.code, c]))
  function dump(parentId, indent) {
    const children = byParent.get(parentId) || []
    for (const c of children) {
      const idx = all.findIndex((x) => x.code === c.code)
      const id = idx >= 0 ? all[idx] : c
      // Find actual id from db
    }
  }
  // Simple flat dump
  for (const c of all) {
    const indent = "  ".repeat(c.level - 1)
    console.log(`  ${indent}L${c.level} ${c.code.padEnd(20)} ${c.name}${c.role !== "operational" ? " ["+c.role+"]" : ""}`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
