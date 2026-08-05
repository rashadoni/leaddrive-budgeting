/**
 * Shared formula-engine error localizer.
 *
 * The engine (`src/lib/risk/formula-engine.ts`) emits English-only
 * `reason` strings ("Failed to parse formula: …", "Formula did not
 * produce a finite number (got NaN)"). They are developer-grade text
 * that used to leak straight into the UI: HeatMapCellTd localized them,
 * IndicatorDetail's "Pipeline note" did not, so the same failure read in
 * Azerbaijani in one panel and English in the next.
 *
 * Extracted from HeatMapCellTd (2026-07-31) so both call-sites share one
 * mapping. Unknown codes fall back to the raw engine reason — better a
 * developer string than an empty box.
 */

export type FormulaErrorTranslator = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function localizeFormulaError(
  code: string,
  reason: string,
  indicatorCode: string,
  t: FormulaErrorTranslator,
): string {
  // Most common case: _VS_<YEAR> Δ-indicators NaN because the baseline
  // year's IndicatorValue isn't in the DB. Show the year + actionable
  // import hint instead of the cryptic engine error.
  if (code === 'non_finite') {
    const m = indicatorCode.match(/_VS_(\d{4})/);
    if (m) {
      return t('heatMap.errMissingBaseline', { year: m[1] });
    }
    return t('heatMap.errNonFinite');
  }
  if (code === 'parse') return t('heatMap.errParse');
  if (code === 'eval') return t('heatMap.errEval');
  // 2026-08-05 — a holding whose children have no value for the period. The
  // engine reason says "the sum is empty, not zero" in English only; the
  // whole point of the code is that a reader must not take the cell for a
  // measured zero, so it cannot be left to the raw-reason fallback.
  if (code === 'rollup_no_child_values') {
    return t('heatMap.errRollupNoChildValues');
  }
  return reason;
}
