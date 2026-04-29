/**
 * Tier-3 sub-30 Stage 3 — resolveIndicatorLabel helper.
 *
 * Round-13 architect 💡 (deferred until 5th call site arrives) +
 * Round-24 architect ⚠️ (5th + 6th call sites have arrived as
 * CommentsLayer + SubCoFinanceChat) — extract the locale-aware
 * indicator-label resolver from inline duplication into one canonical
 * source.
 *
 * Resolver chain:
 *   ru → ind.nameRu, AZ → ind.nameAz, fallback → ind.nameEn || ind.code
 *
 * Why a separate file:
 * - Used by HeatMap (column header + tooltip), IndicatorDetail (header),
 *   ActionCenterPanel (queue rows), CommentsLayer (cell-key display),
 *   SubCoFinanceChat (channel labels — future), and any new surface that
 *   surfaces an indicator code with a human-readable name.
 * - Pure + side-effect-free + branchless logic — fits the
 *   `src/features/terminal/lib/` convention alongside
 *   `command-parser.ts` / `layout-sizes.ts`.
 *
 * Why fallback to code rather than empty string: in dev mode where seed
 * scripts haven't run, ind.nameEn may be undefined; rendering the code
 * is preferable to rendering nothing (debuggability > prettyness for
 * missing-data states).
 */

/** Minimal indicator shape the resolver depends on. Both `MatrixIndicatorCol`
 *  (`use-matrix.ts`) and `IndicatorMeta` (`IndicatorDetail.tsx`) satisfy
 *  this — the helper accepts either via structural typing. */
export interface IndicatorLabelSource {
  code: string;
  nameEn?: string | null;
  nameAz?: string | null;
  nameRu?: string | null;
}

/**
 * Resolve the human-readable label for an indicator at the user's
 * current locale. Returns the indicator code as a final fallback so
 * the UI never renders empty / undefined.
 *
 * Pure, deterministic, no I/O — safe to call in render loops without
 * memoization (cost is one boolean check + property access).
 */
export function resolveIndicatorLabel(
  ind: IndicatorLabelSource,
  locale: string,
): string {
  if (locale === "ru" && ind.nameRu) return ind.nameRu;
  if (locale === "az" && ind.nameAz) return ind.nameAz;
  return ind.nameEn || ind.code;
}
