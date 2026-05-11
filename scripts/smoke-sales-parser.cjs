/**
 * Smoke check — parseAacSalesAllSheet against real AAC xlsx file.
 * Read-only, no DB.
 *
 * Run: `node scripts/smoke-sales-parser.cjs`
 */
const XLSX = require("xlsx")

const f = "/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx"
const wb = XLSX.readFile(f, { cellFormula: false })
const aoa = XLSX.utils.sheet_to_json(wb.Sheets["S-all"], { header: 1, raw: true, blankrows: false })

const HEADER = /^jan/i
const TOTAL = /^CƏMİ\s+məbləğ/i

console.log("\n=== AAC S-all sales parser smoke (column-agnostic) ===\n")
let count = 0
for (let r = 0; r < aoa.length; r++) {
  const row = aoa[r] || []
  let janCol = -1
  for (let c = 0; c < row.length; c++) {
    if (typeof row[c] === "string" && HEADER.test(row[c].trim())) { janCol = c; break }
  }
  if (janCol === -1) continue
  // Product name = leftmost text before Jan
  let name = ""
  for (let c = janCol - 1; c >= 0; c--) {
    if (typeof row[c] === "string" && row[c].trim()) { name = row[c].trim(); break }
  }
  if (!name) continue
  let totalRow = null
  for (let k = r + 1; k < Math.min(r + 11, aoa.length); k++) {
    const cand = aoa[k] || []
    for (let c = 0; c < janCol; c++) {
      const lab = typeof cand[c] === "string" ? cand[c].trim() : ""
      if (TOTAL.test(lab)) { totalRow = cand; break }
    }
    if (totalRow) break
  }
  if (!totalRow) continue
  let total = 0
  for (let m = 0; m < 12; m++) {
    const v = typeof totalRow[janCol + m] === "number" ? totalRow[janCol + m] : 0
    total += v
  }
  if (total === 0) continue
  count++
  console.log(`  ${count}. ${name.padEnd(20)} — annual: ${total.toFixed(0).padStart(12)} ₼`)
}
console.log(`\nTotal: ${count} products with non-zero annual sales\n`)
