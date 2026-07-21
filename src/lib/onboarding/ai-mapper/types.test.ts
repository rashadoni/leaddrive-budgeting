import { describe, expect, it } from "vitest"
import { isIsoCurrencyCode, isMapperColumnRole } from "./types"

describe("isMapperColumnRole", () => {
  it.each([
    "code",
    "label",
    "entity",
    "currency",
    "exchangeRate",
    "skip",
    "amount:Jan2026",
    "sourceAmount:Jan2026",
  ])("accepts supported mapper role %s", (role) => {
    expect(isMapperColumnRole(role)).toBe(true)
  })

  it.each(["", "amount:", "sourceAmount:", "fxRate", "system:admin", null, 1])(
    "rejects unsupported mapper role %s",
    (role) => {
      expect(isMapperColumnRole(role)).toBe(false)
    },
  )
})

describe("isIsoCurrencyCode", () => {
  it.each(["AZN", "usd", " EUR "])("accepts ISO-shaped code %s", (code) => {
    expect(isIsoCurrencyCode(code)).toBe(true)
  })

  it.each([undefined, null, 1, "", "US", "USDT", "U$D"])(
    "rejects invalid currency metadata %s",
    (code) => {
      expect(isIsoCurrencyCode(code)).toBe(false)
    },
  )
})
