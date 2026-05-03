/**
 * Phase 7.G Turn G — alert message param localization helper.
 *
 * Closes CARRYOVER L135 (sub-35 follow-up — `industries.*` i18n
 * namespace, 22 turns OPEN). The 2 sector alert rules
 * (`RULE_SECTOR_AMBER_CLUSTER`, `RULE_SECTOR_RED_SPREAD`) emit
 * `messageParams.industry` as the raw canonical industry code (e.g.
 * `"industrial"`) which leaked unchanged through the i18n template
 * substitution into RU/AZ locale renderings. Russian users saw
 * "Сектор industrial: …" instead of "Сектор промышленность: …".
 *
 * Solution: each render site passes the alert's `messageParams` through
 * this helper, which substitutes the industry code with its localized
 * label from the new top-level `industries.*` namespace. The helper is
 * deliberately small + pure — usable identically from client
 * (`useTranslations('industries')`) and server-component
 * (`await getTranslations('industries')`) call sites.
 *
 * Fail-safe contract:
 *   - Pass-through if `params.industry` is missing or non-string.
 *   - Pass-through if `industriesT.has(code)` is false (unknown code →
 *     keep raw to avoid blank substitution).
 *   - All other params left untouched.
 */

/**
 * Minimal shape of the next-intl translation function we depend on.
 * Both `useTranslations('industries')` (client hook) and
 * `getTranslations('industries')` (server) return values matching this
 * signature, so the helper accepts either without imports from next-intl.
 */
export interface IndustryTranslator {
  (key: string): string;
  has: (key: string) => boolean;
}

/**
 * Replace `params.industry` (if present + translatable) with its
 * localized label. Returns a new params object — original is not
 * mutated. Other keys pass through verbatim.
 *
 * Defensive against translators that lack a `.has()` method (e.g. the
 * vitest setup mock at `vitest.setup.ts:295` returns a plain function
 * with no `.has`). When `.has` is missing, falls through to a guarded
 * try/catch around the translator call so unknown-code lookups don't
 * blow up the render path. Production next-intl always provides `.has`.
 */
export function localizeAlertMessageParams(
  params: Record<string, string | number>,
  industriesT: IndustryTranslator,
): Record<string, string | number> {
  const ind = params.industry;
  if (typeof ind !== 'string') return params;
  if (typeof industriesT.has === 'function') {
    if (!industriesT.has(ind)) return params;
    return { ...params, industry: industriesT(ind) };
  }
  // Fallback path — translator lacks `.has`. Try the lookup, fall back
  // to raw code on any throw (matches the "unknown code → pass-through"
  // semantic of the primary path).
  try {
    const translated = industriesT(ind);
    if (typeof translated !== 'string' || translated.length === 0) {
      return params;
    }
    return { ...params, industry: translated };
  } catch {
    return params;
  }
}
