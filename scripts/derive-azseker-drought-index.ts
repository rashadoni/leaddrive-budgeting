/**
 * Phase 7.M Tier 4 (2026-05-19) — derive drought_index for AZSEKER-EDEN.
 *
 * Bridges weather-openmeteo (rainfall_mm_90d + temp_avg_c_30d per region)
 * → single area-weighted drought_index ∈ [0, 100] per company-year, stored
 * in operational_facts so `AGRO_DROUGHT_RISK` formula can read it.
 *
 * Computation per region:
 *   rainfall_score = 1 - clamp(rainfall_mm / NORMAL_90D_MM, 0, 1)
 *     0 = plenty rain (>=200mm), 1 = no rain
 *   temp_score = clamp((temp - COMFORT_C) / (HOT_C - COMFORT_C), 0, 1)
 *     0 = cool/optimal, 1 = very hot
 *   region_drought = 0.6 * rainfall_score + 0.4 * temp_score
 *
 * Then area-weighted average across all EDEN farming regions (uses
 * land registry hectares from Company.settings.landParcels).
 *
 * Final drought_index = round(region_drought × 100) ∈ [0, 100]
 *   < 30 = green (low drought stress)
 *   30..60 = amber
 *   > 60 = red
 *
 * Usage:
 *   npx tsx scripts/derive-azseker-drought-index.ts             # apply
 *   npx tsx scripts/derive-azseker-drought-index.ts --dry-run   # preview
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")
const ORG_SLUG = "azmade"
const TARGET_COMPANY = "AZSEKER-EDEN"
const TARGET_YEAR = 2026

// Calibration constants — AZ summer reference values.
const NORMAL_90D_MM = 200 // ≥200mm in 90d = plenty
const COMFORT_C = 18 // <18°C avg = cool (no temp stress)
const HOT_C = 32 // >32°C avg = severe heat stress
const RAINFALL_WEIGHT = 0.6
const TEMP_WEIGHT = 0.4

interface LandParcel {
  region: string | null
  /** District/city name — used as region fallback when `region` is null. */
  lessor?: string | null
  hectares: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Map region label from land registry → weather adapter region code.
 *  Includes suffix variants for EDEN's cost-centre-based naming (e.g.
 *  "Beyləqan -E" / "Beyləqan -Q" / "Beyləqan -E (2)" all map to BEYLAQAN;
 *  "Dastan Agro" is an operational sub-unit in the Beyləqan area). */
const REGION_TO_WEATHER_CODE: Record<string, string> = {
  Yevlax: "YEVLAX",
  Ağcabədi: "AGJABEDI",
  Beyləqan: "BEYLAQAN",
  "Beyləqan -E": "BEYLAQAN",
  "Beyləqan -Q": "BEYLAQAN",
  "Beyləqan -E (2)": "BEYLAQAN",
  "Dastan Agro": "BEYLAQAN", // operational sub-unit; Beyləqan area
  Şəmkir: "SHAMKIR",
  Füzuli: "FUZULI",
  İmişli: "IMISHLI",
  Salyan: "SALYAN",
  Sabirabad: "SABIRABAD",
  Tərtər: "BEYLAQAN", // closest weather station
}

async function main(): Promise<number> {
  console.log(
    `\n=== Derive drought_index for ${TARGET_COMPANY}${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`,
  )
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true },
  })
  if (!org) {
    console.error(`✗ Org slug=${ORG_SLUG} not found`)
    return 1
  }

  const company = await prisma.company.findFirst({
    where: { organizationId: org.id, code: TARGET_COMPANY },
    select: { id: true, settings: true },
  })
  if (!company) {
    console.error(`✗ Company ${TARGET_COMPANY} not found`)
    return 1
  }

  const settings = (company.settings ?? {}) as Record<string, unknown>
  const parcels = Array.isArray(settings.landParcels)
    ? (settings.landParcels as LandParcel[])
    : []
  if (parcels.length === 0) {
    console.error(
      `✗ No landParcels in ${TARGET_COMPANY} settings. Run scripts/apply-azseker-land.ts first.`,
    )
    return 1
  }

  // Aggregate hectares per region.
  // `region` is the canonical field; `lessor` is used as fallback because
  // the AzerSheker land import populates lessor with the district name
  // (e.g. "Ağcabədi", "Beyləqan") but leaves `region` null.
  const hectaresByRegion = new Map<string, number>()
  for (const p of parcels) {
    const regionKey = p.region ?? p.lessor ?? null
    if (!regionKey) continue
    hectaresByRegion.set(
      regionKey,
      (hectaresByRegion.get(regionKey) ?? 0) + (p.hectares ?? 0),
    )
  }
  console.log(`Land registry regions for ${TARGET_COMPANY}:`)
  for (const [region, ha] of hectaresByRegion.entries()) {
    console.log(`  ${region.padEnd(15)} ${ha.toFixed(1)} ha`)
  }

  // Per-region drought computation
  let totalWeightedDrought = 0
  let totalHa = 0
  let regionsWithData = 0
  console.log(`\nPer-region drought scores:`)
  for (const [region, hectares] of hectaresByRegion.entries()) {
    const weatherCode = REGION_TO_WEATHER_CODE[region]
    if (!weatherCode) {
      console.log(`  ⚠ ${region.padEnd(15)} — no weather code mapping`)
      continue
    }
    const [rainfall, temp] = await Promise.all([
      prisma.intelDataPoint.findFirst({
        where: {
          sourceCode: "weather-openmeteo",
          metric: `${weatherCode}_RAINFALL_MM_90D`,
        },
        orderBy: { datetime: "desc" },
        select: { value: true, datetime: true },
      }),
      prisma.intelDataPoint.findFirst({
        where: {
          sourceCode: "weather-openmeteo",
          metric: `${weatherCode}_TEMP_AVG_C_30D`,
        },
        orderBy: { datetime: "desc" },
        select: { value: true, datetime: true },
      }),
    ])
    if (!rainfall || !temp) {
      console.log(`  ⚠ ${region.padEnd(15)} — missing rainfall/temp`)
      continue
    }
    const rainfallScore = 1 - clamp(rainfall.value / NORMAL_90D_MM, 0, 1)
    const tempScore = clamp((temp.value - COMFORT_C) / (HOT_C - COMFORT_C), 0, 1)
    const regionDrought =
      RAINFALL_WEIGHT * rainfallScore + TEMP_WEIGHT * tempScore
    console.log(
      `  ${region.padEnd(15)} rain=${rainfall.value.toFixed(0)}mm temp=${temp.value.toFixed(1)}°C → drought=${(regionDrought * 100).toFixed(1)}/100 (×${hectares.toFixed(0)} ha)`,
    )
    totalWeightedDrought += regionDrought * hectares
    totalHa += hectares
    regionsWithData++
  }

  if (totalHa === 0) {
    console.error(`✗ No regions had weather data; cannot compute`)
    return 1
  }
  const aggregateDrought = (totalWeightedDrought / totalHa) * 100
  const rounded = Math.round(aggregateDrought * 10) / 10
  console.log(`\n── Aggregate drought_index ──`)
  console.log(
    `  ${rounded.toFixed(1)}/100 (area-weighted across ${regionsWithData}/${hectaresByRegion.size} regions, ${totalHa.toFixed(0)} ha)`,
  )
  const verdict =
    rounded < 30 ? "🟢 green (low)" : rounded < 60 ? "🟡 amber" : "🔴 red"
  console.log(`  Verdict: ${verdict}`)

  // Write operational_fact (annual snapshot at Dec-31 + monthly snapshot at month-end)
  const annualDate = new Date(`${TARGET_YEAR}-12-31T00:00:00Z`)
  if (!DRY_RUN) {
    // Delete prior drought_index facts for this company-year
    await prisma.operationalFact.deleteMany({
      where: {
        companyId: company.id,
        metric: "drought_index",
        date: {
          gte: new Date(`${TARGET_YEAR}-01-01T00:00:00Z`),
          lte: new Date(`${TARGET_YEAR}-12-31T23:59:59Z`),
        },
      },
    })
    await prisma.operationalFact.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        metric: "drought_index",
        date: annualDate,
        value: rounded,
        unit: "index_0_100",
        source: "derived-from-weather-openmeteo",
      },
    })
    console.log(`\n✓ Written drought_index=${rounded} fact for ${TARGET_YEAR}`)
  }
  console.log(
    `\n=== ${DRY_RUN ? "DRY-RUN — no changes" : "DONE"} ===\n`,
  )
  return 0
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(2)
  })
