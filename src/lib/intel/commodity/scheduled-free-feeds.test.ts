import { describe, expect, it } from "vitest"
import {
  EIA_ENERGY_SOURCE,
  getScheduledFreeFeedAdapters,
  GOOGLE_TRENDS_AZ_SOURCE,
  USDA_NASS_SOURCE,
} from "./index"

describe("scheduled free-feed adapter policy", () => {
  it("treats missing optional free keys as skipped configuration", () => {
    const result = getScheduledFreeFeedAdapters({
      apiKeys: { eia: null, usda: null, gtrends: null },
    })
    const sources = result.adapters.map((adapter) => adapter.source)

    expect(sources).not.toContain(EIA_ENERGY_SOURCE)
    expect(sources).not.toContain(USDA_NASS_SOURCE)
    expect(sources).not.toContain(GOOGLE_TRENDS_AZ_SOURCE)
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { source: EIA_ENERGY_SOURCE, reason: "api_key_missing" },
        { source: USDA_NASS_SOURCE, reason: "api_key_missing" },
        {
          source: GOOGLE_TRENDS_AZ_SOURCE,
          reason: "paid_source_disabled",
        },
      ]),
    )
  })

  it("includes configured EIA and USDA but never the paid Trends proxy", () => {
    const result = getScheduledFreeFeedAdapters({
      apiKeys: {
        eia: "eia-key",
        usda: "usda-key",
        gtrends: "paid-proxy-key",
      },
    })
    const sources = result.adapters.map((adapter) => adapter.source)

    expect(sources).toContain(EIA_ENERGY_SOURCE)
    expect(sources).toContain(USDA_NASS_SOURCE)
    expect(sources).not.toContain(GOOGLE_TRENDS_AZ_SOURCE)
    expect(result.skipped).toContainEqual({
      source: GOOGLE_TRENDS_AZ_SOURCE,
      reason: "paid_source_disabled",
    })
    expect(result.skipped).not.toContainEqual({
      source: EIA_ENERGY_SOURCE,
      reason: "api_key_missing",
    })
  })
})
