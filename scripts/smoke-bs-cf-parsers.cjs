/**
 * Smoke check — runs parseSofpSheet + parseCfsSheet against REAL client
 * xlsx files and prints summary. Read-only, no DB.
 *
 * Run: `node scripts/smoke-bs-cf-parsers.cjs`
 *
 * Uses require() against compiled JS — for the smoke we use the xlsx
 * package directly + minimal re-implementation of the parsers' header
 * detection. Real parsers are TypeScript and have their own unit tests;
 * this just confirms file shapes are recognizable.
 */
const XLSX = require("xlsx")
const path = require("path")

const FILES = [
  { f: "/Users/rashadrahimov/Documents/budgets azmade/rev6 - 2026 Budget - LLS.xlsx", co: "LLS-MAIN", sofp: "SOFP", cfs: "CFS" },
  { f: "/Users/rashadrahimov/Documents/budgets azmade/rev7 - 2026 Budget - -SPARK.xlsx", co: "SPARK-MAIN", sofp: "SOFP", cfs: "CFS" },
  { f: "/Users/rashadrahimov/Documents/budgets azmade/rev8 - 2026 Budget - ZTP.xlsx", co: "ZTP-MAIN", sofp: "SOFP", cfs: "CFS" },
  { f: "/Users/rashadrahimov/Documents/budgets azmade/rev 9 - 2026 Budget - ATL.xlsx", co: "ATL-MRKZ", sofp: "SOFP", cfs: "CFS" },
  { f: "/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx", co: "AAC-MAIN", sofp: "BS", cfs: "CF" },
]

// Mirror real parser: aliases include Turkish-İ form so both sides of the
// equality go through .toLowerCase() and produce the same combining-char
// encoding (İ → "i" + U+0307). Mismatched encodings is what tripped me up
// the first time — see commit message for full root-cause writeup.
const MONTH_ALIASES = [
  ["Yanvar", "Jan", "January"],
  ["Fevral", "Feb", "February"],
  ["Mart", "Mar", "March"],
  ["Aprel", "Apr", "April"],
  ["May"],
  ["İyun", "Iyun", "Jun", "June"],
  ["İyul", "Iyul", "Jul", "July"],
  ["Avqust", "Aug", "August"],
  ["Sentyabr", "Sep", "September"],
  ["Oktyabr", "Oct", "October"],
  ["Noyabr", "Nov", "November"],
  ["Dekabr", "Dec", "December"],
]

function normalize(v) {
  if (typeof v !== "string") return ""
  return v.trim().replace(/\s+/g, "").toLowerCase()
}

function isPlanMonthHeader(cell, monthIdx) {
  const n = normalize(cell)
  if (!n) return false
  for (const aliasRaw of MONTH_ALIASES[monthIdx]) {
    const a = aliasRaw.toLowerCase() // mirrors azmade-sopl.ts pipeline
    if (n === a || n === a + "plan") return true
  }
  return false
}

function findHeaderRow(aoa) {
  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i]
    if (!row) continue
    const all = MONTH_ALIASES.every((_, m) => row.some((c) => isPlanMonthHeader(c, m)))
    if (all) return i
  }
  return -1
}

function probeSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return { exists: false }
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false })
  const headerRowIdx = findHeaderRow(aoa)
  if (headerRowIdx === -1) return { exists: true, headerFound: false, totalRows: aoa.length }

  const headerRow = aoa[headerRowIdx] || []
  const monthCols = []
  for (let m = 0; m < 12; m++) {
    monthCols.push(headerRow.findIndex((c) => isPlanMonthHeader(c, m)))
  }

  // Count data rows below header that have label + at least one non-zero month
  let labelCol = -1
  for (let c = 0; c < monthCols[0]; c++) {
    const v = headerRow[c]
    if (typeof v === "string" && v.trim()) {
      labelCol = c
      break
    }
  }
  if (labelCol === -1) labelCol = 0

  let withLabelAndData = 0
  let allZero = 0
  let labelOnly = 0
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    const lab = typeof row[labelCol] === "string" ? row[labelCol].trim() : ""
    if (!lab) continue
    let total = 0
    for (let m = 0; m < 12; m++) {
      const v = row[monthCols[m]]
      if (typeof v === "number") total += Math.abs(v)
      else if (typeof v === "string") {
        const n = Number(v.replace(/,/g, "."))
        if (Number.isFinite(n)) total += Math.abs(n)
      }
    }
    if (total === 0) allZero++
    else withLabelAndData++
    labelOnly++
  }

  return {
    exists: true,
    headerFound: true,
    headerRow: headerRowIdx + 1,
    labelCol: labelCol + 1,
    monthColsRange: `${monthCols[0] + 1}..${monthCols[11] + 1}`,
    totalLabeledRows: labelOnly,
    candidateLines: withLabelAndData,
    allZeroSkipped: allZero,
  }
}

console.log("\n=== BS+CF parser smoke against REAL files ===\n")
for (const job of FILES) {
  console.log(`📄 ${path.basename(job.f)} → ${job.co}`)
  let wb
  try { wb = XLSX.readFile(job.f, { cellFormula: false, cellHTML: false }) }
  catch (e) { console.log(`  ✗ open failed: ${e.message}`); continue }

  const sofp = probeSheet(wb, job.sofp)
  console.log(`  ${job.sofp.padEnd(5)} → ${JSON.stringify(sofp)}`)
  const cfs = probeSheet(wb, job.cfs)
  console.log(`  ${job.cfs.padEnd(5)} → ${JSON.stringify(cfs)}`)
  console.log("")
}
