import { describe, it, expect } from "vitest"
import { localizeFactCheckFlag } from "./localize-fact-check"

// Plain mock translator: echoes the key + appended params so we can assert the
// helper picks the right message key and forwards interpolation values.
// (next-intl itself is globally mocked in the test setup, so we don't call the
// real translator here — the message text + interpolation is verified against
// the real locale files in the i18n integrity checks.)
function mockT(key: string, values?: Record<string, string | number>): string {
  const parts = values
    ? Object.entries(values).map(([k, v]) => `${k}=${v}`)
    : []
  return parts.length ? `${key} ${parts.join(" ")}` : key
}

describe("localizeFactCheckFlag", () => {
  it("falls back to the English reason/suggestion when no code", () => {
    expect(
      localizeFactCheckFlag({ reason: "EN reason", suggestion: "EN suggestion" }, mockT),
    ).toEqual({ reason: "EN reason", suggestion: "EN suggestion" })
  })

  it("maps numberAbsent → the absent-number keys + forwards {number}", () => {
    const out = localizeFactCheckFlag(
      { code: "numberAbsent", params: { number: "139" }, reason: "x", suggestion: "y" },
      mockT,
    )
    expect(out.reason).toBe("varianceExplainer.factCheck.reason.numberAbsent number=139")
    expect(out.suggestion).toBe("varianceExplainer.factCheck.suggestion.numberAbsent number=139")
  })

  it("maps numberUnmatched → the unmatched-number keys", () => {
    const out = localizeFactCheckFlag(
      { code: "numberUnmatched", params: { number: "11" }, reason: "x", suggestion: "y" },
      mockT,
    )
    expect(out.reason).toBe("varianceExplainer.factCheck.reason.numberUnmatched number=11")
  })

  it("maps futureYear → the future-year keys + forwards {year, period}", () => {
    const out = localizeFactCheckFlag(
      { code: "futureYear", params: { year: 2027, period: "2026" }, reason: "x", suggestion: "y" },
      mockT,
    )
    expect(out.reason).toBe(
      "varianceExplainer.factCheck.reason.futureYear year=2027 period=2026",
    )
  })
})
