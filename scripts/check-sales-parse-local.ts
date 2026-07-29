/** TEMP (2026-07-15) — run the product-sales parsers over the real client
 *  workbook and reconcile against the PLF revenue the same file states. */
import * as XLSX from "xlsx"
import * as fs from "node:fs"
import {
  parseProductSalesSheet,
  resolveUnitPrice,
} from "@/lib/onboarding/ai-import/product-sales-parser"

const FILE = "/Users/rashadrahimov/Desktop/N. Nəcəfzadə.xlsx"
const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer", cellFormula: false, cellDates: true })

const CASES: Array<{ sheet: string; entity: string; year: number; plfExpect?: number }> = [
  { sheet: "Sales Farming Budget 2026", entity: "AZSEKER-EDEN", year: 2026, plfExpect: 31.34 },
  { sheet: "Sales Budget CPC 2026", entity: "AZSEKER-CPC", year: 2026, plfExpect: 18.13 },
  { sheet: "Satış Əkinçilik Fakt", entity: "AZSEKER-EDEN", year: 2026 },
  { sheet: "Satış CPC Fakt", entity: "AZSEKER-CPC", year: 2026 },
]

for (const c of CASES) {
  const res = parseProductSalesSheet(wb, c.sheet, XLSX, { entityCode: c.entity, year: c.year })
  const amount = res.rows.reduce((s, r) => s + r.amount, 0)
  const qty = res.rows.reduce((s, r) => s + r.quantity, 0)
  const products = new Set(res.rows.map((r) => r.identity.slug))
  console.log(`\n=== ${c.sheet}  (${c.entity}, ${c.year})`)
  console.log(`  shape=${res.shape} rows=${res.rows.length} products=${products.size}`)
  console.log(`  Σ net revenue = ${(amount / 1e6).toFixed(2)}M | Σ qty = ${qty.toLocaleString()}`)
  if (c.plfExpect !== undefined) {
    const diff = amount / 1e6 - c.plfExpect
    console.log(`  vs sheet/PLF expectation ${c.plfExpect}M → diff ${diff.toFixed(2)}M ${Math.abs(diff) < 0.25 ? "✓" : "✗"}`)
  }
  const sample = res.rows.filter((r) => r.quantity !== 0).slice(0, 3)
  for (const r of sample) {
    console.log(
      `   · ${r.identity.code} m${r.month}: qty=${r.quantity.toFixed(1)} amount=${r.amount.toFixed(0)} price=${resolveUnitPrice(r).toFixed(2)}${r.explicitUnitPrice ? ` (stated ${r.explicitUnitPrice})` : ""}`,
    )
  }
  for (const w of res.warnings) console.log(`   ⚠ ${w}`)
}
