import { describe, it, expect } from "vitest"
import { classifyAiError, aiErrorBody } from "./ai-error"

describe("classifyAiError", () => {
  it("classifies the Anthropic credit-balance error (the user's screenshot)", () => {
    const raw =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
    expect(classifyAiError(raw)).toBe("ai_credits")
  })

  it("classifies quota / billing variants as ai_credits", () => {
    expect(classifyAiError("insufficient_quota")).toBe("ai_credits")
    expect(classifyAiError("Your monthly quota has been exhausted")).toBe("ai_credits")
    expect(classifyAiError("payment required")).toBe("ai_credits")
  })

  it("classifies rate-limit / overloaded as ai_rate_limit", () => {
    expect(classifyAiError("429 Too Many Requests")).toBe("ai_rate_limit")
    expect(classifyAiError("rate limit exceeded")).toBe("ai_rate_limit")
    expect(classifyAiError("Overloaded")).toBe("ai_rate_limit")
  })

  it("falls back to ai_unavailable for anything else", () => {
    expect(classifyAiError("ECONNRESET")).toBe("ai_unavailable")
    expect(classifyAiError("")).toBe("ai_unavailable")
    expect(classifyAiError("some unexpected 500")).toBe("ai_unavailable")
  })
})

describe("aiErrorBody", () => {
  it("never leaks the raw provider message — only a neutral error + code", () => {
    const err = new Error(
      '400 {"message":"Your credit balance is too low … Plans & Billing"}',
    )
    const body = aiErrorBody(err)
    expect(body.error).toBe("ai_unavailable")
    expect(body.code).toBe("ai_credits")
    // The raw billing text must not appear anywhere in the serialized body.
    expect(JSON.stringify(body)).not.toMatch(/credit balance|Plans & Billing/i)
  })

  it("handles non-Error throwables", () => {
    expect(aiErrorBody("boom")).toEqual({ error: "ai_unavailable", code: "ai_unavailable" })
    expect(aiErrorBody(null)).toEqual({ error: "ai_unavailable", code: "ai_unavailable" })
  })
})
