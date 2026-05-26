#!/usr/bin/env node
/**
 * 2026-05-26 — Import 54 court disputes from
 * "Açıq məhkəmə mübahisələri.xlsx" as per-company legal-risk metrics.
 *
 * Replaces the prior coarse aggregate (6 facts total) with full
 * per-case breakdown:
 *   - court_disputes_total
 *   - court_disputes_open       — status not in closed-keyword set
 *   - court_disputes_as_defendant
 *   - court_disputes_as_plaintiff
 *   - court_disputes_money_claims     — Pul tələb mentions amount
 *
 * Entity attribution: scan İddiaçı + Cavabdeh columns for substring
 * matches against {Azərşəkər, CPC, Eden Agro, Malt, Promalt}. A single
 * row can credit multiple entities (e.g. "Azərşəkər + Füzuli RİH").
 * Stores per-case detail in Company.settings.courtDisputes for UI.
 */

import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env") });

import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const SOURCE =
  "/Users/rashadrahimov/Documents/budget azersheker/Açıq məhkəmə mübahisələri.xlsx";
const PERIOD = "2026";

// Substring → company code. Tested case-insensitively against the
// combined İddiaçı + Cavabdeh text. Order matters for overlap (CPC
// before generic Azərşəkər because the AZSEKER root substring is broad).
const COMPANY_MATCHERS = [
  { pattern: /cpc/i, code: "AZSEKER-CPC" },
  { pattern: /eden\s*agro/i, code: "AZSEKER-EDEN" },
  { pattern: /promalt|pro\s*malt/i, code: "AZSEKER-PROMALT" },
  { pattern: /\bmalt\b/i, code: "AZSEKER-MALT" },
  { pattern: /azərşəkər/i, code: "AZSEKER-AZSF" },
];

// Status text → "closed" if any of these keywords present (Azerbaijani).
// Default = open.
const CLOSED_KEYWORDS = [
  /icraata xitam/i,
  /təmin edilməyib/i,
  /təmin edilmiş/i,
  /mümkün sayılmamış/i,
  /qətnamə.*çıxarıl/i,
  /qərardad/i,
  /icra edilmiş/i,
  /bağlanmışdır/i,
  /xitam verilib/i,
];

const prisma = new PrismaClient();

function attributeCompanies(claimant, defendant) {
  const text = `${claimant} || ${defendant}`;
  const codes = new Set();
  for (const { pattern, code } of COMPANY_MATCHERS) {
    if (pattern.test(text)) codes.add(code);
  }
  return [...codes];
}

function isClosed(status) {
  if (!status) return false;
  return CLOSED_KEYWORDS.some((re) => re.test(status));
}

function hasMoneyClaim(disputeType, caseDescription) {
  return /pul tələb|kommersiya|borc|cərimə|məbləğ/i.test(
    `${disputeType} ${caseDescription}`,
  );
}

async function main() {
  console.log("→ Reading", SOURCE);
  const wb = XLSX.readFile(SOURCE);
  const ws = wb.Sheets["Məhkəmə mübahisələri"];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Header at row 3 (idx 2); data from row 4 (idx 3)
  const dataRows = aoa
    .slice(3)
    .filter((r) => r && r[0] !== "" && r[0] != null);
  console.log(`  ${dataRows.length} non-empty case rows`);

  // Per-company aggregates
  const byCompany = {};

  for (const r of dataRows) {
    const [
      _num,
      date,
      court,
      claimant,
      defendant,
      disputeType,
      caseDesc,
      _dept,
      _lawyer,
      status,
    ] = r.map((c) => (c == null ? "" : String(c).trim()));

    const codes = attributeCompanies(claimant, defendant);
    if (codes.length === 0) continue;

    const closed = isClosed(status);
    const isDefendant = /azərşəkər|cpc|eden|malt|promalt/i.test(defendant);
    const isPlaintiff = /azərşəkər|cpc|eden|malt|promalt/i.test(claimant);
    const hasMoney = hasMoneyClaim(disputeType, caseDesc);

    for (const code of codes) {
      const c = (byCompany[code] ??= {
        total: 0,
        open: 0,
        as_defendant: 0,
        as_plaintiff: 0,
        money_claims: 0,
        cases: [],
      });
      c.total += 1;
      if (!closed) c.open += 1;
      if (isDefendant) c.as_defendant += 1;
      if (isPlaintiff) c.as_plaintiff += 1;
      if (hasMoney) c.money_claims += 1;
      c.cases.push({
        date,
        court,
        claimant,
        defendant,
        disputeType,
        status: status.slice(0, 200),
        closed,
      });
    }
  }

  console.log("\n  Per company aggregate:");
  for (const [code, agg] of Object.entries(byCompany)) {
    console.log(
      `    ${code}: total=${agg.total}, open=${agg.open}, defendant=${agg.as_defendant}, plaintiff=${agg.as_plaintiff}, money_claims=${agg.money_claims}`,
    );
  }

  // Look up Company + organizationId
  const companies = await prisma.company.findMany({
    where: {
      code: { in: Object.keys(byCompany) },
      isActive: true,
    },
    select: { id: true, code: true, organizationId: true, settings: true },
  });

  if (companies.length === 0) {
    throw new Error("No matching companies found in DB");
  }

  const recordDate = new Date(`${PERIOD}-12-31T00:00:00.000Z`);
  const ALL_METRICS = [
    "court_disputes_total",
    "court_disputes_open",
    "court_disputes_as_defendant",
    "court_disputes_as_plaintiff",
    "court_disputes_money_claims",
  ];

  for (const co of companies) {
    const agg = byCompany[co.code];
    if (!agg) continue;

    const metricRows = [
      { metric: "court_disputes_total", value: agg.total },
      { metric: "court_disputes_open", value: agg.open },
      { metric: "court_disputes_as_defendant", value: agg.as_defendant },
      { metric: "court_disputes_as_plaintiff", value: agg.as_plaintiff },
      { metric: "court_disputes_money_claims", value: agg.money_claims },
    ];

    await prisma.operationalFact.deleteMany({
      where: {
        companyId: co.id,
        metric: { in: ALL_METRICS },
        date: recordDate,
      },
    });

    await prisma.operationalFact.createMany({
      data: metricRows.map(({ metric, value }) => ({
        organizationId: co.organizationId,
        companyId: co.id,
        metric,
        date: recordDate,
        value,
        unit: "count",
        source: "Açıq məhkəmə mübahisələri.xlsx",
      })),
    });

    const newSettings = {
      ...(co.settings ?? {}),
      courtDisputes: {
        source: "Açıq məhkəmə mübahisələri.xlsx",
        importedAt: new Date().toISOString(),
        summary: {
          total: agg.total,
          open: agg.open,
          as_defendant: agg.as_defendant,
          as_plaintiff: agg.as_plaintiff,
          money_claims: agg.money_claims,
        },
        cases: agg.cases,
      },
    };

    await prisma.company.update({
      where: { id: co.id },
      data: { settings: newSettings },
    });

    console.log(
      `✓ ${co.code}: 5 facts + settings.courtDisputes (${agg.cases.length} cases)`,
    );
  }

  await prisma.$disconnect();
  console.log("\n✓ Done.");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
