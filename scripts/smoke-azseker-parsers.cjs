/**
 * Smoke check — parsePlfPlSheet + parsePlfCfSheet against real Consolidated
 * Azərşəkər file. Read-only, no DB.
 */
const XLSX = require("xlsx")

const FILE = "/Users/rashadrahimov/Downloads/azmade budget/Consolidated budget 2026_AHMAD_NEW.xlsx"
const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false, cellDates: true })

const ENTITIES = [
  { code: "EDEN",    plSheet: "PL_EDEN",  cfSheet: "CF_EDEN" },
  { code: "AZSF",    plSheet: "PLF_AZSF", cfSheet: "CF_AZSF" },
  { code: "HORIZON", plSheet: null,       cfSheet: "CF_HORIZON" },
  { code: "Farm",    plSheet: "PLF_Farm", cfSheet: "CF_Farm" },
  { code: "CPC",     plSheet: "PLF_CPC",  cfSheet: "CF_CPC" },
]

// Mirror leaf detector + header finder (re-implemented in JS)
const LEAF_RE = /^(PLF|CF)\.\d{2}\.\d{2}\.\d{1,2}$/

function findHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] || []
    let cnt = 0, cols = []
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      let date
      if (v instanceof Date) date = v
      else if (typeof v === "number" && v > 44000 && v < 48000) date = new Date((v - 25569) * 86400 * 1000)
      else continue
      if (isNaN(date.getTime())) continue
      const y = date.getUTCFullYear()
      if (y < 2020 || y > 2031) continue
      cols.push(c)
      cnt++
    }
    if (cnt >= 12) return { row: i, monthCols: cols.slice(0, 12) }
  }
  return null
}

console.log("\n=== Azərşəkər file smoke ===\n")
for (const ent of ENTITIES) {
  console.log(`📊 ${ent.code}`)
  for (const [type, name] of [["PL", ent.plSheet], ["CF", ent.cfSheet]]) {
    if (!name) { console.log(`  ${type}: (sheet not present)`); continue }
    if (!wb.Sheets[name]) { console.log(`  ${type}: ❌ sheet "${name}" not in workbook`); continue }
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, blankrows: false })
    const h = findHeaderRow(aoa)
    if (!h) { console.log(`  ${type}: ❌ no header row found in "${name}" (rows=${aoa.length})`); continue }
    let leafCount = 0, totalSum = 0
    for (let r = h.row + 1; r < aoa.length; r++) {
      const code = typeof aoa[r]?.[0] === "string" ? aoa[r][0].trim() : ""
      if (!LEAF_RE.test(code)) continue
      let total = 0
      for (let m = 0; m < 12; m++) {
        const v = aoa[r][h.monthCols[m]]
        if (typeof v === "number") total += v
      }
      if (total === 0) continue
      leafCount++
      totalSum += total
    }
    console.log(`  ${type.padEnd(2)}: ${name.padEnd(15)} → ${leafCount} leaf rows, sum=${totalSum.toFixed(0)}`)
  }
  console.log("")
}
