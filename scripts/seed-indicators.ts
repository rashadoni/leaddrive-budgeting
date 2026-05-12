/**
 * Phase 7.C — Seed the global catalog of IndicatorDefinition rows.
 *
 * Catalog itself lives in `src/lib/risk/indicator-seeds.ts` (pure module,
 * no DB). This script imports the arrays and writes them to Postgres.
 * Both the seed runner and `indicator-thresholds.test.ts` pull from the
 * same source — fixes the dual-of-truth drift surfaced in 2026-04-25
 * architect round-1 review (HOSP_SOURCE_HHI / HOSP_FX_EXPOSURE).
 *
 * Seeds are global (organizationId = null) so every tenant sees the same
 * baseline library. Orgs override by inserting their own row with the
 * same `code` — resolvers prefer org-scoped definitions over globals.
 *
 * Run:
 *   npx tsx scripts/seed-indicators.ts
 *
 * Idempotent: re-running updates existing global rows in place. Postgres
 * treats NULL as distinct in the (organizationId, code) unique index, so
 * we implement idempotency with findFirst + update/create instead of
 * upsert.
 */

import { PrismaClient, Prisma } from "@prisma/client"
import { normalizeIndustryCode } from "@/lib/onboarding/coa-templates"
import {
  validateThresholds,
  type Thresholds,
  type Direction,
} from "@/lib/risk/formula-engine"
import { validateRequiredInputs, validateRollupSeed } from "@/lib/risk/recompute"
import {
  type IndicatorSeed,
  hospitalityIndicators,
  agroIndicators,
  crossSectorIndicators,
  industrialIndicators,
  servicesIndicators,
  pharmaIndicators,
  realEstateIndicators,
  entertainmentIndicators,
  educationIndicators,
  poultryIndicators,
  foodProcessingIndicators,
  beverageIndicators,
  retailIndicators,
  logisticsIndicators,
  constructionIndicators,
  ALL_INDICATOR_SEEDS,
  RETIRED_CODES,
} from "@/lib/risk/indicator-seeds"

const prisma = new PrismaClient()

// Canonical industry codes must match Industry.code exactly — otherwise
// the Company.industry FK lookup fails silently. Apply the same
// normalization that companies-import uses, so the seed source of truth
// and user-entered Excel input converge on the same Industry.code.
function canonicalizeIndustries(industries: string[]): string[] {
  return industries.map(normalizeIndustryCode)
}

/**
 * Validate every indicator's thresholds at seed-time. Catches the
 * EDU_STUDENT_TEACHER_RATIO class of bug (band amber not containing green,
 * inverted directional thresholds, etc.) BEFORE the seed lands in DB and
 * silently produces `unknown` cells in the matrix. See
 * `src/lib/risk/formula-engine.ts::validateThresholds`.
 */
function validateAllSeedThresholds(seeds: readonly IndicatorSeed[]): void {
  const failures: Array<{ code: string; reason: string }> = []
  for (const s of seeds) {
    const result = validateThresholds(
      s.thresholds as Thresholds,
      s.direction as Direction,
    )
    if (!result.ok) {
      failures.push({ code: s.code, reason: result.reason })
    }
  }
  if (failures.length > 0) {
    const lines = failures.map((f) => `  ✗ ${f.code}: ${f.reason}`).join("\n")
    throw new Error(
      `Threshold validation failed for ${failures.length} indicator(s):\n${lines}\n\n` +
        `Fix the seed before re-running. See src/lib/risk/formula-engine.ts::validateThresholds for the rules.`,
    )
  }
}

/**
 * Sub-41 architect Round-1 closure — strict seed-time validation of
 * `requiredInputs` strings (esp. fact:/rollup: phase-3 namespaces).
 * Resolver is intentionally lenient at runtime so a stray bad entry on
 * one indicator doesn't abort an entire tenant's recompute; the strict
 * check lives one layer up — at seed-author time — where a typo SHOULD
 * halt the import. See `validateRequiredInputs` jsdoc in recompute.ts.
 */
function validateAllSeedRequiredInputs(seeds: readonly IndicatorSeed[]): void {
  const failures: Array<{ code: string; reason: string }> = []
  for (const s of seeds) {
    const result = validateRequiredInputs(s.requiredInputs ?? [])
    if (!result.ok) {
      failures.push({ code: s.code, reason: result.reason })
    }
  }
  if (failures.length > 0) {
    const lines = failures.map((f) => `  ✗ ${f.code}: ${f.reason}`).join("\n")
    throw new Error(
      `requiredInputs validation failed for ${failures.length} indicator(s):\n${lines}\n\n` +
        `Fix the seed before re-running. See src/lib/risk/recompute.ts::validateRequiredInputs for the format.`,
    )
  }
}

/**
 * Sub-44 cont'd architect 💡 closure — seed-author-time strict gate that
 * rejects rollup-bearing seeds with non-empty industries. Pairs with the
 * runtime defensive filter at `recompute-trigger.ts:194` (belt-and-braces).
 *
 * Without this, a future seed like:
 *   { code: 'IND_HOSPITALITY_HOLDING_REVENUE', industries: ['hospitality'],
 *     requiredInputs: ['rollup:IND_REVENUE_TOTAL'], ... }
 * would silently fire on EVERY parent co (industrial, agro, all sectors),
 * not just hospitality parents — because parent-co recompute targets
 * bypass `matchCompaniesToIndicators` industry-filter.
 */
function validateAllSeedRollupShape(seeds: readonly IndicatorSeed[]): void {
  const failures: Array<{ code: string; reason: string }> = []
  for (const s of seeds) {
    const result = validateRollupSeed({
      code: s.code,
      industries: s.industries,
      requiredInputs: s.requiredInputs,
    })
    if (!result.ok) {
      failures.push({ code: s.code, reason: result.reason })
    }
  }
  if (failures.length > 0) {
    const lines = failures.map((f) => `  ✗ ${f.code}: ${f.reason}`).join("\n")
    throw new Error(
      `Rollup-seed validation failed for ${failures.length} indicator(s):\n${lines}\n\n` +
        `Fix the seed before re-running. See src/lib/risk/recompute.ts::validateRollupSeed for the rationale.`,
    )
  }
}

/**
 * Purge IndicatorValue rows whose (company.industry, indicator.industries)
 * relationship no longer matches after a seed run. Necessary because
 * narrowing an indicator's `industries` list (e.g. removing `"services"`
 * from `IND_*`) leaves orphan IV rows alive in the matrix — seed would
 * otherwise be a non-converging operation.
 *
 * Deletion rule: an IV row is orphan iff the indicator is active AND
 * (indicator.industries non-empty) AND (company.industry NOT IN
 * indicator.industries). Sector-agnostic indicators (`industries = []`)
 * never orphan. Inactive indicators handled by `cleanupRetiredCodes`.
 */
async function cleanupOrphanIndicatorValues(): Promise<number> {
  const activeIndicators = await prisma.indicatorDefinition.findMany({
    where: { isActive: true },
    select: { id: true, industries: true },
  })
  const validPairs = new Set<string>()
  const sectorAgnostic = new Set<string>()
  for (const ind of activeIndicators) {
    if (ind.industries.length === 0) {
      sectorAgnostic.add(ind.id)
    } else {
      for (const industry of ind.industries) {
        validPairs.add(`${ind.id}::${industry}`)
      }
    }
  }
  const ivRows = await prisma.indicatorValue.findMany({
    select: {
      id: true,
      indicatorId: true,
      company: { select: { industry: true } },
    },
  })
  const orphanIds: string[] = []
  for (const iv of ivRows) {
    if (sectorAgnostic.has(iv.indicatorId)) continue
    const industry = iv.company.industry
    if (!industry) continue
    if (!validPairs.has(`${iv.indicatorId}::${industry}`)) {
      orphanIds.push(iv.id)
    }
  }
  if (orphanIds.length === 0) return 0
  const result = await prisma.indicatorValue.deleteMany({
    where: { id: { in: orphanIds } },
  })
  return result.count
}

async function cleanupRetiredCodes(): Promise<number> {
  let deactivated = 0
  for (const code of RETIRED_CODES) {
    const retired = await prisma.indicatorDefinition.findFirst({
      where: { organizationId: null, code },
      select: { id: true, isActive: true },
    })
    if (!retired) continue
    const delIv = await prisma.indicatorValue.deleteMany({
      where: { indicatorId: retired.id },
    })
    if (retired.isActive) {
      await prisma.indicatorDefinition.update({
        where: { id: retired.id },
        data: { isActive: false },
      })
      deactivated += 1
    }
    console.log(
      `  ! ${code.padEnd(24)} retired (IV rows purged: ${delIv.count}${retired.isActive ? ", deactivated" : ""})`,
    )
  }
  return deactivated
}

async function upsertGlobal(seed: IndicatorSeed) {
  // organizationId is NULL for global seeds; Postgres treats NULL as
  // distinct in unique indexes, so prisma.upsert on the compound unique
  // doesn't work with a null component. Fall back to findFirst + update/create.
  const existing = await prisma.indicatorDefinition.findFirst({
    where: { organizationId: null, code: seed.code },
    select: { id: true },
  })

  const data = {
    organizationId: null,
    code: seed.code,
    nameEn: seed.nameEn,
    nameAz: seed.nameAz ?? null,
    nameRu: seed.nameRu ?? null,
    category: seed.category,
    industries: canonicalizeIndustries(seed.industries),
    unit: seed.unit,
    direction: seed.direction,
    formula: seed.formula,
    sparklineFormula: seed.sparklineFormula ?? null,
    thresholds: seed.thresholds as unknown as Prisma.InputJsonValue,
    hintTemplateEn: seed.hintTemplateEn ?? null,
    hintTemplateAz: seed.hintTemplateAz ?? null,
    hintTemplateRu: seed.hintTemplateRu ?? null,
    requiredInputs: seed.requiredInputs,
    isActive: true,
    sortOrder: seed.sortOrder,
    // Phase 7.H F4.v2.1 — fall back to Prisma default (`computed`) when
    // a seed omits the field. ESG seeds set `modeled_generic`/`macro`;
    // every financial / operational seed keeps the default.
    defaultValueSource: seed.defaultValueSource ?? "computed",
  }

  if (existing) {
    await prisma.indicatorDefinition.update({ where: { id: existing.id }, data })
    return "updated" as const
  }
  await prisma.indicatorDefinition.create({ data })
  return "created" as const
}

async function main() {
  // Deactivate + purge retired codes FIRST so stale definitions don't
  // keep producing cells in the matrix while the new codes roll in.
  const deactivated = await cleanupRetiredCodes()

  // Validate thresholds BEFORE any DB write. If any indicator has
  // misshapen thresholds (band amber not containing green, inverted
  // higher_better, etc.), throw — fail fast, don't half-seed.
  validateAllSeedThresholds(ALL_INDICATOR_SEEDS)
  console.log(
    `  ✓ All ${ALL_INDICATOR_SEEDS.length} indicators passed threshold validation`,
  )

  // Sub-41 — strict seed-time validation of `requiredInputs` strings
  // (especially fact:/rollup: phase-3 namespaces). Catches typos like
  // `fact:IND_X@` (empty period) or `rollup:` (empty code) before they
  // become silent NaN at runtime.
  validateAllSeedRequiredInputs(ALL_INDICATOR_SEEDS)
  console.log(
    `  ✓ All ${ALL_INDICATOR_SEEDS.length} indicators passed requiredInputs validation`,
  )

  // Sub-44 cont'd architect 💡 — reject rollup-bearing seeds with
  // non-empty industries (would silently fire on all parent-cos because
  // parent-co recompute targets bypass the industry-match filter).
  validateAllSeedRollupShape(ALL_INDICATOR_SEEDS)
  console.log(
    `  ✓ All ${ALL_INDICATOR_SEEDS.length} indicators passed rollup-shape validation (sector-agnostic gate)`,
  )

  let created = 0
  let updated = 0

  for (const seed of ALL_INDICATOR_SEEDS) {
    const result = await upsertGlobal(seed)
    if (result === "created") created++
    else updated++
    console.log(
      `  ${result === "created" ? "+" : "~"} ${seed.code.padEnd(24)} ${seed.nameEn}`,
    )
  }
  if (deactivated > 0) {
    console.log(`  (retired ${deactivated} code(s) in this run)`)
  }

  // Purge IV rows that no longer belong under the current
  // (indicator.industries, company.industry) alignment.
  const orphansPurged = await cleanupOrphanIndicatorValues()
  if (orphansPurged > 0) {
    console.log(
      `  (purged ${orphansPurged} orphan IndicatorValue row(s) — industry narrowing)`,
    )
  }

  console.log("")
  console.log(
    `Seeded ${ALL_INDICATOR_SEEDS.length} indicators (${created} created, ${updated} updated).`,
  )
  console.log(`  Hospitality:      ${hospitalityIndicators.length}`)
  console.log(`  Agro:             ${agroIndicators.length}`)
  console.log(`  Industrial:       ${industrialIndicators.length}`)
  console.log(`  Services:         ${servicesIndicators.length}`)
  console.log(`  Pharma:           ${pharmaIndicators.length}`)
  console.log(`  Real Estate:      ${realEstateIndicators.length}`)
  console.log(`  Entertainment:    ${entertainmentIndicators.length}`)
  console.log(`  Education:        ${educationIndicators.length}`)
  console.log(`  Poultry:          ${poultryIndicators.length}`)
  console.log(`  Food Processing:  ${foodProcessingIndicators.length}`)
  console.log(`  Beverage:         ${beverageIndicators.length}`)
  console.log(`  Retail:           ${retailIndicators.length}`)
  console.log(`  Logistics:        ${logisticsIndicators.length}`)
  console.log(`  Construction:     ${constructionIndicators.length}`)
  console.log(`  Cross-sector:     ${crossSectorIndicators.length}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
