"use client"

/**
 * Localize the validator sentences the API returns for inline data entry.
 *
 * `validateValue` / `validateFinancialValue` run server-side with no UI
 * locale, so every rejection and confirm-gate bullet used to arrive as an
 * English sentence and render verbatim on an Azerbaijani screen. They now
 * emit a `ValidationMessage` twin (stable key + ICU params) beside each
 * sentence; this hook resolves those against `adminIndicatorHealth.validation.*`
 * and falls back to the English sentence whenever the key is unknown or the
 * response predates the change.
 */

import { useTranslations } from "next-intl"
import type { ValidationMessage } from "@/lib/risk/metric-validation-rules"

/** Narrow an untyped JSON field into ValidationMessage[]. */
export function parseValidationMessages(v: unknown): ValidationMessage[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (m): m is ValidationMessage =>
      !!m && typeof m === "object" && typeof (m as ValidationMessage).key === "string",
  )
}

/** Narrow an untyped JSON field into a single ValidationMessage. */
export function parseValidationMessage(v: unknown): ValidationMessage | null {
  return !!v && typeof v === "object" && typeof (v as ValidationMessage).key === "string"
    ? (v as ValidationMessage)
    : null
}

export function useValidationText(): {
  one: (message: unknown, fallback: string) => string
  list: (messages: unknown, fallback: string[]) => string[]
} {
  const t = useTranslations("adminIndicatorHealth.validation")
  const one = (message: unknown, fallback: string): string => {
    const m = parseValidationMessage(message)
    if (!m || !t.has(m.key as never)) return fallback
    return t(m.key as never, m.params as never)
  }
  return {
    one,
    list: (messages, fallback) => {
      const parsed = parseValidationMessages(messages)
      // Index-aligned by construction. A length mismatch means the response
      // is older than this contract — render the English sentences as-is.
      if (parsed.length !== fallback.length) return fallback
      return parsed.map((m, i) => one(m, fallback[i]))
    },
  }
}
