#!/usr/bin/env node
/**
 * 2026-05-26 — Import 218 internal-audit findings as per-company
 * compliance metrics.
 *
 * Source: /Users/rashadrahimov/Documents/budget azersheker/Follow up - For GTC.xlsx
 * Sheet:  "Follow-up"
 * Format: # | Müşahidə növü | Cavabdeh struktur | Şirkət | Yoxlama | Plan tarixi
 *         | Status (MNG) | Groupping | Müşahidə növü | Finding status Jan-26 |
 *         Next deadline_MNG
 *
 * Outputs per (company, period=2026):
 *   - audit_findings_total
 *   - audit_findings_completed
 *   - audit_findings_major_open      ← Major + Major NC still not completed
 *   - audit_findings_minor_open      ← Minor + Minor NC still not completed
 *   - audit_findings_observation_open  ← Observation/OFI still not completed
 *   - audit_findings_completed_pct
 *
 * Also stores the FULL findings list in Company.settings.auditFindings
 * for drill-down UI later. Triggers recompute on the affected companies.
 *
 * Idempotent — upserts OperationalFacts; overwrites settings.auditFindings.
 */

import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env") });

import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const SOURCE =
  "/Users/rashadrahimov/Documents/budget azersheker/Follow up - For GTC.xlsx";
const PERIOD = "2026";

const COMPANY_MAP = {
  "Azərşəkər": "AZSEKER-AZSF",
  "CPC MMC": "AZSEKER-CPC",
};

// "Yerinə yetirilib" = completed; case variants exist
const COMPLETED_RE = /yerinə yetirilib/i;

// Map raw severity → bucket
function severityBucket(raw) {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (s === "major" || s === "major nc") return "major";
  if (s === "minor" || s === "minor nc") return "minor";
  if (s === "observation" || s === "ofi") return "observation";
  return "other";
}

const prisma = new PrismaClient();

async function main() {
  console.log("→ Reading", SOURCE);
  const wb = XLSX.readFile(SOURCE);
  const ws = wb.Sheets["Follow-up"];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Headers in row 2 (idx 1); data from row 3 (idx 2)
  const dataRows = aoa
    .slice(2)
    .filter((r) => r && r.some((c) => c !== "" && c != null));
  console.log(`  ${dataRows.length} non-empty data rows`);

  // Parse each row
  const parsed = [];
  for (const r of dataRows) {
    const severityRaw = String(r[1] ?? "").trim();
    const companyRaw = String(r[3] ?? "").trim();
    const auditName = String(r[4] ?? "").trim();
    const planDate = r[5]; // Excel date serial or string
    const statusMng = String(r[6] ?? "").trim();
    const grouping = String(r[7] ?? "").trim();
    const findingStatusJan = String(r[9] ?? "").trim();

    if (!severityRaw || !companyRaw) continue;

    const companyCode = COMPANY_MAP[companyRaw];
    if (!companyCode) {
      console.log(`  ⚠ unmapped company "${companyRaw}" — skipping`);
      continue;
    }

    parsed.push({
      severity: severityRaw,
      severityBucket: severityBucket(severityRaw),
      companyCode,
      auditName,
      planDate,
      statusMng,
      grouping,
      findingStatusJan,
      isCompleted: COMPLETED_RE.test(statusMng),
    });
  }

  console.log(`✓ Parsed ${parsed.length} findings`);

  // Aggregate per company
  const byCompany = {};
  for (const f of parsed) {
    const c = (byCompany[f.companyCode] ??= {
      total: 0,
      completed: 0,
      major_open: 0,
      minor_open: 0,
      observation_open: 0,
      findings: [],
    });
    c.total += 1;
    if (f.isCompleted) c.completed += 1;
    else if (f.severityBucket === "major") c.major_open += 1;
    else if (f.severityBucket === "minor") c.minor_open += 1;
    else if (f.severityBucket === "observation") c.observation_open += 1;
    c.findings.push({
      severity: f.severity,
      audit: f.auditName,
      status: f.statusMng,
      grouping: f.grouping,
      findingStatusJan: f.findingStatusJan,
    });
  }

  console.log("\n  Per company aggregate:");
  for (const [code, agg] of Object.entries(byCompany)) {
    const pct = agg.total > 0 ? Math.round((agg.completed / agg.total) * 100) : 0;
    console.log(
      `    ${code}: total=${agg.total}, completed=${agg.completed} (${pct}%), major_open=${agg.major_open}, minor_open=${agg.minor_open}, observation_open=${agg.observation_open}`,
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

  for (const co of companies) {
    const agg = byCompany[co.code];
    if (!agg) continue;
    const pct = agg.total > 0 ? Math.round((agg.completed / agg.total) * 100) : 0;

    // 6 OperationalFacts. Schema uses `date: DateTime` (not `period`)
    // and has no unique index, so we deleteMany + createMany for
    // idempotency on (companyId, metric, date).
    const recordDate = new Date(`${PERIOD}-12-31T00:00:00.000Z`);
    const metricRows = [
      { metric: "audit_findings_total", value: agg.total },
      { metric: "audit_findings_completed", value: agg.completed },
      { metric: "audit_findings_major_open", value: agg.major_open },
      { metric: "audit_findings_minor_open", value: agg.minor_open },
      { metric: "audit_findings_observation_open", value: agg.observation_open },
      { metric: "audit_findings_completed_pct", value: pct },
    ];

    await prisma.operationalFact.deleteMany({
      where: {
        companyId: co.id,
        metric: { in: metricRows.map((m) => m.metric) },
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
        unit: metric.endsWith("_pct") ? "%" : "count",
        source: "Follow up - For GTC.xlsx",
      })),
    });

    // Store full list in Company.settings.auditFindings
    const newSettings = {
      ...(co.settings ?? {}),
      auditFindings: {
        source: "Follow up - For GTC.xlsx",
        importedAt: new Date().toISOString(),
        summary: {
          total: agg.total,
          completed: agg.completed,
          completedPct: pct,
          major_open: agg.major_open,
          minor_open: agg.minor_open,
          observation_open: agg.observation_open,
        },
        items: agg.findings,
      },
    };
    await prisma.company.update({
      where: { id: co.id },
      data: { settings: newSettings },
    });

    console.log(
      `✓ ${co.code}: 6 facts upserted + settings.auditFindings (${agg.findings.length} items)`,
    );
  }

  await prisma.$disconnect();
  console.log("\n✓ Done. Run recompute to refresh HeatMap indicators if any depend on these metrics.");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
