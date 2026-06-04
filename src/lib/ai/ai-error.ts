/**
 * Sanitize an AI / LLM provider error before it reaches the client.
 *
 * The Anthropic SDK throws errors whose `.message` embeds the provider's raw
 * payload — e.g. `400 {"type":"error","error":{"type":"invalid_request_error",
 * "message":"Your credit balance is too low … go to Plans & Billing …"}}`.
 * Returning that verbatim to the browser (a) leaks internal billing state to
 * enterprise end-users (violates the "don't frighten customers" rule) and
 * (b) reads as a broken product. AI routes MUST log the raw error server-side
 * and return only a STABLE machine code; the client maps the code to a neutral
 * localized message and never renders the raw provider string.
 */

export type AiErrorCode = "ai_credits" | "ai_rate_limit" | "ai_unavailable"

/** Classify a raw provider-error string into a stable, client-safe code. */
export function classifyAiError(raw: string): AiErrorCode {
  const s = (raw || "").toLowerCase()
  if (/credit balance|insufficient_quota|\bquota\b|billing|payment|plans & billing/.test(s)) {
    return "ai_credits"
  }
  if (/rate.?limit|\b429\b|overloaded|too many requests/.test(s)) {
    return "ai_rate_limit"
  }
  return "ai_unavailable"
}

/**
 * The sanitized JSON body to return from an AI route's catch block. `error`
 * is always the neutral string `"ai_unavailable"` (back-compat for any client
 * reading `body.error`); `code` carries the classification for operators /
 * a future admin surface. NEVER includes the raw provider message.
 */
export function aiErrorBody(err: unknown): {
  error: "ai_unavailable"
  code: AiErrorCode
} {
  const raw = err instanceof Error ? err.message : String(err)
  return { error: "ai_unavailable", code: classifyAiError(raw) }
}
