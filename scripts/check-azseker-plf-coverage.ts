/**
 * Quick coverage check: how many 2026 months have non-zero PLF data
 * in Guvven Fin.xlsx for each AZSEKER entity.
 */
import XLSX from "xlsx"
import path from "path"

const FILE = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"

const PLF_SHEETS: Record<string, string> = {
  "PLF EDEN": "AZSEKER-EDEN",
  "PLF AZSF": "AZSEKER-AZSF",
  "PLF CPC": "AZSEKER-CPC",
  "PL Malt": "AZSEKER-MALT",
}

function toYM(serial: number): string {
  const d = new Date((serial - 25569) * 86400 * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

const wb = XLSX.readFile(FILE)

for (const [sheetName, entity] of Object.entries(PLF_SHEETS)) {
  const ws = wb.Sheets[sheetName]
  if (!ws) { console.log(`${entity}: sheet "${sheetName}" NOT FOUND`); continue }

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false }) as (number | string | null)[][]
  const hdr = aoa[0]

  // Find all 2026 month columns
  const col2026: { idx: number; ym: string }[] = []
  hdr.forEach((v, i) => {
    if (typeof v === "number" && v > 40000) {
      const ym = toYM(v)
      if (ym.startsWith("2026")) col2026.push({ idx: i, ym })
    }
  })

  if (col2026.length === 0) {
    console.log(`${entity} (${sheetName}): NO 2026 columns found`)
    continue
  }

  // For each 2026 month, count non-zero leaf rows
  const monthCounts: Record<string, number> = {}
  const monthRevenue: Record<string, number> = {}
  for (const { ym } of col2026) {
    monthCounts[ym] = 0
    monthRevenue[ym] = 0
  }

  let revenueLeafCount = 0
  aoa.slice(1).forEach(row => {
    const code = row[0]
    if (typeof code !== "string") return
    const isLeaf = /^PLF\.\d{2}\.\d{2}\./.test(code)
    const isRevenue = code.startsWith("PLF.01")
    if (!isLeaf) return

    col2026.forEach(({ idx, ym }) => {
      const v = row[idx]
      if (typeof v === "number" && v !== 0) {
        monthCounts[ym]++
        if (isRevenue) monthRevenue[ym] = (monthRevenue[ym] ?? 0) + v
      }
    })
  })

  console.log(`\n${entity} (${sheetName}): ${col2026.length} 2026 cols detected`)
  col2026.forEach(({ ym }) => {
    const rev = monthRevenue[ym]
    const flag = rev > 0 ? "✅" : monthCounts[ym] > 0 ? "⚠️ (no revenue)" : "❌ zero"
    console.log(`  ${ym}: ${monthCounts[ym]} non-zero rows | revenue=${Math.round(rev).toLocaleString()} AZN ${flag}`)
  })
}
