/**
 * Phase 7.G Turn LXXXXV (Phase 7.E #1 D.5b) — commodity adapter factory.
 *
 * Returns the canonical 3-source array (TCMB FX + WorldBank CPI + RSS).
 * Tests can construct a custom array directly (skip factory).
 */

import { createWorldBankCPIAdapter } from "./worldbank-cpi"
import { createOpenMeteoWeatherAdapter } from "./weather-openmeteo"
import { createSugarYahooAdapter } from "./sugar-yahoo"
// Phase 7.K — Phase 1: official replacements for the 3 broken adapters
// (tcmb-fx-rates / commodities-rss-brent / worldbank-sugar).
import { createCBARFXAdapter } from "./cbar-fx"
import { createEIAEnergyAdapter, EIA_ENERGY_SOURCE } from "./eia-energy"
import { createFAOFoodPricesAdapter } from "./fao-food-prices"
// Phase 7.K — Phase 2: cross-sector data feeds covering ≥5 sectors each.
import { createYahooGrainsAdapter } from "./yahoo-grains"
import { createYahooMetalsAdapter } from "./yahoo-metals"
import { createOpenMeteoForecastAdapter } from "./openmeteo-forecast"
import { createAzStatCpiAdapter } from "./az-stat-cpi"
// Phase 7.K — Phase 3: sector-specific feeds (poultry / logistics / services / hospitality+edu / retail).
import { createUSDANassAdapter, USDA_NASS_SOURCE } from "./usda-nass"
import { createYahooFuelBdiAdapter } from "./yahoo-fuel-bdi"
import { createUnComtradeAzAdapter } from "./un-comtrade-az"
import { createWbIndicatorsAdapter } from "./wb-indicators"
import {
  createGoogleTrendsAzAdapter,
  GOOGLE_TRENDS_AZ_SOURCE,
} from "./google-trends-az"
import type { CommodityAdapter, CommodityAdapterOptions } from "./types"

/** Extended adapter options. Phase 7.K Phase 5a wires per-org API keys
 *  through this bag so each org's scheduler instantiates adapters with
 *  its own credentials (EIA / Google Trends / future paid sources). */
export interface ExtendedAdapterOptions extends CommodityAdapterOptions {
  /** Per-org API keys keyed by source name. Loaded from
   *  `Organization.settings.apiKeys` by the scheduler factory.
   *  - `eia`: EIA Energy v2 free key
   *  - `usda`: USDA NASS Quick Stats free key
   *  - `gtrends`: SerpAPI / ScrapingDog proxy key (paid bridge for
   *    Google Trends; null disables the adapter gracefully)
   */
  apiKeys?: Partial<Record<"eia" | "usda" | "gtrends", string | null>>
}

export interface ScheduledFeedSkip {
  source: string
  reason: "api_key_missing" | "paid_source_disabled"
}

export interface ScheduledFreeFeedAdapterSet {
  adapters: CommodityAdapter[]
  skipped: ScheduledFeedSkip[]
}

/**
 * Adapter set for the unattended production scheduler.
 *
 * Unlike the broad manual factory below, this contract is intentionally
 * spend-safe: Google Trends' paid proxy is never present, and key-gated free
 * sources are omitted (and reported as skipped) when the organization has not
 * configured the corresponding credential. A missing optional key is a
 * configuration state, not a failed scheduler run.
 */
export function getScheduledFreeFeedAdapters(
  opts: ExtendedAdapterOptions = {},
): ScheduledFreeFeedAdapterSet {
  const adapters: CommodityAdapter[] = [
    createCBARFXAdapter(opts),
    createWorldBankCPIAdapter(opts),
    createFAOFoodPricesAdapter(opts),
    createYahooGrainsAdapter(opts),
    createYahooMetalsAdapter(opts),
    createOpenMeteoForecastAdapter(opts),
    createAzStatCpiAdapter(opts),
    createYahooFuelBdiAdapter(opts),
    createUnComtradeAzAdapter(opts),
    createWbIndicatorsAdapter(opts),
    createOpenMeteoWeatherAdapter(opts),
    createSugarYahooAdapter(opts),
  ]
  const skipped: ScheduledFeedSkip[] = [
    { source: GOOGLE_TRENDS_AZ_SOURCE, reason: "paid_source_disabled" },
  ]

  const eiaKey = opts.apiKeys?.eia?.trim()
  if (eiaKey) {
    adapters.push(createEIAEnergyAdapter({ ...opts, apiKey: eiaKey }))
  } else {
    skipped.push({ source: EIA_ENERGY_SOURCE, reason: "api_key_missing" })
  }

  const usdaKey = opts.apiKeys?.usda?.trim()
  if (usdaKey) {
    adapters.push(createUSDANassAdapter({ ...opts, apiKey: usdaKey }))
  } else {
    skipped.push({ source: USDA_NASS_SOURCE, reason: "api_key_missing" })
  }

  return { adapters, skipped }
}

export function getCommodityAdapters(
  opts: ExtendedAdapterOptions = {},
): CommodityAdapter[] {
  return [
    // Phase 7.K Phase 1 — Daily / monthly authoritative public feeds.
    createCBARFXAdapter(opts),
    createWorldBankCPIAdapter(opts),
    createFAOFoodPricesAdapter(opts),
    createEIAEnergyAdapter({ ...opts, apiKey: opts.apiKeys?.eia ?? null }),
    // Phase 7.K Phase 2 — Cross-sector grains / metals / weather / CPI.
    createYahooGrainsAdapter(opts),
    createYahooMetalsAdapter(opts),
    createOpenMeteoForecastAdapter(opts),
    createAzStatCpiAdapter(opts),
    // Phase 7.K Phase 3 — Sector-specific feeds.
    createUSDANassAdapter({ ...opts, apiKey: opts.apiKeys?.usda ?? null }),
    createYahooFuelBdiAdapter(opts),
    createUnComtradeAzAdapter(opts),
    createWbIndicatorsAdapter(opts),
    createGoogleTrendsAzAdapter({ ...opts, apiKey: opts.apiKeys?.gtrends ?? null }),
    // Phase 7.I — sector-aware feeds for AzerSheker pilot.
    createOpenMeteoWeatherAdapter(opts),
    createSugarYahooAdapter(opts),
    // Phase 7.J IRP-derived AZN forward curve REMOVED 2026-06-01 — it was a
    // model on hardcoded spot+rates (no real AZN forward market), not real data.
  ]
}

// Phase 7.K Phase 1 — broken adapters dropped from the factory but
// kept exported for now (tests still reference them; remove in v1.1
// once the dashboard auto-prunes).
export { createTCMBAdapter, TCMB_FX_SOURCE } from "./tcmb-fx"
export { createWorldBankCPIAdapter, WB_CPI_SOURCE } from "./worldbank-cpi"
// Phase 7.K Phase 1 replacements:
export { createCBARFXAdapter, CBAR_FX_SOURCE } from "./cbar-fx"
export { createEIAEnergyAdapter, EIA_ENERGY_SOURCE } from "./eia-energy"
export { createFAOFoodPricesAdapter, FAO_FOOD_PRICES_SOURCE } from "./fao-food-prices"
// Phase 7.K Phase 2 cross-sector adapters:
export {
  createYahooGrainsAdapter,
  YAHOO_GRAINS_SOURCE_CODE,
  YAHOO_GRAINS_SYMBOLS,
  yahooGrainsResponseToDataPoints,
} from "./yahoo-grains"
export {
  createYahooMetalsAdapter,
  YAHOO_METALS_SOURCE_CODE,
  YAHOO_METALS_SYMBOLS,
  yahooMetalsResponseToDataPoints,
} from "./yahoo-metals"
export {
  createOpenMeteoForecastAdapter,
  OPENMETEO_FORECAST_SOURCE,
  openMeteoForecastToDataPoints,
} from "./openmeteo-forecast"
export {
  createAzStatCpiAdapter,
  AZ_STAT_CPI_SOURCE,
  parseAzCpiXlsx,
  rowsToYoYDataPoints,
} from "./az-stat-cpi"
// Phase 7.K Phase 3 sector-specific adapters:
export {
  createUSDANassAdapter,
  USDA_NASS_SOURCE,
  USDA_SERIES,
  buildUsdaUrl,
  usdaResponseToDataPoint,
} from "./usda-nass"
export {
  createYahooFuelBdiAdapter,
  YAHOO_FUEL_BDI_SOURCE,
  FUEL_BDI_SYMBOLS,
  fuelBdiResponseToDataPoints,
} from "./yahoo-fuel-bdi"
export {
  createUnComtradeAzAdapter,
  UN_COMTRADE_AZ_SOURCE,
  buildComtradeUrl,
  comtradeResponseToDataPoints,
} from "./un-comtrade-az"
export {
  createWbIndicatorsAdapter,
  WB_INDICATORS_SOURCE,
  WB_INDICATORS,
  wbIndicatorResponseToDataPoint,
} from "./wb-indicators"
export {
  createGoogleTrendsAzAdapter,
  GOOGLE_TRENDS_AZ_SOURCE,
  TRENDS_CATEGORIES,
  buildTrendsUrl,
  trendsResponseToDataPoint,
} from "./google-trends-az"
export {
  createOpenMeteoWeatherAdapter,
  WEATHER_OPENMETEO_SOURCE,
  WEATHER_REGIONS,
  openMeteoResponseToDataPoints,
  type WeatherRegionCode,
} from "./weather-openmeteo"
export {
  createSugarYahooAdapter,
  SUGAR_YAHOO_SOURCE,
  SUGAR_YAHOO_METRIC,
} from "./sugar-yahoo"
export {
  ingestCommodityData,
  clearCommodityMemoryForTests,
  getCommodityMemorySize,
  getInMemoryDataPoints,
  type IngestResult,
  type IngestOptions,
} from "./ingest"
export type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"
