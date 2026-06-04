/**
 * Localize an AI-narrative fact-check flag (reason + suggestion) into the
 * active UI locale.
 *
 * `narrative-fact-check.ts` (the pure server-side checker) emits each flag with
 * a stable `code` (numberAbsent | numberUnmatched | futureYear) + `params`, plus
 * English `reason`/`suggestion` strings as a fallback. Previously the terminal
 * panels rendered those English strings verbatim — so the fact-check block read
 * in English even under an AZ/RU UI. This helper maps the code → the localized
 * `varianceExplainer.factCheck.{reason,suggestion}.<code>` message, falling back
 * to the EN strings when no code is present (e.g. an older cached payload).
 */

/** Minimal translator shape — assignable from next-intl's `useTranslations(...)` t. */
type TranslateFn = (key: string, values?: Record<string, string | number>) => string

export interface FactCheckFlagLike {
  code?: "numberAbsent" | "numberUnmatched" | "futureYear"
  params?: Record<string, string | number>
  reason: string
  suggestion: string
}

export function localizeFactCheckFlag(
  flag: FactCheckFlagLike,
  t: TranslateFn,
): { reason: string; suggestion: string } {
  const p = flag.params ?? {}
  switch (flag.code) {
    case "numberAbsent":
      return {
        reason: t("varianceExplainer.factCheck.reason.numberAbsent", p),
        suggestion: t("varianceExplainer.factCheck.suggestion.numberAbsent", p),
      }
    case "numberUnmatched":
      return {
        reason: t("varianceExplainer.factCheck.reason.numberUnmatched", p),
        suggestion: t("varianceExplainer.factCheck.suggestion.numberUnmatched", p),
      }
    case "futureYear":
      return {
        reason: t("varianceExplainer.factCheck.reason.futureYear", p),
        suggestion: t("varianceExplainer.factCheck.suggestion.futureYear", p),
      }
    default:
      // No machine code (older payload) → fall back to the English strings the
      // checker already produced.
      return { reason: flag.reason, suggestion: flag.suggestion }
  }
}
