/**
 * Tests for the WB Indicators adapter (tourism + education).
 */
import { describe, it, expect, vi } from "vitest"
import {
  wbIndicatorResponseToDataPoint,
  createWbIndicatorsAdapter,
  WB_INDICATORS_SOURCE,
  WB_INDICATORS,
} from "./wb-indicators"

const TOURISM_INDICATOR = WB_INDICATORS.find((i) => i.metric === "AZ_TOURISM_ARRIVALS")!

describe("wbIndicatorResponseToDataPoint", () => {
  it("picks most-recent non-null year", () => {
    const response = [
      { meta: "..." },
      [
        { date: "2024", value: null },
        { date: "2023", value: 2_300_000 },
        { date: "2022", value: 1_900_000 },
      ],
    ]
    const point = wbIndicatorResponseToDataPoint(response, TOURISM_INDICATOR)
    expect(point).toBeTruthy()
    expect(point!.value).toBe(2_300_000)
    expect(point!.datetime.toISOString().slice(0, 7)).toBe("2023-01")
    expect(point!.metric).toBe("AZ_TOURISM_ARRIVALS")
  })

  it("returns null when all values are null", () => {
    const response = [
      {},
      [
        { date: "2024", value: null },
        { date: "2023", value: null },
      ],
    ]
    expect(wbIndicatorResponseToDataPoint(response, TOURISM_INDICATOR)).toBeNull()
  })

  it("returns null on malformed payload", () => {
    expect(wbIndicatorResponseToDataPoint([], TOURISM_INDICATOR)).toBeNull()
    expect(wbIndicatorResponseToDataPoint({}, TOURISM_INDICATOR)).toBeNull()
  })
})

describe("createWbIndicatorsAdapter", () => {
  it("returns adapter with correct contract", () => {
    const adapter = createWbIndicatorsAdapter()
    expect(adapter.source).toBe(WB_INDICATORS_SOURCE)
    expect(adapter.label).toContain("World Bank")
  })

  it("fetches all 6 indicators", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {},
            [{ date: "2024", value: 1000 }, { date: "2023", value: 950 }],
          ]),
          { status: 200 },
        ),
    )
    const adapter = createWbIndicatorsAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(WB_INDICATORS.length)
    for (const p of result.dataPoints) expect(p.value).toBe(1000)
  })

  it("isolates per-indicator HTTP errors", async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call++
      if (call === 1) return new Response("err", { status: 500 })
      return new Response(
        JSON.stringify([{}, [{ date: "2024", value: 100 }]]),
        { status: 200 },
      )
    })
    const adapter = createWbIndicatorsAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.dataPoints.length).toBe(WB_INDICATORS.length - 1)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain("HTTP 500")
  })

  it("includes AZ country code in URL", async () => {
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify([{}, [{ date: "2024", value: 100 }]]),
          { status: 200 },
        ),
    )
    const adapter = createWbIndicatorsAdapter({ fetchImpl: fetchImpl as never })
    await adapter.fetch()
    const url = fetchImpl.mock.calls[0]?.[0] ?? ""
    expect(url).toContain("/country/AZ/indicator/")
  })
})
