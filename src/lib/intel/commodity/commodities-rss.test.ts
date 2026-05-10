// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import {
  createCommoditiesRSSAdapter,
  extractFirstItemTitle,
  extractPriceFromTitle,
  COMMODITIES_RSS_SOURCE,
} from "./commodities-rss"

const NOW = new Date("2026-05-10T12:00:00.000Z")

describe("extractFirstItemTitle — pure XML helper", () => {
  it("extracts first item title from valid RSS", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Brent Oil — $76.42/bbl</title><link>http://x</link></item>
      <item><title>Gold — $2,300/oz</title></item>
    </channel></rss>`
    expect(extractFirstItemTitle(xml)).toBe("Brent Oil — $76.42/bbl")
  })

  it("decodes CDATA wrappers", () => {
    const xml = `<rss><channel><item><title><![CDATA[Brent — $80]]></title></item></channel></rss>`
    expect(extractFirstItemTitle(xml)).toBe("Brent — $80")
  })

  it("returns null when no item exists", () => {
    expect(extractFirstItemTitle("<rss><channel></channel></rss>")).toBeNull()
    expect(extractFirstItemTitle("not xml")).toBeNull()
    expect(extractFirstItemTitle("")).toBeNull()
  })
})

describe("extractPriceFromTitle — price regex", () => {
  it("extracts $-prefix dollar price", () => {
    expect(extractPriceFromTitle("Brent — $76.42/bbl")).toBe(76.42)
    expect(extractPriceFromTitle("Gold $1,950.50/oz")).toBe(1950.5)
  })

  it("extracts bare number with comma separators (fallback)", () => {
    expect(extractPriceFromTitle("Brent at 76.42 per barrel")).toBe(76.42)
    expect(extractPriceFromTitle("Gold settled at 2,300.50")).toBe(2300.5)
  })

  it("returns null for titles with no number", () => {
    expect(extractPriceFromTitle("Market closed")).toBeNull()
  })

  it("handles whitespace around $", () => {
    expect(extractPriceFromTitle("Brent: $ 80.5 ")).toBe(80.5)
  })
})

describe("createCommoditiesRSSAdapter — fetch loop", () => {
  function makeFeed(title: string): string {
    return `<rss><channel><item><title><![CDATA[${title}]]></title></item></channel></rss>`
  }

  it("fetches each feed + emits one data point per parseable title", async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      const u = String(url)
      const xml = u.includes("brent")
        ? makeFeed("Brent Oil — $76.42/bbl")
        : makeFeed("Gold — $2,300/oz")
      return { ok: true, status: 200, text: async () => xml }
    }) as unknown as typeof fetch
    const adapter = createCommoditiesRSSAdapter({
      fetchImpl,
      feedUrls: {
        BRENT_USD_BBL: "https://test.local/brent",
        GOLD_USD_OZ: "https://test.local/gold",
      },
    })
    const result = await adapter.fetch(NOW)
    expect(result.dataPoints).toHaveLength(2)
    const brent = result.dataPoints.find((p) => p.metric === "BRENT_USD_BBL")
    const gold = result.dataPoints.find((p) => p.metric === "GOLD_USD_OZ")
    expect(brent?.value).toBe(76.42)
    expect(brent?.unit).toBe("USD/bbl")
    expect(gold?.value).toBe(2300)
    expect(gold?.unit).toBe("USD/oz")
    expect(result.source).toBe(COMMODITIES_RSS_SOURCE)
    expect(result.fetched).toBe(true)
  })

  it("anchors datetime to UTC midnight (idempotency)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => makeFeed("Brent — $80"),
    })) as unknown as typeof fetch
    const adapter = createCommoditiesRSSAdapter({
      fetchImpl,
      feedUrls: { BRENT_USD_BBL: "https://test.local/brent" },
    })
    const result = await adapter.fetch(new Date("2026-05-10T23:59:59.999Z"))
    expect(result.dataPoints[0].datetime.toISOString()).toBe("2026-05-10T00:00:00.000Z")
  })

  it("records error when title has no parseable price", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => makeFeed("Market closed today"),
    })) as unknown as typeof fetch
    const adapter = createCommoditiesRSSAdapter({
      fetchImpl,
      feedUrls: { BRENT_USD_BBL: "https://test.local/brent" },
    })
    const result = await adapter.fetch(NOW)
    expect(result.dataPoints).toEqual([])
    expect(result.errors[0]).toContain("no parseable price")
  })

  it("records error on RSS with no <item>", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "<rss><channel></channel></rss>",
    })) as unknown as typeof fetch
    const adapter = createCommoditiesRSSAdapter({
      fetchImpl,
      feedUrls: { BRENT_USD_BBL: "https://test.local/brent" },
    })
    const result = await adapter.fetch(NOW)
    expect(result.dataPoints).toEqual([])
    expect(result.errors[0]).toContain("no <item><title>")
  })

  it("handles HTTP error per feed (loop continues)", async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => {
      n++
      if (n === 1) return { ok: false, status: 404, text: async () => "" }
      return { ok: true, status: 200, text: async () => makeFeed("Gold — $2300") }
    }) as unknown as typeof fetch
    const adapter = createCommoditiesRSSAdapter({
      fetchImpl,
      feedUrls: {
        BRENT_USD_BBL: "https://test.local/brent",
        GOLD_USD_OZ: "https://test.local/gold",
      },
    })
    const result = await adapter.fetch(NOW)
    expect(result.dataPoints).toHaveLength(1)
    expect(result.dataPoints[0].metric).toBe("GOLD_USD_OZ")
    expect(result.errors.some((e) => e.includes("BRENT_USD_BBL") && e.includes("HTTP 404"))).toBe(true)
  })
})
