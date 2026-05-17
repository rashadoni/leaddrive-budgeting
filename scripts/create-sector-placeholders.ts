/**
 * Phase 7.K Step 4 — create one macro-only placeholder company per
 * unconnected sector so the 16 Phase 7.K macro indicators can
 * propagate into IndicatorValue rows. Each placeholder:
 *   - has `industry` set so industry-match recompute fires
 *   - has `role: 'admin'` so it's hidden from operational HeatMap
 *     filters (filterOperationalCompanies)
 *   - has empty settings + no budget data — pure macro fan-out
 *   - has description tagging it as a placeholder for future real
 *     onboarding
 *
 * NOT a violation of the "no synthetic business data" rule: these
 * carry no budget lines, no actuals, no operational facts. They exist
 * only as a sector-tag substrate for industry-scoped macro indicators
 * (e.g. PHARM_FX_USD_PRESSURE reads AZN/USD = 1.70 once and renders
 * it for every pharma-tagged co — the placeholder is the receiver,
 * not the source).
 *
 * Replace with real ops-co via /budgeting/onboarding when actual
 * sector entity is onboarded.
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const SECTORS = [
  { code: "DEMO-HOSP", name: "Hospitality (macro placeholder)", industry: "hospitality" },
  { code: "DEMO-PHARM", name: "Pharma (macro placeholder)", industry: "pharma" },
  { code: "DEMO-RETAIL", name: "Retail (macro placeholder)", industry: "retail" },
  { code: "DEMO-CONSTR", name: "Construction (macro placeholder)", industry: "construction" },
  { code: "DEMO-LOG", name: "Logistics (macro placeholder)", industry: "logistics" },
  { code: "DEMO-POULT", name: "Poultry (macro placeholder)", industry: "poultry" },
  { code: "DEMO-BEV", name: "Beverage (macro placeholder)", industry: "beverage" },
  { code: "DEMO-RE", name: "Real Estate (macro placeholder)", industry: "real_estate" },
  { code: "DEMO-EDU", name: "Education (macro placeholder)", industry: "education" },
  { code: "DEMO-ENT", name: "Entertainment (macro placeholder)", industry: "entertainment" },
]

const PLACEHOLDER_NOTE =
  "Macro-only placeholder created by scripts/create-sector-placeholders.ts. " +
  "Carries no financial data. Activates sector-scoped Phase 7.K macro indicators " +
  "(PHARM_FX_USD_PRESSURE, HOSP_TOURISM_ARRIVALS_SIGNAL, etc.) until a real " +
  "operational company is onboarded via /budgeting/onboarding."

async function main() {
  const org = await prisma.organization.findFirst({
    select: { id: true, name: true },
  })
  if (!org) throw new Error("No organization")
  console.log(`Org: ${org.name} (${org.id})\n`)

  // Find FO Holding's level-1 parent or null — we attach placeholders
  // at level=2 with no parent (top-level for macro). They live alongside
  // existing AZMADE/AZSEKER/ATL sub-groups.
  for (const sector of SECTORS) {
    const existing = await prisma.company.findFirst({
      where: { organizationId: org.id, code: sector.code },
      select: { id: true, code: true },
    })
    if (existing) {
      console.log(`  exists: ${sector.code} (${existing.id}) — skip`)
      continue
    }
    const co = await prisma.company.create({
      data: {
        organizationId: org.id,
        code: sector.code,
        name: sector.name,
        level: 2,
        industry: sector.industry,
        role: "admin", // hidden from operational filter
        settings: {
          isMacroPlaceholder: true,
          placeholderNote: PLACEHOLDER_NOTE,
        } as never,
      },
      select: { id: true, code: true, industry: true, role: true },
    })
    console.log(
      `  CREATED ${co.code.padEnd(15)} industry=${co.industry?.padEnd(15)} role=${co.role}`,
    )
  }

  console.log("\nDone. Next: run recompute to populate IndicatorValue rows.")
}

main()
  .catch((e) => {
    console.error("Script error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
