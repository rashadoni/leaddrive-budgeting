/**
 * Tests for the CBAR Official FX adapter.
 *
 * Covers:
 *  - XML parser handles real-format snippet
 *  - Quote-pair filtering (skips currencies not in CBAR_QUOTE_PAIRS)
 *  - Idempotency: UTC midnight anchor on datetime
 *  - Adapter contract (source / fetch / errors on bad HTTP)
 */
import { describe, it, expect, vi } from "vitest"
import {
  parseCbarXml,
  cbarRatesToDataPoints,
  createCBARFXAdapter,
  CBAR_FX_SOURCE,
} from "./cbar-fx"

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ValCurs Date="17.05.2026" Name="Official exchange rates">
  <ValType Type="Xarici valyutalar">
    <Valute Code="USD"><Nominal>1</Nominal><Name>1 ABS dollari</Name><Value>1.7000</Value></Valute>
    <Valute Code="EUR"><Nominal>1</Nominal><Name>1 Avro</Name><Value>1.8543</Value></Valute>
    <Valute Code="RUB"><Nominal>100</Nominal><Name>100 Rusiya rublu</Name><Value>1.8920</Value></Valute>
    <Valute Code="TRY"><Nominal>1</Nominal><Name>1 Turkiye lirasi</Name><Value>0.0512</Value></Valute>
    <Valute Code="GBP"><Nominal>1</Nominal><Name>1 Britaniya funt sterlinqi</Name><Value>2.1456</Value></Valute>
    <Valute Code="CNY"><Nominal>1</Nominal><Name>1 Cin yuani</Name><Value>0.2358</Value></Valute>
    <Valute Code="XAU"><Nominal>1</Nominal><Name>Qizil</Name><Value>3500.0000</Value></Valute>
  </ValType>
</ValCurs>`

describe("parseCbarXml", () => {
  it("extracts every <Valute Code><Value> pair", () => {
    const rates = parseCbarXml(SAMPLE_XML)
    expect(rates.USD).toBe(1.7)
    expect(rates.EUR).toBe(1.8543)
    expect(rates.RUB).toBe(1.892)
    expect(rates.TRY).toBe(0.0512)
    expect(rates.GBP).toBe(2.1456)
    expect(rates.CNY).toBe(0.2358)
    expect(rates.XAU).toBe(3500)
  })

  it("returns empty object for malformed XML", () => {
    expect(parseCbarXml("<html>not xml</html>")).toEqual({})
    expect(parseCbarXml("")).toEqual({})
  })
})

describe("cbarRatesToDataPoints", () => {
  it("filters to CBAR_QUOTE_PAIRS only (drops XAU etc.)", () => {
    const points = cbarRatesToDataPoints(
      { USD: 1.7, EUR: 1.85, XAU: 3500, RUB: 1.89, ABC: 999 },
      new Date("2026-05-17T15:00:00Z"),
    )
    const metrics = points.map((p) => p.metric).sort()
    expect(metrics).toContain("AZN_USD")
    expect(metrics).toContain("AZN_EUR")
    expect(metrics).toContain("AZN_RUB")
    expect(metrics).not.toContain("AZN_XAU")
    expect(metrics).not.toContain("AZN_ABC")
  })

  it("anchors datetime to UTC midnight of the given day", () => {
    const points = cbarRatesToDataPoints(
      { USD: 1.7 },
      new Date("2026-05-17T15:30:45Z"),
    )
    expect(points[0].datetime.toISOString()).toBe("2026-05-17T00:00:00.000Z")
  })

  it("attaches sourceCode + unit", () => {
    const points = cbarRatesToDataPoints({ USD: 1.7 }, new Date("2026-05-17"))
    expect(points[0].sourceCode).toBe(CBAR_FX_SOURCE)
    expect(points[0].unit).toBe("AZN/USD")
  })
})

describe("createCBARFXAdapter", () => {
  it("returns adapter with correct contract", () => {
    const adapter = createCBARFXAdapter()
    expect(adapter.source).toBe(CBAR_FX_SOURCE)
    expect(adapter.label).toContain("CBAR")
    expect(typeof adapter.fetch).toBe("function")
  })

  it("fetches + parses successful response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(SAMPLE_XML, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
    )
    const adapter = createCBARFXAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch(new Date("2026-05-17"))
    expect(result.fetched).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.dataPoints.length).toBe(6) // USD/EUR/RUB/TRY/GBP/CNY
  })

  it("returns errors=[HTTP …] on 4xx without throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }))
    const adapter = createCBARFXAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch(new Date("2026-05-17"))
    expect(result.fetched).toBe(true)
    expect(result.dataPoints).toEqual([])
    expect(result.errors[0]).toContain("HTTP 404")
  })

  it("returns fetched=false + errors=[fetch failed: …] on network throw", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    })
    const adapter = createCBARFXAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(false)
    expect(result.errors[0]).toContain("ECONNREFUSED")
  })

  it("emits date-formatted URL DD.MM.YYYY", async () => {
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(SAMPLE_XML, { status: 200 }),
    )
    const adapter = createCBARFXAdapter({ fetchImpl: fetchImpl as never })
    await adapter.fetch(new Date("2026-01-05T10:00:00Z"))
    const calledUrl = fetchImpl.mock.calls[0]?.[0] ?? ""
    expect(calledUrl).toContain("/05.01.2026.xml")
  })
})
