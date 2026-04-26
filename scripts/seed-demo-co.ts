/**
 * Seed `DEMO-CO` scratch company for demo Step 3 (Onboarding wizard
 * apply). Without this, customer following DEMO_SCRIPT Step 3 picks an
 * AZMADE op-co (e.g. SPARK-MAIN) → /apply creates a parallel "AI-Imported"
 * BudgetPlan + duplicates BudgetLines (Turn-23 SPARK pickle, requires
 * destructive cleanup script). DEMO-CO is a sacrificial scratch entity
 * — apply against it has no real-data side-effect.
 *
 * Operations (idempotent):
 * 1. Create company `DEMO-CO` (level=2, role=operational, industry='industrial',
 *    parentCompanyId=NULL — independent op directly under the AZMADE org;
 *    same pattern as ATL-MRKZ before its level-1 sub-group existed)
 * 2. Generate `~/Downloads/DEMO-CO.xlsx` with a synthetic SOPL sheet —
 *    ~50 rows across revenue / COGS / OpEx / D&A / tax sections so the
 *    /analyze AI Mapper sees realistic shape (KOD col + AZ-label col +
 *    monthly Jan..Dec cols)
 *
 * Run via: `npx tsx scripts/seed-demo-co.ts`
 *
 * Safe to delete script after demo. The DEMO-CO company can be removed
 * manually if needed (~3 line psql DELETE), or left as permanent demo
 * sandbox.
 */

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import * as path from "path";
import * as os from "os";

const prisma = new PrismaClient();

const ORG_SLUG = "azmade";
const COMPANY_CODE = "DEMO-CO";

// Synthetic P&L rows. KOD column drives the analytics route's section
// classification (601/602/603 → revenue, 701 → COGS, 711/721 → OpEx, etc).
// Monthly distribution: roughly seasonal with summer dip for industrial.
type DemoRow = {
  kod: string;
  label: string;
  // Annual amount distributed across 12 months via SHAPE_FACTORS
  annual: number;
  shape?: "flat" | "summer_dip" | "year_end_spike";
};

const DEMO_ROWS: DemoRow[] = [
  // Revenue (601-XX)
  { kod: "601-01-01", label: "Demo product A satışı", annual: 24_000_000, shape: "summer_dip" },
  { kod: "601-01-02", label: "Demo product B satışı", annual: 18_000_000, shape: "summer_dip" },
  { kod: "601-01-03", label: "Demo product C satışı", annual: 8_500_000, shape: "year_end_spike" },
  { kod: "601-04-01", label: "Demo service revenue", annual: 4_200_000, shape: "flat" },
  { kod: "601-99", label: "Sair satışlar", annual: 1_800_000, shape: "flat" },
  // COGS (701-XX)
  { kod: "701-01-01", label: "Material — product A", annual: 11_500_000, shape: "summer_dip" },
  { kod: "701-01-02", label: "Material — product B", annual: 8_700_000, shape: "summer_dip" },
  { kod: "701-02-01", label: "Direct labour", annual: 4_100_000, shape: "flat" },
  { kod: "701-03-01", label: "Subcontracting", annual: 2_300_000, shape: "year_end_spike" },
  { kod: "701-04-01", label: "Manufacturing overhead", annual: 1_800_000, shape: "flat" },
  // OpEx — Sales/marketing (711-XX)
  { kod: "711-01-01", label: "Sales salaries", annual: 1_800_000, shape: "flat" },
  { kod: "711-02-01", label: "Marketing campaigns", annual: 950_000, shape: "year_end_spike" },
  { kod: "711-03-01", label: "Distribution costs", annual: 720_000, shape: "summer_dip" },
  // OpEx — Admin (721-XX)
  { kod: "721-01-01", label: "Admin salaries", annual: 2_400_000, shape: "flat" },
  { kod: "721-02-01", label: "Office rent", annual: 480_000, shape: "flat" },
  { kod: "721-02-02", label: "Utilities", annual: 360_000, shape: "flat" },
  { kod: "721-02-15", label: "IT subscriptions", annual: 240_000, shape: "flat" },
  { kod: "721-02-16", label: "Professional services", annual: 180_000, shape: "flat" },
  { kod: "721-02-07", label: "Travel", annual: 140_000, shape: "year_end_spike" },
  { kod: "721-02-09", label: "Training", annual: 95_000, shape: "flat" },
  { kod: "721-02-10", label: "Insurance", annual: 220_000, shape: "flat" },
  { kod: "721-03-01", label: "Bank fees", annual: 60_000, shape: "flat" },
  { kod: "721-09-99", label: "Other admin expenses", annual: 145_000, shape: "flat" },
  // D&A (731-XX)
  { kod: "731-01-01", label: "Equipment depreciation", annual: 1_200_000, shape: "flat" },
  { kod: "731-01-03", label: "Building depreciation", annual: 480_000, shape: "flat" },
  // Finance costs (741-XX)
  { kod: "741-01-01", label: "Interest on loans", annual: 540_000, shape: "flat" },
  // Tax (771-XX)
  { kod: "771-01-01", label: "Corporate income tax", annual: 1_200_000, shape: "year_end_spike" },
];

// Monthly distribution factors per shape (sum to 1.0 across 12 months)
const SHAPE_FACTORS: Record<NonNullable<DemoRow["shape"]>, number[]> = {
  flat: Array(12).fill(1 / 12),
  summer_dip: [0.10, 0.09, 0.10, 0.09, 0.08, 0.05, 0.04, 0.05, 0.09, 0.10, 0.11, 0.10],
  year_end_spike: [0.05, 0.05, 0.06, 0.06, 0.07, 0.07, 0.07, 0.08, 0.09, 0.11, 0.13, 0.16],
};

function buildXlsxRows(): unknown[][] {
  const headerRow = ["KOD", "Ad", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const rows: unknown[][] = [headerRow];
  for (const row of DEMO_ROWS) {
    const factors = SHAPE_FACTORS[row.shape ?? "flat"];
    const monthly = factors.map((f) => Math.round(row.annual * f));
    rows.push([row.kod, row.label, ...monthly]);
  }
  return rows;
}

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Org "${ORG_SLUG}" not found — seed-azmade-holding first`);

  // Idempotency: skip if DEMO-CO already exists
  const existing = await prisma.company.findFirst({
    where: { organizationId: org.id, code: COMPANY_CODE },
  });
  let companyId: string;
  if (existing) {
    console.log(`[seed-demo-co] DEMO-CO already exists (id=${existing.id}); skipping company create`);
    companyId = existing.id;
  } else {
    const created = await prisma.company.create({
      data: {
        organizationId: org.id,
        code: COMPANY_CODE,
        name: "Demo Co (scratch sandbox)",
        nameEn: "Demo Co (scratch sandbox)",
        level: 2,
        role: "operational",
        industry: "industrial",
        country: "AZ",
        baseCurrencyCode: "AZN",
        parentCompanyId: null,
        sortOrder: 99,
      },
    });
    console.log(`[seed-demo-co] Created DEMO-CO (id=${created.id})`);
    companyId = created.id;
  }

  // Generate xlsx file
  const downloadsDir = path.join(os.homedir(), "Downloads");
  const xlsxPath = path.join(downloadsDir, "DEMO-CO.xlsx");

  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(buildXlsxRows());
  XLSX.utils.book_append_sheet(wb, sheet, "P&L");
  XLSX.writeFile(wb, xlsxPath);
  console.log(`[seed-demo-co] Wrote ${xlsxPath} (${DEMO_ROWS.length} rows + header)`);

  console.log(JSON.stringify({
    status: existing ? "noop_company_exists_xlsx_regenerated" : "created",
    companyId,
    xlsxPath,
    rowCount: DEMO_ROWS.length,
  }, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    return prisma.$disconnect().then(() => process.exit(1));
  });
