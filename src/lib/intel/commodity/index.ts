/**
 * Phase 7.G Turn LXXXXV (Phase 7.E #1 D.5b) — commodity adapter factory.
 *
 * Returns the canonical 3-source array (TCMB FX + WorldBank CPI + RSS).
 * Tests can construct a custom array directly (skip factory).
 */

import { createTCMBAdapter } from "./tcmb-fx"
import { createWorldBankCPIAdapter } from "./worldbank-cpi"
import { createCommoditiesRSSAdapter } from "./commodities-rss"
import type { CommodityAdapter, CommodityAdapterOptions } from "./types"

export function getCommodityAdapters(opts: CommodityAdapterOptions = {}): CommodityAdapter[] {
  return [
    createTCMBAdapter(opts),
    createWorldBankCPIAdapter(opts),
    createCommoditiesRSSAdapter(opts),
  ]
}

export { createTCMBAdapter, TCMB_FX_SOURCE } from "./tcmb-fx"
export { createWorldBankCPIAdapter, WB_CPI_SOURCE } from "./worldbank-cpi"
export { createCommoditiesRSSAdapter, COMMODITIES_RSS_SOURCE } from "./commodities-rss"
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
