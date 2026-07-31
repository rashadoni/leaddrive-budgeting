/**
 * Pick the caller's language out of an en/az/ru name triple.
 *
 * 2026-07-31 (11.53) — added because the AI Import preview hardcoded
 * `ind.nameRu ?? ind.nameEn` at two call sites, so an Azerbaijani operator
 * looking at an Azerbaijani page read every indicator name in Russian —
 * even though `nameAz` was already seeded ("Qida Emalı Ümumi Marja") and
 * already on the wire (`datatype-indicator-map.ts` puts it in the response).
 * The data was there the whole time; only the picker was missing.
 *
 * The en/az/ru ternary is written inline in a dozen components already
 * (CompanyTree, IndicatorHealthView, DataEntryAdmin, …). This is that same
 * rule, named once, so the next surface does not have to re-derive it —
 * and so "which language did we fall back to?" has one answer.
 *
 * Fallback is deliberate and asymmetric: a missing az/ru name falls back to
 * ENGLISH, never to the other translation. Showing a Russian string to an
 * Azerbaijani reader is the bug this closes; showing English is merely a gap.
 */

/** The three name columns every seeded catalog row carries. */
export interface LocalizedNameTriple {
  nameEn: string | null | undefined
  nameAz?: string | null
  nameRu?: string | null
}

/**
 * @param locale  next-intl active locale ("en" | "az" | "ru"; anything else
 *                is treated as English rather than guessed at).
 * @param fallback returned when the triple has no usable name at all — pass
 *                the row's code so the UI shows an identifier, never "".
 */
export function localizedName(
  locale: string,
  names: LocalizedNameTriple,
  fallback = "",
): string {
  const en = names.nameEn?.trim() || ""
  if (locale === "az") return names.nameAz?.trim() || en || fallback
  if (locale === "ru") return names.nameRu?.trim() || en || fallback
  return en || fallback
}
