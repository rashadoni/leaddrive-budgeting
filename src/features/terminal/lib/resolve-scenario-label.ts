/**
 * Phase 7.G Turn K — resolveScenarioLabel helper.
 *
 * Closes the Turn-H' filed `ScenarioPanel.tsx Scenario.nameEn migration`
 * 🔄 (CARRYOVER follow-up). Mirrors `resolveIndicatorLabel` in shape +
 * fallback semantics so the codebase stays consistent across the two
 * locale-aware label resolvers.
 *
 * Why a separate file from `resolve-indicator-label.ts`:
 * - Different table (`Scenario` vs `IndicatorDefinition`) — the input
 *   shape differs (`Scenario` has `code`/`nameEn`/`nameRu`/`nameAz`,
 *   same as IndicatorDefinition today, but they may diverge in future
 *   migrations).
 * - Single-purpose helpers communicate intent better than a generic
 *   "resolveLabel(code, names, locale)" surface.
 * - Test isolation: each helper has its own focused test file mirroring
 *   the resolver chain.
 *
 * Resolver chain (identical to indicator helper):
 *   ru → scenario.nameRu, AZ → scenario.nameAz, fallback → scenario.nameEn || scenario.code
 *
 * Schema note: `Scenario.nameEn` is required (NOT NULL); `nameRu` +
 * `nameAz` are optional. Seed at `scripts/seed-scenarios.ts` populates
 * all 3 for each named scenario, but a hand-inserted scenario may have
 * only `nameEn` — the helper falls back gracefully.
 */

/** Minimal scenario shape the resolver depends on. The `Scenario` Prisma
 *  model + the local `Scenario` interface in `ScenarioPanel.tsx:37-46`
 *  both satisfy this. */
export interface ScenarioLabelSource {
  code: string;
  nameEn?: string | null;
  nameAz?: string | null;
  nameRu?: string | null;
}

/**
 * Resolve the human-readable label for a scenario at the user's
 * current locale. Returns the scenario code as a final fallback so
 * the UI never renders empty / undefined.
 *
 * Pure, deterministic, no I/O — safe to call in render loops without
 * memoization (cost is one boolean check + property access).
 */
export function resolveScenarioLabel(
  scenario: ScenarioLabelSource,
  locale: string,
): string {
  if (locale === "ru" && scenario.nameRu) return scenario.nameRu;
  if (locale === "az" && scenario.nameAz) return scenario.nameAz;
  return scenario.nameEn || scenario.code;
}
