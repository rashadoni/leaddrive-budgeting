/**
 * Audit script: scans every AZMADE xlsx in `~/Documents/budgets azmade/`
 * for accounts that book ≥80% of their annual amount in a single month
 * (typically December).
 *
 * Surfaced by Turn 38 user question: "net margin силтно падает под конец
 * года это норм?" — annual D&A / non-operating loss / tax true-ups commonly
 * land in December under AZ SAP practice. This script reproduces the
 * evidence chain (xlsx → DB) without re-querying.
 *
 * Usage:
 *   npx tsx scripts/audit-dec-lumps.ts                    # default 731/741/751/761/771/801
 *   npx tsx scripts/audit-dec-lumps.ts --code 731,761     # custom prefix list
 *   npx tsx scripts/audit-dec-lumps.ts --threshold 50     # lower lump-detection bar
 */

import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_PREFIXES = ["731", "741", "751", "761", "771", "801"];
const DEFAULT_THRESHOLD_PCT = 80;

const args = process.argv.slice(2);
const codeArg = args.indexOf("--code");
const prefixes =
  codeArg !== -1 && args[codeArg + 1]
    ? args[codeArg + 1].split(",").map((s) => s.trim())
    : DEFAULT_PREFIXES;
const threshArg = args.indexOf("--threshold");
const lumpThreshold =
  threshArg !== -1 && args[threshArg + 1]
    ? Number(args[threshArg + 1])
    : DEFAULT_THRESHOLD_PCT;

const dir = `${process.env.HOME}/Documents/budgets azmade`;
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".xlsx"));

console.log(
  `Scanning ${files.length} xlsx files for code prefixes [${prefixes.join(", ")}] with ≥${lumpThreshold}% annual concentration in any single month\n`,
);

let totalLumps = 0;

for (const file of files) {
  const wb = XLSX.readFile(path.join(dir, file));
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    for (const r of rows) {
      const code = String(r[0] ?? "").trim();
      if (!prefixes.some((p) => code.startsWith(p))) continue;
      const description = String(r[1] ?? "").trim();
      const months = r.slice(2, 14).map((v) => Number(v) || 0);
      const annual = months.reduce((s, v) => s + v, 0);
      if (Math.abs(annual) < 50_000) continue; // skip noise
      // Find the month with the largest |value| relative to |annual|
      let maxIdx = -1;
      let maxRatio = 0;
      months.forEach((v, i) => {
        const ratio = annual !== 0 ? Math.abs(v / annual) * 100 : 0;
        if (ratio > maxRatio) {
          maxRatio = ratio;
          maxIdx = i;
        }
      });
      if (maxRatio >= lumpThreshold) {
        const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][maxIdx];
        console.log(
          `[${file.slice(0, 30)} / ${sheetName.slice(0, 14)}] ${code} (${description.slice(0, 36)}): ${monthName}=${Math.round(months[maxIdx]).toLocaleString()}, Annual=${Math.round(annual).toLocaleString()}, ${maxRatio.toFixed(0)}%`,
        );
        totalLumps += 1;
      }
    }
  }
}

console.log(`\nTotal lumps found: ${totalLumps}`);
