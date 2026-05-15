/**
 * Inspect ATL SOPL P-F sheets — list every line so we can see the
 * "source of truth" P&L view that the verifier reads.
 */
const XLSX = require("xlsx")
const FILE = "/Users/rashadrahimov/Downloads/azmade budget/rev 9 - 2026 Budget - ATL.xlsx"

const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false, cellDates: true })
console.log("Sheets in workbook:")
for (const name of wb.SheetNames) console.log(`  - ${name}`)

const targets = ["SOPL P-F DBZ 2026", "SOPL P-F PMZ 2026", "SOPL P-F TAZ 2026"]
for (const sheetName of targets) {
  const sheet = wb.Sheets[sheetName]
  if (!sheet) { console.log(`\n!!! Sheet "${sheetName}" not found`); continue }
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false })
  console.log(`\n${"=".repeat(80)}`)
  console.log(`Sheet: ${sheetName}  (${aoa.length} rows)`)
  console.log(`${"=".repeat(80)}`)
  // Print first 15 rows raw, then any row with "EBITDA" / "Total" / etc.
  for (let r = 0; r < Math.min(aoa.length, 10); r++) {
    console.log(`  R${r}: ${JSON.stringify(aoa[r]?.slice(0, 6))}`)
  }
  // Look for total row
  for (let r = 0; r < aoa.length; r++) {
    const cell0 = String(aoa[r]?.[0] ?? "").toLowerCase()
    const cell1 = String(aoa[r]?.[1] ?? "").toLowerCase()
    if (/total|ebitda|net profit|qross|cəmi/i.test(cell0 + " " + cell1)) {
      console.log(`  R${r} (TOTAL?): ${JSON.stringify(aoa[r]?.slice(0, 6))}`)
    }
  }
}
