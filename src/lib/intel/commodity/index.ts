/**
 * Phase 7.G Turn LXXXXV (Phase 7.E #1 D.5b) — commodity adapter factory.
 *
 * Returns the canonical 3-source array (TCMB FX + WorldBank CPI + RSS).
 * Tests can construct a custom array directly (skip factory).
 */

import { createTCMBAdapter } from "./tcmb-fx"
import { createWorldBankCPIAdapter } from "./worldbank-cpi"
import { createCommoditiesRSSAdapter } from "./commodities-rss"
import { createOpenMeteoWeatherAdapter } from "./weather-openmeteo"
import { createSugarYahooAdapter } from "./sugar-yahoo"
import { createCBARForwardAdapter } from "./cbar-fx-forward"
import type { CommodityAdapter, CommodityAdapterOptions } from "./types"

export function getCommodityAdapters(opts: CommodityAdapterOptions = {}): CommodityAdapter[] {
  return [
    createTCMBAdapter(opts),
    createWorldBankCPIAdapter(opts),
    createCommoditiesRSSAdapter(opts),
    // Phase 7.I — sector-aware feeds for AzerSheker pilot.
    createOpenMeteoWeatherAdapter(opts),
    createSugarYahooAdapter(opts),
    // Phase 7.J — IRP-derived AZN forward curve for hedge sizing.
    createCBARForwardAdapter(opts),
  ]
}

export { createTCMBAdapter, TCMB_FX_SOURCE } from "./tcmb-fx"
export { createWorldBankCPIAdapter, WB_CPI_SOURCE } from "./worldbank-cpi"
export { createCommoditiesRSSAdapter, COMMODITIES_RSS_SOURCE } from "./commodities-rss"
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
