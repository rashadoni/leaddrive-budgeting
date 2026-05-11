/**
 * Phase 7.G CXXXVI — imports per-product sales from AAC's `S-all` sheet
 * into ProductLine + SalesBudgetLine rows. Populates the Sales Budget tab
 * with REAL client product-revenue numbers.
 *
 * Currently only AAC has a per-product sales sheet (S-all). Other AZMADE
 * companies (LLS / SPARK / ZTP / ATL) sell services or different formats —
 * their sales aggregate is captured via budget_lines (revenue accounts
 * 601-xx) and shown in P&L tab; per-product breakdown isn't available
 * for them.
 *
 * Run: `npx tsx scripts/import-azmade-sales.ts`
 *
 * Idempotent: deletes prior SalesBudgetLine rows for (planId, year)
 * before inserting new ones.
 */

import { PrismaClient, type Prisma } from "@prisma/client"
import * as XLSX from "xlsx"
import { parseAacSalesAllSheet } from "../src/lib/onboarding/adapters/azmade-sales"

const prisma = new PrismaClient()
const ORG_SLUG = "azmade"

interface SalesJob {
  file: string
  sheet: string
  /** Maps product code → unit (m3 for blocks, ton for lime, etc.) */
  productUnits: Record<string, string>
  year: number
}

const JOBS: SalesJob[] = [
  {
    file: "/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx",
    sheet: "S-all",
    productUnits: {
      MHB: "m3",
      LIME_BURNT: "ton",
      LIME_SLAKED: "ton",
      ADHESIVE: "kg",
      LIME_WASTE: "ton",
      UBLOCK: "ədəd",
    },
    year: 2026,
  },
]

async function main() {
  console.log(`\n=== AZMADE per-product sales import (${JOBS.length} files) ===\n`)
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG }, select: { id: true } })
  if (!org) throw new Error(`Org "${ORG_SLUG}" not found`)

  let totalProducts = 0
  let totalSalesLines = 0

  for (const job of JOBS) {
    console.log(`→ ${job.file.split("/").pop()} :: "${job.sheet}" (year ${job.year})`)
    const plan = await prisma.budgetPlan.findFirst({
      where: { organizationId: org.id, year: job.year, deletedAt: null },
      select: { id: true },
    })
    if (!plan) {
      console.log(`  ✗ No BudgetPlan for org+${job.year} — run import-azmade-budgets first`)
      continue
    }

    const wb = XLSX.readFile(job.file, { cellFormula: false, cellHTML: false })
    const parsed = parseAacSalesAllSheet(wb, job.sheet, XLSX)

    if (parsed.warnings.length > 0) {
      for (const w of parsed.warnings.slice(0, 5)) console.log(`  ⚠ R${w.row}: ${w.reason}`)
    }
    if (parsed.products.length === 0) {
      console.log(`  ↪ 0 products parsed (skipping)`)
      continue
    }

    const result = await prisma.$transaction(async (tx) => {
      // Ensure ProductLine rows
      const productIds = new Map<string, string>()
      for (let i = 0; i < parsed.products.length; i++) {
        const p = parsed.products[i]
        const unit = job.productUnits[p.code] ?? "ədəd"
        const upserted = await tx.productLine.upsert({
          where: { organizationId_code: { organizationId: org.id, code: p.code } },
          create: {
            organizationId: org.id,
            code: p.code,
            name: p.name,
            unit,
            sortOrder: i * 10,
            isActive: true,
          },
          update: { name: p.name, unit, isActive: true },
          select: { id: true },
        })
        productIds.set(p.code, upserted.id)
      }

      // Replace prior SalesBudgetLine rows for this plan+year
      const del = await tx.salesBudgetLine.deleteMany({
        where: { planId: plan.id, year: job.year },
      })

      const rows: Prisma.SalesBudgetLineCreateManyInput[] = []
      for (const p of parsed.products) {
        const productLineId = productIds.get(p.code)!
        for (let m = 0; m < 12; m++) {
          rows.push({
            organizationId: org.id,
            planId: plan.id,
            productLineId,
            year: job.year,
            month: m + 1,
            quantity: 0, // S-all only has amount, no quantity breakdown
            unitPrice: 0,
            amount: p.perMonth[m],
          })
        }
      }
      if (rows.length > 0) await tx.salesBudgetLine.createMany({ data: rows })
      return { products: parsed.products.length, lines: rows.length, deleted: del.count }
    })

    console.log(`  ✓ ${result.products} ProductLines upserted, ${result.lines} SalesBudgetLine rows inserted (${result.deleted} prior deleted)`)
    totalProducts += result.products
    totalSalesLines += result.lines
  }

  console.log(`\n=== DONE: ${totalProducts} products + ${totalSalesLines} sales rows ===`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
