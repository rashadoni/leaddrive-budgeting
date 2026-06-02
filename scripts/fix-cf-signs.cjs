/**
 * Surgical correction for the CF refund-sign bug (parsePlfCfSheet pre-fix
 * abs'd monthly values + forced direction by code segment, flipping refund
 * months). The stored AMOUNT (magnitude) is correct; only the per-month
 * entryType (inflow/outflow direction) is wrong on mixed-sign months.
 *
 * This re-derives the correct entryType from each month's SIGN in the source
 * file and flips the mismatched CashFlowEntry rows. amount untouched.
 *
 * DEFAULT dry-run. Pass --apply to write.
 */
const XLSX = require("xlsx")
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
const APPLY = process.argv.includes("--apply")
const FILE = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const CF_SOURCE_TAG = "azseker-workbook-cf"
const LEAF = /^CF\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/
const SHEETS = [
  ["CF CPC", "AZSEKER-CPC"], ["CF AZSF", "AZSEKER-AZSF"],
  ["CF EDEN", "AZSEKER-EDEN"], ["CF Malt", "AZSEKER-MALT"],
]
const fmt = (n) => Math.round(n).toLocaleString()
const ds = (s) => new Date(Date.UTC(1899, 11, 30 + s)).toISOString().slice(0, 7)

function fileSigns() {
  // (entityCode::cfCode::month) → signed value
  const wb = XLSX.readFile(FILE)
  const map = new Map()
  for (const [sheet, code] of SHEETS) {
    const ws = wb.Sheets[sheet]; if (!ws) continue
    const R = XLSX.utils.decode_range(ws["!ref"])
    const cell = (r, c) => { const x = ws[XLSX.utils.encode_cell({ r, c })]; return x ? x.v : null }
    let hdr = -1
    for (let r = 0; r < 6; r++) { let n = 0; for (let c = 2; c <= R.e.c; c++) { const v = cell(r, c); if (typeof v === "number" && v > 43000 && v < 48000) n++ } if (n > 5) { hdr = r; break } }
    const monthCols = []
    for (let c = 2; c <= R.e.c; c++) { const v = cell(hdr, c); if (typeof v === "number" && v >= 46023 && v <= 46357) monthCols.push([c, Number(ds(v).slice(5))]) }
    for (let r = hdr + 1; r <= R.e.r; r++) {
      const cc = cell(r, 0); if (typeof cc !== "string" || !LEAF.test(cc.trim())) continue
      const cf = cc.trim()
      for (const [c, mo] of monthCols) { const v = cell(r, c); if (typeof v === "number" && v !== 0) map.set(`${code}::${cf}::${mo}`, v) }
    }
  }
  return map
}

async function main() {
  const org = await prisma.organization.findFirst({ select: { id: true } })
  const signs = fileSigns()
  const rows = await prisma.cashFlowEntry.findMany({
    where: { organizationId: org.id, year: 2026, deletedAt: null, source: CF_SOURCE_TAG },
    select: { id: true, sourceId: true, month: true, amount: true, entryType: true, activityType: true },
  })
  const flips = [] // {id, from, to, entity, cf, month}
  let noFile = 0
  for (const r of rows) {
    const key = `${r.sourceId}::${r.month}`
    const signed = signs.get(key)
    if (signed === undefined) { noFile++; continue }
    const correct = signed >= 0 ? "inflow" : "outflow"
    if (correct !== r.entryType) {
      const [entity, cf] = r.sourceId.split("::")
      flips.push({ id: r.id, from: r.entryType, to: correct, entity, cf, month: r.month, amount: r.amount, activityType: r.activityType })
    }
  }
  console.log(`\n=== CF sign correction (${APPLY ? "APPLY" : "DRY-RUN"}) ===`)
  console.log(`scanned ${rows.length} CF rows; ${flips.length} need entryType flip; ${noFile} had no file match (left as-is)\n`)
  const byEnt = {}
  for (const f of flips) { byEnt[f.entity] = byEnt[f.entity] || { n: 0, swing: 0 }; byEnt[f.entity].n++; byEnt[f.entity].swing += (f.to === "inflow" ? 2 : -2) * f.amount }
  for (const [e, v] of Object.entries(byEnt)) console.log(`  ${e.padEnd(14)} ${v.n} flips, net swing ${fmt(v.swing)} (${v.swing >= 0 ? "+" : ""}cash)`)
  for (const f of flips.slice(0, 8)) console.log(`    ${f.entity} ${f.cf} m${f.month}: ${f.from}→${f.to} (amount ${fmt(f.amount)}, ${f.activityType})`)
  if (flips.length > 8) console.log(`    … +${flips.length - 8} more`)

  if (APPLY && flips.length) {
    await prisma.$transaction(flips.map((f) => prisma.cashFlowEntry.update({ where: { id: f.id }, data: { entryType: f.to } })))
    console.log(`\n✅ flipped ${flips.length} rows.`)
  } else if (!APPLY) {
    console.log(`\n(DRY-RUN — no writes.)`)
  }

  // reconcile operating net per entity vs file (post-state)
  const after = await prisma.cashFlowEntry.findMany({ where: { organizationId: org.id, year: 2026, deletedAt: null, source: CF_SOURCE_TAG, activityType: "operating" }, select: { sourceId: true, amount: true, entryType: true } })
  const dbOp = {}; for (const e of after) { const ent = e.sourceId.split("::")[0]; dbOp[ent] = (dbOp[ent] || 0) + (e.entryType === "inflow" ? e.amount : -e.amount) }
  // file operating net per entity
  const fileOp = {}; for (const [k, v] of signs) { const [ent, cf] = k.split("::"); if (/^CF\.01\./.test(cf)) fileOp[ent] = (fileOp[ent] || 0) + v }
  console.log(`\noperating CF net (file vs DB ${APPLY ? "after" : "now"}):`)
  for (const [, code] of SHEETS) console.log(`  ${code.padEnd(14)} file=${fmt(fileOp[code] || 0).padStart(12)}  db=${fmt(dbOp[code] || 0).padStart(12)}  ${Math.abs((fileOp[code] || 0) - (dbOp[code] || 0)) < 2 ? "✓" : "Δ " + fmt((fileOp[code] || 0) - (dbOp[code] || 0))}`)
}
main().catch((e) => console.error(e.message || e)).finally(() => prisma.$disconnect())
