/**
 * Phase 7.G Turn LXXXXV (Phase 7.E #1 D.5b) — commodity adapter factory.
 *
 * Returns the canonical 3-source array (TCMB FX + WorldBank CPI + RSS).
 * Tests can construct a custom array directly (skip factory).
 */

import { createWorldBankCPIAdapter } from "./worldbank-cpi"
import { createOpenMeteoWeatherAdapter } from "./weather-openmeteo"
import { createSugarYahooAdapter } from "./sugar-yahoo"
import { createCBARForwardAdapter } from "./cbar-fx-forward"
// Phase 7.K — Phase 1: official replacements for the 3 broken adapters
// (tcmb-fx-rates / commodities-rss-brent / worldbank-sugar).
import { createCBARFXAdapter } from "./cbar-fx"
import { createEIAEnergyAdapter } from "./eia-energy"
import { createFAOFoodPricesAdapter } from "./fao-food-prices"
// Phase 7.K — Phase 2: cross-sector data feeds covering ≥5 sectors each.
import { createYahooGrainsAdapter } from "./yahoo-grains"
import { createYahooMetalsAdapter } from "./yahoo-metals"
import { createOpenMeteoForecastAdapter } from "./openmeteo-forecast"
import { createAzStatCpiAdapter } from "./az-stat-cpi"
import type { CommodityAdapter, CommodityAdapterOptions } from "./types"

/** Extended adapter options. Phase 7.K Phase 5a wires per-org API keys
 *  through this bag so each org's scheduler instantiates adapters with
 *  its own credentials (EIA / Google Trends / future paid sources). */
export interface ExtendedAdapterOptions extends CommodityAdapterOptions {
  /** Per-org API keys keyed by source name. Loaded from
   *  `Organization.settings.apiKeys` by the scheduler factory. */
  apiKeys?: Partial<Record<"eia" | "gtrends", string | null>>
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
    // Phase 7.I — sector-aware feeds for AzerSheker pilot.
    createOpenMeteoWeatherAdapter(opts),
    createSugarYahooAdapter(opts),
    // Phase 7.J — IRP-derived AZN forward curve for hedge sizing.
    createCBARForwardAdapter(opts),
  ]
}

// Phase 7.K Phase 1 — broken adapters dropped from the factory but
// kept exported for now (tests still reference them; remove in v1.1
// once the dashboard auto-prunes).
export { createTCMBAdapter, TCMB_FX_SOURCE } from "./tcmb-fx"
export { createWorldBankCPIAdapter, WB_CPI_SOURCE } from "./worldbank-cpi"
export { createCommoditiesRSSAdapter, COMMODITIES_RSS_SOURCE } from "./commodities-rss"
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
  AZ_CPI_CATEGORY_MAP,
  parseAzCpiCsv,
  azCpiRowsToDataPoints,
} from "./az-stat-cpi"
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
  createCBARForwardAdapter,
  buildForwardCurve,
} from "./cbar-fx-forward"
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
