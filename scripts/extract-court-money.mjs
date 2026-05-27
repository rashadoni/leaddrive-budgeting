#!/usr/bin/env node
/**
 * 2026-05-27 — Extract money-at-risk from court case descriptions.
 *
 * Source: Açıq məhkəmə mübahisələri.xlsx column G "Case Description"
 * Pattern: AZN amounts appear in prose with various formats:
 *   "13276,92 manat borc məbləği"
 *   "23130 manat icarə haqqı"
 *   "13.500 AZN"
 *   "kompensasiya 5000 AZN"
 *
 * Regex captures `<number with optional commas/dots> manat|AZN`,
 * sums per entity, writes as OperationalFact metric `LEGAL_MONEY_AT_RISK`.
 *
 * Caveats: this is best-effort regex extraction. Some cases have no
 * amount stated (regulatory disputes, labor disputes). Sum is a floor
 * estimate of disclosed exposure.
 */

import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env") });
import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const SOURCE =
  "/Users/rashadrahimov/Documents/budget azersheker/Açıq məhkəmə mübahisələri.xlsx";
const PERIOD_DATE = new Date("2026-12-31T00:00:00.000Z");

const prisma = new PrismaClient();

// Match number followed by manat / AZN. Number may have:
//   - thousands sep: ',' or '.' or ' '
//   - decimal sep: ',' or '.'
// Examples: "13276,92 manat", "13.500 AZN", "5 000 manat"
// We treat ',' as decimal separator IF followed by 1-2 digits and
// no other commas/dots after; otherwise as thousand-sep.
const MONEY_RE = /([0-9][\d.,\s]*[0-9]|[0-9])\s*(manat|AZN|AZN-?dan|manatlıq|man\.?)/gi;

/** Parse AZN-style number with mixed thousands/decimal separators.
 *  "13276,92" → 13276.92
 *  "13.500"   → 13500 (could also be 13.5, ambiguous — treat dot as thousands sep
 *               if 3 digits follow)
 *  "5 000"    → 5000
 *  "1.234.567,89" → 1234567.89 */
function parseAmount(raw) {
  const cleaned = raw.replace(/\s/g, "");
  // Pure integer
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  // Last separator is decimal if followed by exactly 1-2 digits
  // and there's no other separator after it
  const m = cleaned.match(/^(.+?)([.,])(\d{1,2})$/);
  if (m) {
    const intPart = m[1].replace(/[.,\s]/g, "");
    const decPart = m[3];
    const n = Number(`${intPart}.${decPart}`);
    if (Number.isFinite(n)) return n;
  }
  // No clear decimal — strip all separators
  const n = Number(cleaned.replace(/[.,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const ENTITY_MAP = {
  "AZSEKER-AZSF": ["azərşəkər", "azerseker", "azersheker", "azerşəkər"],
  "AZSEKER-CPC": ["cpc", "qkc"],
  "AZSEKER-EDEN": ["eden agro", "eden", "edən"],
  "AZSEKER-MALT": ["malt", "promalt"],
};

function detectEntityCodes(claimantText, defendantText) {
  const codes = [];
  const haystack = `${claimantText} ${defendantText}`.toLowerCase();
  for (const [code, patterns] of Object.entries(ENTITY_MAP)) {
    for (const p of patterns) {
      if (haystack.includes(p)) {
        codes.push(code);
        break;
      }
    }
  }
  return codes;
}

async function main() {
  console.log("→ Reading", SOURCE);
  const wb = XLSX.readFile(SOURCE);
  const ws = wb.Sheets["Məhkəmə mübahisələri"];
  if (!ws) throw new Error("Sheet not found");

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  // Row 3 (index 2) is header. Data starts at row 4 (index 3).
  // Columns: A=#, B=Tarix, C=Məhkəmə, D=İddiaçı, E=Cavabdeh,
  //          F=Pul tələb (TYPE not amount), G=Case Description,
  //          H=Departament, I=Hüquq, J=Status, K=Məhkəmə vaxtı,
  //          L=Görülən tədbirlər

  const perEntityTotal = {};
  const perEntityCount = {};
  const perCaseDetail = [];

  for (let i = 3; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    if (!row[0]) continue;
    const caseNum = row[0];
    const claimant = String(row[3] ?? "");
    const defendant = String(row[4] ?? "");
    const desc = String(row[6] ?? "");
    const fullText = `${claimant} | ${defendant} | ${desc}`;

    // Detect entities
    const codes = detectEntityCodes(claimant, defendant);
    if (codes.length === 0) continue;

    // Extract amounts
    let caseTotal = 0;
    const matches = [...desc.matchAll(MONEY_RE)];
    for (const m of matches) {
      const amount = parseAmount(m[1]);
      // Skip suspiciously small or huge values
      if (amount < 1 || amount > 100_000_000) continue;
      caseTotal += amount;
    }
    if (caseTotal === 0) continue;

    for (const code of codes) {
      perEntityTotal[code] = (perEntityTotal[code] ?? 0) + caseTotal;
      perEntityCount[code] = (perEntityCount[code] ?? 0) + 1;
      perCaseDetail.push({
        entity: code,
        caseNum,
        amount: caseTotal,
        desc: desc.slice(0, 80),
      });
    }
  }

  console.log(`\n  Extracted money from ${perCaseDetail.length} cases (with explicit AZN amounts)`);
  console.log("\n  Per-entity totals:");
  for (const [code, total] of Object.entries(perEntityTotal).sort(
    (a, b) => b[1] - a[1],
  )) {
    const n = perEntityCount[code];
    console.log(`    ${code.padEnd(22)} ${n.toString().padStart(2)} cases · ${Math.round(total).toLocaleString().padStart(15)} AZN`);
  }

  // Sample cases
  console.log("\n  Sample largest cases:");
  for (const c of perCaseDetail.sort((a, b) => b.amount - a.amount).slice(0, 8)) {
    console.log(`    [${c.caseNum}] ${c.entity}  ${Math.round(c.amount).toLocaleString()} AZN — ${c.desc}…`);
  }

  // Write to OperationalFact
  console.log("\n→ Writing LEGAL_MONEY_AT_RISK facts to DB");
  const companies = await prisma.company.findMany({
    where: { code: { in: Object.keys(perEntityTotal) }, isActive: true },
    select: { id: true, code: true, organizationId: true },
  });

  for (const co of companies) {
    const amount = Math.round(perEntityTotal[co.code]);
    await prisma.operationalFact.deleteMany({
      where: { companyId: co.id, metric: "LEGAL_MONEY_AT_RISK", date: PERIOD_DATE },
    });
    await prisma.operationalFact.create({
      data: {
        organizationId: co.organizationId,
        companyId: co.id,
        metric: "LEGAL_MONEY_AT_RISK",
        date: PERIOD_DATE,
        value: amount,
        unit: "AZN",
        source: "Açıq məhkəmə mübahisələri.xlsx (regex extraction from Case Description)",
      },
    });
    console.log(`  ✓ ${co.code}: ${amount.toLocaleString()} AZN`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
