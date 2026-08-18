/**
 * 2026-08-18 — an AI outage must not be reported as a bad file.
 *
 * Production ran out of Anthropic credit. Every upload came back
 * "file type unknown — manual review required", and the owner spent the
 * morning looking for a defect in a spreadsheet that was perfectly fine: the
 * workbook had opened, the sheets had been read, and only the model call had
 * failed. The screen named the wrong culprit, and the server logged nothing at
 * all, so the diagnosis had to be made by probing the provider by hand.
 *
 * These pin the classification the import screen now branches on. They are
 * about WHICH CAUSE IS NAMED, not about wording.
 */
import { describe, expect, it } from "vitest"
import { classifyAiError } from "./ai-error"

describe("AI outage is told apart from a data problem", () => {
  it("recognises the exhausted-credit message production actually returned", () => {
    // Verbatim from api.anthropic.com on 2026-08-18, via the production host.
    const raw =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":' +
      '"Your credit balance is too low to access the Anthropic API. Please go ' +
      'to Plans & Billing to upgrade or purchase credits."}}'
    expect(classifyAiError(raw)).toBe("ai_credits")
  })

  it("recognises the shapes the import classifier wraps its errors in", () => {
    // The orchestrator prefixes the provider message before classifying, so
    // the patterns must survive that wrapping.
    expect(classifyAiError("Classification failed: credit balance is too low")).toBe("ai_credits")
    expect(classifyAiError("classify failed — 429 rate_limit_error")).toBe("ai_rate_limit")
  })

  it("does NOT call an ordinary failure a billing problem", () => {
    // The banner claims the file is fine and tells the reader to top up. Saying
    // that when the cause is something else sends them to the wrong place.
    expect(classifyAiError("socket hang up")).toBe("ai_unavailable")
    expect(classifyAiError("workbook has no sheets")).toBe("ai_unavailable")
  })

  it("never lets the provider's raw billing text become the classification", () => {
    // The code is what reaches the browser; the raw string stays server-side.
    const code = classifyAiError("Your credit balance is too low")
    expect(code).toBe("ai_credits")
    expect(code).not.toMatch(/balance|billing|credit /i)
  })
})
