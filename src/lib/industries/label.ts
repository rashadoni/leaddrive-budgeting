import { useTranslations } from "next-intl";

/**
 * Human-readable industry labels for the UI.
 *
 * Added in the 2026-06-30 UX audit (P1-3): admin/onboarding surfaces rendered
 * the raw `Company.industry` enum code (e.g. `agro_crops`, or `FOOD_PROCESSING`
 * via a CSS uppercase), which reads as a database internal to non-technical
 * users. The canonical localized names already exist in the `industries.*`
 * i18n namespace (built from `src/lib/industries/data.ts`); this just routes
 * codes through it, with a graceful fallback that prettifies any unknown code
 * instead of leaking `snake_case`.
 */

/** Turn a raw enum code into a readable label: `agro_crops` → `Agro Crops`. */
export function prettifyIndustryCode(code: string): string {
  return code
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Hook returning a `(code) => label` function localized to the active locale.
 * Use in client components: `const industryLabel = useIndustryLabel()`.
 */
export function useIndustryLabel(): (code: string | null | undefined) => string {
  const t = useTranslations("industries");
  return (code) => {
    if (!code) return "—";
    return t.has(code as never) ? t(code as never) : prettifyIndustryCode(code);
  };
}
