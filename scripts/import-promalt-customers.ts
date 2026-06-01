/**
 * Import the REAL ProMalt/MALT customer list from the client workbook
 * (Guvven Fin.xlsx → "Satış ProMalt" sheet) into Counterparty.
 *
 * This is the ONE real customer list the client provided (per
 * AzerSheker_Çatışmayan_Məlumatlar.docx §D + Data_Coverage_Audit.docx:
 * "Top-10 customers — delivered for MALT only"). Names are anonymized by
 * the client as "Müştəri 1…6"; prices + monthly volumes are real.
 * sharePct = customer annual AZN / total annual AZN.
 *
 * Idempotent: clears existing MALT customer counterparties (period 2026)
 * then inserts. Run dry-run first, then --apply.
 */
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";

const SRC = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx";
const SHEET = "Satış ProMalt";
const PERIOD = "2026";

function parseCustomers() {
  const wb = XLSX.readFile(SRC);
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`sheet '${SHEET}' not found in ${SRC}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
  const custRows = rows.filter((r) => typeof r[0] === "string" && /^Müştəri\s*\d/i.test(r[0] as string));
  const parsed = custRows.map((r) => {
    const name = String(r[0]).trim();
    const price = Number(r[1]) || 0;
    let annual = 0;
    let qty = 0;
    for (let c = 3; c <= 25; c += 2) { const v = Number(r[c]); if (Number.isFinite(v)) annual += v; }
    for (let c = 2; c <= 24; c += 2) { const v = Number(r[c]); if (Number.isFinite(v)) qty += v; }
    return { name, price, annualQty: qty, annualAmount: annual };
  });
  const total = parsed.reduce((s, p) => s + p.annualAmount, 0);
  return { parsed, total };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { parsed, total } = parseCustomers();

  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } });
  if (!org) throw new Error("org 'azmade' not found");
  const malt = await prisma.company.findFirst({ where: { organizationId: org.id, code: "AZSEKER-MALT" }, select: { id: true } });
  if (!malt) throw new Error("AZSEKER-MALT not found");

  console.log(`\n=== ProMalt customers (${apply ? "APPLY" : "DRY RUN"}) — total ${Math.round(total).toLocaleString()} AZN ===`);
  const records = parsed.map((p) => ({
    organizationId: org.id,
    companyId: malt.id,
    role: "customer",
    name: p.name,
    sharePct: total ? (p.annualAmount / total) * 100 : 0,
    annualAmount: p.annualAmount || null,
    period: PERIOD,
    notes: `ProMalt/MALT buyer · ${p.price} AZN/t · ${Math.round(p.annualQty)} t/yr · anonymized by client (Satış ProMalt sheet)`,
  }));
  for (const r of records) console.log(`  ${r.name.padEnd(11)} share=${r.sharePct.toFixed(1)}%  annual=${r.annualAmount ?? 0} AZN`);

  if (!apply) { console.log("\nDRY RUN — re-run with --apply to insert.\n"); await prisma.$disconnect(); return; }

  await prisma.$transaction(async (tx) => {
    await tx.counterparty.deleteMany({ where: { companyId: malt.id, role: "customer", period: PERIOD } });
    await tx.counterparty.createMany({ data: records });
  });
  const n = await prisma.counterparty.count({ where: { companyId: malt.id, role: "customer", period: PERIOD } });
  console.log(`\n✓ Inserted. MALT now has ${n} customer counterparties. Recompute MALT concentration next.\n`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
