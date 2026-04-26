/**
 * Cross-check AZMADE BudgetLines in DB vs source xlsx files.
 *
 * For each company: parses the source sheet, computes parsed.plannedAnnual
 * sum per accountType (revenue / cogs / expense), then compares to the DB
 * sum across all 12 month-rows. Reports diffs > 1 ₼ as warnings.
 *
 * Source files (per scripts/import-azmade-budgets.ts JOBS[]):
 *   - LLS-MAIN  ← rev6 LLS / SOPL
 *   - SPARK-MAIN ← rev7 SPARK / SOPL
 *   - ZTP-MAIN   ← rev8 ZTP / SOPL
 *   - ATL-DBZ    ← rev9 ATL / SOPL P-F DBZ 2026
 *   - ATL-PMZ    ← rev9 ATL / SOPL P-F PMZ 2026
 *   - ATL-TAZ    ← rev9 ATL / SOPL P-F TAZ 2026
 *   - ATL-MRKZ   ← rev9 ATL / 5-2 2026 büdcə mrkz daxil (rollup)
 *   - AAC-MAIN   ← Downloads AAC / P&L
 */

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { parseSoplSheet, parseSummaryRollupSheet } from "../src/lib/onboarding/adapters/azmade-sopl";

const prisma = new PrismaClient();

const ORG_SLUG = "azmade";
const BUDGETS_DIR = "/Users/rashadrahimov/Documents/budgets azmade";
const AAC_PATH = "/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx";

interface JobSpec {
  file: string;
  sheet: string;
  companyCode: string;
  parser: "sopl" | "rollup";
  rollupColumnHeader?: string;
}

const JOBS: JobSpec[] = [
  { file: `${BUDGETS_DIR}/rev6 - 2026 Budget - LLS.xlsx`, sheet: "SOPL", companyCode: "LLS-MAIN", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev7 - 2026 Budget - -SPARK.xlsx`, sheet: "SOPL", companyCode: "SPARK-MAIN", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev8 - 2026 Budget - ZTP.xlsx`, sheet: "SOPL", companyCode: "ZTP-MAIN", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev 9 - 2026 Budget - ATL.xlsx`, sheet: "SOPL P-F DBZ 2026", companyCode: "ATL-DBZ", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev 9 - 2026 Budget - ATL.xlsx`, sheet: "SOPL P-F PMZ 2026", companyCode: "ATL-PMZ", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev 9 - 2026 Budget - ATL.xlsx`, sheet: "SOPL P-F TAZ 2026", companyCode: "ATL-TAZ", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev 9 - 2026 Budget - ATL.xlsx`, sheet: "5-2 2026 büdcə mrkz daxil", companyCode: "ATL-MRKZ", parser: "rollup", rollupColumnHeader: "Mərkəz" },
  { file: AAC_PATH, sheet: "P&L", companyCode: "AAC-MAIN", parser: "sopl" },
];

interface CompareRow {
  company: string;
  sheet: string;
  // parsed (xlsx)
  xlsxLines: number;
  xlsxRevenue: number;
  xlsxCogs: number;
  xlsxExpense: number;
  // db
  dbLines: number; // 12 × parsed (post-Turn-34 monthly expansion)
  dbRevenue: number;
  dbCogs: number;
  dbExpense: number;
  // diffs (xlsx − db)
  revDiff: number;
  cogsDiff: number;
  expDiff: number;
  // warnings from parser
  parentRollupsDropped: number;
  parentRollupsUnallocated: number;
}

async function compareJob(job: JobSpec): Promise<CompareRow> {
  // Parse xlsx
  const wb = XLSX.readFile(job.file);
  const parsed =
    job.parser === "sopl"
      ? parseSoplSheet(wb, job.sheet, XLSX)
      : parseSummaryRollupSheet(wb, job.sheet, job.rollupColumnHeader!, XLSX);

  let xlsxRevenue = 0, xlsxCogs = 0, xlsxExpense = 0;
  for (const line of parsed.lines) {
    const annual = line.plannedAnnual;
    if (line.accountType === "revenue") xlsxRevenue += annual;
    else if (line.accountType === "cogs") xlsxCogs += annual;
    else xlsxExpense += annual;
  }

  // Query DB
  const company = await prisma.company.findFirst({
    where: { code: job.companyCode, organization: { slug: ORG_SLUG } },
  });
  if (!company) throw new Error(`Company ${job.companyCode} not found`);

  const dbLines = await prisma.budgetLine.findMany({
    where: { companyId: company.id },
    select: { lineType: true, plannedAmount: true },
  });

  let dbRevenue = 0, dbCogs = 0, dbExpense = 0;
  for (const line of dbLines) {
    if (line.lineType === "revenue") dbRevenue += line.plannedAmount;
    else if (line.lineType === "cogs") dbCogs += line.plannedAmount;
    else dbExpense += line.plannedAmount;
  }

  return {
    company: job.companyCode,
    sheet: job.sheet,
    xlsxLines: parsed.lines.length,
    xlsxRevenue,
    xlsxCogs,
    xlsxExpense,
    dbLines: dbLines.length,
    dbRevenue,
    dbCogs,
    dbExpense,
    revDiff: xlsxRevenue - dbRevenue,
    cogsDiff: xlsxCogs - dbCogs,
    expDiff: xlsxExpense - dbExpense,
    parentRollupsDropped: parsed.parentRollupsDropped.length,
    parentRollupsUnallocated: parsed.parentRollupsUnallocated.length,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

async function main() {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`AZMADE per-sheet cross-check vs DB`);
  console.log(`${"=".repeat(80)}\n`);

  const results: CompareRow[] = [];
  for (const job of JOBS) {
    try {
      const result = await compareJob(job);
      results.push(result);
    } catch (err) {
      console.error(`✗ ${job.companyCode}: ${(err as Error).message}`);
    }
  }

  // Print per-company table
  for (const r of results) {
    const ok = Math.abs(r.revDiff) < 1 && Math.abs(r.cogsDiff) < 1 && Math.abs(r.expDiff) < 1;
    const marker = ok ? "✅" : "⚠️ ";
    console.log(`${marker} ${r.company} (sheet="${r.sheet}")`);
    console.log(`   xlsx: ${r.xlsxLines} lines | rev=${fmt(r.xlsxRevenue)} cogs=${fmt(r.xlsxCogs)} exp=${fmt(r.xlsxExpense)}`);
    console.log(`   db:   ${r.dbLines} rows  | rev=${fmt(r.dbRevenue)} cogs=${fmt(r.dbCogs)} exp=${fmt(r.dbExpense)}`);
    if (!ok) {
      console.log(`   diff: rev=${fmt(r.revDiff)} cogs=${fmt(r.cogsDiff)} exp=${fmt(r.expDiff)}`);
    }
    if (r.parentRollupsDropped > 0) console.log(`   parser: ${r.parentRollupsDropped} parent rollups dropped`);
    if (r.parentRollupsUnallocated > 0) console.log(`   parser: ${r.parentRollupsUnallocated} parents unallocated`);
    console.log("");
  }

  // Summary
  const okCount = results.filter((r) => Math.abs(r.revDiff) < 1 && Math.abs(r.cogsDiff) < 1 && Math.abs(r.expDiff) < 1).length;
  console.log(`${"=".repeat(80)}`);
  console.log(`Summary: ${okCount}/${results.length} companies match xlsx ↔ DB exactly`);
  console.log(`${"=".repeat(80)}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    return prisma.$disconnect().then(() => process.exit(1));
  });
