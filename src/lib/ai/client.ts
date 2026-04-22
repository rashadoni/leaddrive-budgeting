import Anthropic from "@anthropic-ai/sdk"

// Default to the Sonnet tier — cost/quality sweet spot for finance prose.
// Opus is available by switching this constant if a client wants deeper reasoning.
export const AI_MODEL = "claude-sonnet-4-5-20250929"

let cached: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (cached) return cached
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — add it to .env and restart the dev server.",
    )
  }
  cached = new Anthropic({ apiKey: key })
  return cached
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
