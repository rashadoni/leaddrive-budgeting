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

export type AiErrorCode =
  | "ai_credits"
  | "ai_rate_limit"
  | "ai_unavailable"
  /**
   * 2026-08-02 — the model answered; OUR parser rejected the shape.
   *
   * Reported as `ai_unavailable` until now, which sent an operator to check
   * API keys and billing for a defect in our own prompt. Measured on
   * production: `Import Doctor response missing string field: title`, thrown
   * because the fix prompt described three proposal kinds without ever naming
   * a required field. Nothing was wrong with the key, the credits, or the
   * client's data.
   *
   * Safe to surface: the message is ours, not the provider's, so none of the
   * leak concerns in this file's header apply to it.
   */
  | "ai_bad_response"

/** Classify a raw provider-error string into a stable, client-safe code. */
export function classifyAiError(raw: string): AiErrorCode {
  const s = (raw || "").toLowerCase()
  if (/credit balance|insufficient_quota|\bquota\b|billing|payment|plans & billing/.test(s)) {
    return "ai_credits"
  }
  if (/rate.?limit|\b429\b|overloaded|too many requests/.test(s)) {
    return "ai_rate_limit"
  }
  // Our own validators, not the provider. Checked AFTER the provider patterns
  // so a genuine 429 that happens to mention a field name is still a rate
  // limit.
  //
  // 2026-08-03 — widened after the 2026-08-02 list proved to be an enumeration
  // of the errors seen so far rather than of the ones the validators throw.
  // `Executable Import Doctor fix must be low or medium risk` matched none of
  // the four patterns and was reported to the operator as an outage. The
  // additions are the remaining shapes in `import-doctor.ts`: `must be low or
  // medium risk`, `needs patch`, `array is empty`, and the generic
  // `Import Doctor …` prefix as a backstop, so a validator added later is
  // wrong-shaped rather than silently mislabelled as a provider failure.
  if (
    /response must be|response missing|must be an object|must be a JSON object/.test(s) ||
    /must be low or medium risk|needs patch|array is empty|must change/.test(s) ||
    /^import doctor |import doctor (response|fix|explanation)/.test(s)
  ) {
    return "ai_bad_response"
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
