/**
 * Repairing a JSON reply the model ran out of tokens mid-way through.
 *
 * The shape under test is the real one: Import Doctor's six-field explanation
 * truncated by a 900-token cap, which on production produced
 * "Unterminated string in JSON at position 1920" and left the operator with a
 * blocked import and no explanation.
 */
import { describe, it, expect } from "vitest"
import { repairTruncatedJson } from "./json-repair"

describe("repairTruncatedJson", () => {
  it("leaves valid JSON exactly as it found it", () => {
    const ok = '{"title":"A","whatToCheck":["x","y"],"needsReimport":false}'
    expect(repairTruncatedJson(ok)).toEqual({ text: ok, repaired: false })
  })

  it("closes a reply cut off mid-sentence — the production failure", () => {
    const cut = '{"title":"Blok","plainExplanation":"tam","whyBlocked":"Bu idxal blok'
    const r = repairTruncatedJson(cut)
    expect(r.repaired).toBe(true)
    const parsed = JSON.parse(r.text)
    // The fields that ARRIVED survive intact — that is the whole point.
    expect(parsed.title).toBe("Blok")
    expect(parsed.plainExplanation).toBe("tam")
    expect(parsed.whyBlocked).toBe("Bu idxal blok")
  })

  it("closes a truncated ARRAY and its object", () => {
    const cut = '{"title":"A","whatToCheck":["birinci","ikinc'
    const parsed = JSON.parse(repairTruncatedJson(cut).text)
    expect(parsed.whatToCheck).toEqual(["birinci", "ikinc"])
  })

  it("drops a trailing comma", () => {
    const parsed = JSON.parse(repairTruncatedJson('{"a":1,"b":2,').text)
    expect(parsed).toEqual({ a: 1, b: 2 })
  })

  it("drops a key that never received its value", () => {
    const parsed = JSON.parse(repairTruncatedJson('{"a":1,"b":').text)
    expect(parsed).toEqual({ a: 1 })
  })

  it("drops a bare trailing key", () => {
    const parsed = JSON.parse(repairTruncatedJson('{"a":1,"safeNextStep"').text)
    expect(parsed).toEqual({ a: 1 })
  })

  it("does not let a trailing backslash escape the quote it adds", () => {
    // `"abc\` — appending a quote would produce `"abc\"`, still unterminated.
    const parsed = JSON.parse(repairTruncatedJson('{"a":"abc\\').text)
    expect(parsed.a).toBe("abc")
  })

  it("keeps a quote that is escaped INSIDE the string", () => {
    const parsed = JSON.parse(repairTruncatedJson('{"a":"say \\"hi').text)
    expect(parsed.a).toBe('say "hi')
  })

  it("closes nested structures in the right order", () => {
    const parsed = JSON.parse(
      repairTruncatedJson('{"o":{"list":[1,2,{"deep":"tex').text,
    )
    expect(parsed.o.list[2].deep).toBe("tex")
  })

  it("reports NO repair when the text cannot be salvaged", () => {
    // Not JSON at all — must hand the original back so the caller's own error
    // names what it actually tried to parse, rather than a mangled variant.
    const junk = "the model apologised instead of answering"
    expect(repairTruncatedJson(junk)).toEqual({ text: junk, repaired: false })
  })

  it("handles empty input without throwing", () => {
    expect(repairTruncatedJson("   ")).toEqual({ text: "", repaired: false })
  })
})
