#!/usr/bin/env node
/**
 * 2026-05-27 — Phase 8 F1 catalog audit.
 *
 * AZSEKER holding spans 3 industries: food_processing, agro_crops,
 * services. The seeded catalog ships 17 industry packs (hospitality,
 * pharma, real_estate, construction, etc.) plus cross-sector — 110
 * active IndicatorDefinitions in total. Of those, only ~33 are wired
 * to AZSEKER companies via CompanyIndicator. The remaining ~77 clutter
 * the matrix API responses, Indicator Health gaps table, and the
 * Backlog page with indicators that will never have data for this
 * holding.
 *
 * Strategy: deactivate (isActive=false) every IndicatorDefinition whose
 * `industries[]` array has NO intersection with the org's active set.
 * Cross-sector indicators (industries=[]) stay active — they apply to
 * any holding by definition. Reversible: re-running the script with a
 * widened active-industries set re-activates the relevant entries.
 *
 *   node scripts/audit-indicator-catalog.mjs --dry-run   # report only
 *   node scripts/audit-indicator-catalog.mjs --apply     # commit
 *
 * Safe to re-run: idempotent. Re-enabling an industry just means the
 * next run will set isActive=true on the matching catalog entries.
 */
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

dotenvConfig({ path: path.resolve(process.cwd(), ".env"), override: true });
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local"), override: true });

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;

  console.log(
    `→ Catalog audit (${dryRun ? "DRY RUN" : "APPLY"})\n`,
  );

  // Determine active industries from real company.industry values.
  const companies = await prisma.company.findMany({
    where: { isActive: true, industry: { not: null } },
    select: { code: true, industry: true },
  });
  const activeIndustries = new Set(
    companies
      .map((c) => c.industry)
      .filter((i) => i !== null && i !== ""),
  );
  console.log(`Active industries (${activeIndustries.size}):`);
  for (const ind of [...activeIndustries].sort()) {
    const cos = companies.filter((c) => c.industry === ind).map((c) => c.code);
    console.log(`  ${ind}  ←  ${cos.join(", ")}`);
  }
  console.log();

  // Load all currently-active IndicatorDefinitions
  const defs = await prisma.indicatorDefinition.findMany({
    where: { isActive: true },
    select: { id: true, code: true, category: true, industries: true },
  });
  console.log(`Catalog: ${defs.length} active definitions\n`);

  const toDeactivate = [];
  const keep = [];
  for (const def of defs) {
    if (def.industries.length === 0) {
      // Cross-sector — always keep
      keep.push({ code: def.code, reason: "cross-sector" });
      continue;
    }
    const intersect = def.industries.filter((i) => activeIndustries.has(i));
    if (intersect.length > 0) {
      keep.push({
        code: def.code,
        reason: `industries [${intersect.join(", ")}] active`,
      });
    } else {
      toDeactivate.push({
        id: def.id,
        code: def.code,
        category: def.category,
        industries: def.industries,
      });
    }
  }

  console.log(
    `Decision:\n  KEEP: ${keep.length} (cross-sector + AZSEKER-relevant)\n  DEACTIVATE: ${toDeactivate.length} (no industry overlap with active set)\n`,
  );

  // Group toDeactivate by category for the report
  const byCategory = new Map();
  for (const d of toDeactivate) {
    if (!byCategory.has(d.category)) byCategory.set(d.category, []);
    byCategory.get(d.category).push(d);
  }
  console.log(`Breakdown of catalog entries to deactivate:`);
  for (const [cat, entries] of [...byCategory.entries()].sort()) {
    console.log(`\n  [${cat}] ${entries.length} entries:`);
    for (const e of entries.slice(0, 5)) {
      console.log(`    ${e.code}  industries=[${e.industries.join(", ")}]`);
    }
    if (entries.length > 5) console.log(`    … +${entries.length - 5} more`);
  }
  console.log();

  if (dryRun) {
    console.log("→ Dry run — no changes written. Re-run with --apply to commit.\n");
    process.exit(0);
  }

  // Apply
  const ids = toDeactivate.map((d) => d.id);
  const result = await prisma.indicatorDefinition.updateMany({
    where: { id: { in: ids } },
    data: { isActive: false },
  });
  console.log(`✓ Deactivated ${result.count} catalog entries.`);
  console.log(
    `  Remaining active: ${defs.length - result.count} (was ${defs.length}).\n`,
  );
}

main()
  .catch((err) => {
    console.error("✗", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
