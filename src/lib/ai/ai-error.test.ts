/**
 * 2026-08-02 — a parse failure of OURS was being reported as the AI being down.
 *
 * Measured on production while the owner was using Import Doctor:
 * `Import Doctor response missing string field: title`, logged server-side and
 * shown in the browser as «Import Doctor işləmədi: ai_unavailable». The model
 * had answered; the fix prompt described three proposal kinds without ever
 * naming a required field, and our validator threw the answer away.
 *
 * Someone reading "ai unavailable" goes to check the API key and the billing
 * page. That is the wrong-advice failure this file now avoids.
 */
import { describe, it, expect } from "vitest"
import { classifyAiError, aiErrorBody } from "./ai-error"

describe("classifyAiError", () => {
  it("separates our own shape failure from the provider being down", () => {
    for (const raw of [
      "Import Doctor response missing string field: title",
      "Import Doctor response must be a JSON object",
      "Import Doctor fix must be an object",
    ]) {
      expect(classifyAiError(raw), raw).toBe("ai_bad_response")
    }
  })

  it("still recognises the provider errors it always did", () => {
    expect(classifyAiError('400 {"message":"Your credit balance is too low"}')).toBe("ai_credits")
    expect(classifyAiError("429 Too Many Requests")).toBe("ai_rate_limit")
    expect(classifyAiError("overloaded_error")).toBe("ai_rate_limit")
    expect(classifyAiError("socket hang up")).toBe("ai_unavailable")
  })

  it("prefers a genuine rate limit over a field name that happens to match", () => {
    // The provider patterns are checked first on purpose: a real 429 whose body
    // mentions a response field must still read as a rate limit, or an operator
    // waits for a fix that is really a retry.
    expect(classifyAiError("429 rate limit — response missing field")).toBe("ai_rate_limit")
  })

  it("never returns the provider's own words to the browser", () => {
    // The reason this module exists: the raw message embeds billing state.
    const body = aiErrorBody(new Error('400 {"message":"credit balance is too low, go to Plans & Billing"}'))
    expect(body.error).toBe("ai_unavailable")
    expect(body.code).toBe("ai_credits")
    expect(JSON.stringify(body)).not.toMatch(/credit balance|Billing/i)
  })

  it("carries the new code through the body the routes return", () => {
    const body = aiErrorBody(new Error("Import Doctor response missing string field: title"))
    expect(body.code).toBe("ai_bad_response")
    // `error` stays the neutral back-compat string for any client reading it.
    expect(body.error).toBe("ai_unavailable")
  })
})
