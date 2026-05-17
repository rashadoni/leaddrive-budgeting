#!/usr/bin/env node
/**
 * Phase 7.K Phase 5b end-to-end indicator integration test.
 *
 * For each of the 23 new indicators:
 *   1. Seed a synthetic IntelDataPoint in the test source/metric so the
 *      resolver has something to read.
 *   2. Trigger recompute on the org via raw SQL/Prisma — or read the
 *      latest IntelDataPoint and run the formula in-process.
 *   3. Compare against expected band and print PASS / FAIL per indicator.
 *
 * Run:
 *   DATABASE_URL=... node scripts/test-phase-7k-indicators.cjs
 */
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

/** Synthetic data per source: (sourceCode, metric, value, expectedBand). */
const TESTS = [
  // Hospitality
  {
    code: "HOSP_TOURISM_ARRIVALS_SIGNAL",
    sector: "hospitality",
    sourceCode: "wb-indicators",
    metric: "AZ_TOURISM_ARRIVALS",
    seedValue: 2_500_000,
    expectedStatus: "green",
  },
  // Pharma
  {
    code: "PHARM_FX_USD_PRESSURE",
    sector: "pharma",
    sourceCode: "cbar-official-fx",
    metric: "AZN_USD",
    seedValue: 1.69,
    expectedStatus: "green",
  },
  // Real estate
  {
    code: "RE_HOUSING_CPI_PRESSURE",
    sector: "real_estate",
    sourceCode: "az-stat-cpi",
    metric: "AZ_CPI_HOUSING",
    seedValue: 108,
    expectedStatus: "green",
  },
  // Industrial — 2
  {
    code: "IND_COPPER_PRICE_SIGNAL",
    sector: "industrial",
    sourceCode: "yahoo-metals",
    metric: "COPPER_USD_TONNE",
    seedValue: 8500,
    expectedStatus: "green",
  },
  {
    code: "IND_NATGAS_PRICE_SIGNAL",
    sector: "industrial",
    sourceCode: "eia-energy",
    metric: "NATGAS_USD_MMBTU",
    seedValue: 3.5,
    expectedStatus: "green",
  },
  // Construction — 2
  {
    code: "CONSTR_STEEL_PRICE_SIGNAL",
    sector: "construction",
    sourceCode: "yahoo-metals",
    metric: "STEEL_USD_TONNE",
    seedValue: 650,
    expectedStatus: "green",
  },
  {
    code: "CONSTR_LUMBER_PRICE_SIGNAL",
    sector: "construction",
    sourceCode: "yahoo-metals",
    metric: "LUMBER_USD_MBF",
    seedValue: 380,
    expectedStatus: "green",
  },
  // Logistics — 3
  {
    code: "LOG_DIESEL_PRICE_SIGNAL",
    sector: "logistics",
    sourceCode: "yahoo-fuel-bdi",
    metric: "DIESEL_USD_LITRE",
    seedValue: 0.65,
    expectedStatus: "green",
  },
  {
    code: "LOG_BDI_FREIGHT_SIGNAL",
    sector: "logistics",
    sourceCode: "yahoo-fuel-bdi",
    metric: "BALTIC_DRY_INDEX",
    seedValue: 1800,
    expectedStatus: "green",
  },
  {
    code: "LOG_BRENT_OIL_SIGNAL",
    sector: "logistics",
    sourceCode: "eia-energy",
    metric: "BRENT_USD_BBL",
    seedValue: 75,
    expectedStatus: "green",
  },
  // Poultry — 3
  {
    code: "POULT_BROILER_PRICE_SIGNAL",
    sector: "poultry",
    sourceCode: "usda-nass",
    metric: "BROILER_PRICE_USD_LB",
    seedValue: 1.3,
    expectedStatus: "green",
  },
  {
    code: "POULT_FEED_CORN_PRESSURE",
    sector: "poultry",
    sourceCode: "yahoo-grains",
    metric: "CORN_USD_TONNE",
    seedValue: 180,
    expectedStatus: "green",
  },
  {
    code: "POULT_EGG_PRICE_SIGNAL",
    sector: "poultry",
    sourceCode: "usda-nass",
    metric: "EGG_PRICE_USD_DOZ",
    seedValue: 2.4,
    expectedStatus: "green",
  },
  // Food processing — 3 (FP_GRAIN_COST_PRESSURE_BLEND tested as composite below)
  {
    code: "FP_FAO_FOOD_INDEX_SIGNAL",
    sector: "food_processing",
    sourceCode: "fao-food-prices",
    metric: "FAO_FFPI_NOMINAL",
    seedValue: 110,
    expectedStatus: "green",
  },
  {
    code: "FP_WHEAT_PRICE_SIGNAL",
    sector: "food_processing",
    sourceCode: "yahoo-grains",
    metric: "WHEAT_USD_TONNE",
    seedValue: 220,
    expectedStatus: "green",
  },
  {
    code: "FP_GRAIN_COST_PRESSURE_BLEND",
    sector: "food_processing",
    sourceCode: "yahoo-grains",
    metric: "WHEAT_USD_TONNE", // wheat partial; corn pre-seeded above
    seedValue: 220,
    expectedStatus: "green",
    composite: true,
  },
  // Beverage
  {
    code: "BEV_FAO_SUGAR_INDEX_SIGNAL",
    sector: "beverage",
    sourceCode: "fao-food-prices",
    metric: "FAO_SUGAR_INDEX",
    seedValue: 100,
    expectedStatus: "green",
  },
  // Retail — 2
  {
    code: "RET_AZ_FOOD_CPI_PRESSURE",
    sector: "retail",
    sourceCode: "az-stat-cpi",
    metric: "AZ_CPI_FOOD",
    seedValue: 102,
    expectedStatus: "green",
  },
  {
    code: "RET_TREND_FOOD_SIGNAL",
    sector: "retail",
    sourceCode: "google-trends-az",
    metric: "AZ_TREND_FOOD_RETAIL",
    seedValue: 110,
    expectedStatus: "green",
  },
  // Education
  {
    code: "EDU_POPULATION_0_14_SIGNAL",
    sector: "education",
    sourceCode: "wb-indicators",
    metric: "AZ_POP_AGE_0_14_PCT",
    seedValue: 24.5,
    expectedStatus: "green",
  },
  // Entertainment
  {
    code: "ENT_TRAVEL_DEMAND_SIGNAL",
    sector: "entertainment",
    sourceCode: "google-trends-az",
    metric: "AZ_TREND_TRAVEL",
    seedValue: 105,
    expectedStatus: "green",
  },
  // Services
  {
    code: "SERV_AZ_TRADE_BALANCE_SIGNAL",
    sector: "services",
    sourceCode: "un-comtrade-az",
    metric: "AZ_TRADE_BALANCE_USD",
    seedValue: 15_000_000_000,
    expectedStatus: "green",
  },
  // Agro
  {
    code: "AGRO_SALYAN_RAINFALL_14D_FCST",
    sector: "agro_crops",
    sourceCode: "openmeteo-forecast",
    metric: "SALYAN_RAINFALL_MM_14D_FCST",
    seedValue: 45,
    expectedStatus: "green",
  },
]

async function main() {
  const org = await prisma.organization.findFirst({
    select: { id: true, name: true },
  })
  if (!org) throw new Error("No org found in DB")
  console.log(`Using org: ${org.name} (${org.id})\n`)

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // 1. Pre-seed corn for the composite blend (FP_GRAIN_COST_PRESSURE_BLEND).
  await prisma.intelDataPoint.upsert({
    where: {
      organizationId_sourceCode_metric_datetime: {
        organizationId: org.id,
        sourceCode: "yahoo-grains",
        metric: "CORN_USD_TONNE",
        datetime: today,
      },
    },
    update: { value: 180, unit: "USD/tonne", raw: { test: true } },
    create: {
      organizationId: org.id,
      sourceCode: "yahoo-grains",
      metric: "CORN_USD_TONNE",
      datetime: today,
      value: 180,
      unit: "USD/tonne",
      raw: { test: true },
    },
  })

  // 2. Per-indicator: seed metric → check via DB query.
  let pass = 0
  let fail = 0
  console.log(
    "─".repeat(110),
  )
  console.log(
    `${pad("#", 3)}${pad("INDICATOR", 32)}${pad("SECTOR", 17)}${pad("SOURCE", 22)}${pad("METRIC", 28)}${pad("VAL", 8)}STATUS`,
  )
  console.log("─".repeat(110))
  for (let i = 0; i < TESTS.length; i++) {
    const t = TESTS[i]
    // Upsert seed point
    await prisma.intelDataPoint.upsert({
      where: {
        organizationId_sourceCode_metric_datetime: {
          organizationId: org.id,
          sourceCode: t.sourceCode,
          metric: t.metric,
          datetime: today,
        },
      },
      update: { value: t.seedValue, unit: "test", raw: { test: true } },
      create: {
        organizationId: org.id,
        sourceCode: t.sourceCode,
        metric: t.metric,
        datetime: today,
        value: t.seedValue,
        unit: "test",
        raw: { test: true },
      },
    })

    // Read latest IntelDataPoint back, run formula by hand. We don't need
    // the full recompute pipeline — we're testing the data path.
    const def = await prisma.indicatorDefinition.findFirst({
      where: {
        code: t.code,
        OR: [{ organizationId: org.id }, { organizationId: null }],
      },
      select: { formula: true, thresholds: true, requiredInputs: true },
    })
    if (!def) {
      console.log(`${pad(String(i + 1), 3)}${pad(t.code, 32)}NO DEFINITION IN DB`)
      fail++
      continue
    }

    // Resolve every commodityPrice:* in requiredInputs to the latest
    // IntelDataPoint value for that alias. Mirror what resolver does.
    const ctx = {}
    for (const input of def.requiredInputs) {
      if (input.startsWith("commodityPrice:")) {
        const varName = input.slice("commodityPrice:".length)
        // For test we hardcode alias mapping (mirrors recompute.ts table)
        const aliasMap = {
          az_tourism_arrivals_latest: ["wb-indicators", "AZ_TOURISM_ARRIVALS"],
          azn_usd_latest: ["cbar-official-fx", "AZN_USD"],
          az_cpi_housing_latest: ["az-stat-cpi", "AZ_CPI_HOUSING"],
          az_cpi_food_latest: ["az-stat-cpi", "AZ_CPI_FOOD"],
          copper_price_latest: ["yahoo-metals", "COPPER_USD_TONNE"],
          natgas_price_latest: ["eia-energy", "NATGAS_USD_MMBTU"],
          steel_price_latest: ["yahoo-metals", "STEEL_USD_TONNE"],
          lumber_price_latest: ["yahoo-metals", "LUMBER_USD_MBF"],
          diesel_price_latest: ["yahoo-fuel-bdi", "DIESEL_USD_LITRE"],
          baltic_dry_latest: ["yahoo-fuel-bdi", "BALTIC_DRY_INDEX"],
          brent_price_latest: ["eia-energy", "BRENT_USD_BBL"],
          broiler_price_latest: ["usda-nass", "BROILER_PRICE_USD_LB"],
          corn_price_latest: ["yahoo-grains", "CORN_USD_TONNE"],
          wheat_price_latest: ["yahoo-grains", "WHEAT_USD_TONNE"],
          egg_price_latest: ["usda-nass", "EGG_PRICE_USD_DOZ"],
          fao_ffpi_latest: ["fao-food-prices", "FAO_FFPI_NOMINAL"],
          fao_sugar_latest: ["fao-food-prices", "FAO_SUGAR_INDEX"],
          az_trend_food_latest: ["google-trends-az", "AZ_TREND_FOOD_RETAIL"],
          az_pop_age_0_14_latest: ["wb-indicators", "AZ_POP_AGE_0_14_PCT"],
          az_trend_travel_latest: ["google-trends-az", "AZ_TREND_TRAVEL"],
          az_trade_balance_latest: ["un-comtrade-az", "AZ_TRADE_BALANCE_USD"],
        }
        const m = aliasMap[varName]
        if (!m) {
          console.log(`unwired alias: ${varName}`)
          continue
        }
        const dp = await prisma.intelDataPoint.findFirst({
          where: {
            organizationId: org.id,
            sourceCode: m[0],
            metric: m[1],
          },
          orderBy: { datetime: "desc" },
        })
        ctx[varName] = dp ? Number(dp.value) : null
      }
      if (input.startsWith("weather:salyan:rainfall_forecast_14d")) {
        // Map to the IntelDataPoint we seeded for SALYAN_RAINFALL_MM_14D_FCST
        const dp = await prisma.intelDataPoint.findFirst({
          where: {
            organizationId: org.id,
            sourceCode: "openmeteo-forecast",
            metric: "SALYAN_RAINFALL_MM_14D_FCST",
          },
          orderBy: { datetime: "desc" },
        })
        ctx.salyan_rainfall_forecast_14d = dp ? Number(dp.value) : null
      }
    }

    // Evaluate formula (only handles + / - / * / / / parens / numbers — safe eval).
    const expr = String(def.formula)
    let value
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(...Object.keys(ctx), `return (${expr});`)
      value = fn(...Object.values(ctx))
    } catch (e) {
      value = NaN
    }

    // Classify against thresholds.
    const status = classify(value, def.thresholds)
    const ok = status === t.expectedStatus
    const tag = ok ? "✓ PASS" : `✗ FAIL (got ${status})`
    if (ok) pass++
    else fail++
    console.log(
      `${pad(String(i + 1), 3)}${pad(t.code, 32)}${pad(t.sector, 17)}${pad(t.sourceCode, 22)}${pad(t.metric, 28)}${pad(String(t.seedValue).slice(0, 7), 8)}${pad(status, 8)}${tag}`,
    )
  }
  console.log("─".repeat(110))
  console.log(`\nResult: ${pass}/${TESTS.length} indicators PASSED (${fail} failed)`)

  // Clean up test rows so we don't pollute prod data.
  await prisma.intelDataPoint.deleteMany({
    where: { organizationId: org.id, raw: { path: ["test"], equals: true } },
  })
  console.log(`Cleaned up test IntelDataPoint rows.`)

  process.exit(fail > 0 ? 1 : 0)
}

function classify(value, thresholds) {
  if (!Number.isFinite(value)) return "unknown"
  for (const band of ["green", "amber", "red"]) {
    const b = thresholds[band]
    if (!b) continue
    if (b.op === ">=" && value >= b.value) return band
    if (b.op === ">" && value > b.value) return band
    if (b.op === "<=" && value <= b.value) return band
    if (b.op === "<" && value < b.value) return band
  }
  return "unknown"
}

function pad(s, n) {
  s = String(s ?? "")
  return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(2)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
