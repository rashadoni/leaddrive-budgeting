/**
 * Shared Panel-3 value formatters — extracted from IndicatorDetail.tsx (Phase 8
 * D1 2026-05-29). Pure (no imports): used by both the parent component AND the
 * ForecastSection subsystem, so they live in a shared module to keep the
 * subsystem extractions cycle-free.
 */

export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1000
    ? v.toFixed(0)
    : Math.abs(v) >= 10
    ? v.toFixed(1)
    : v.toFixed(2);
}

/** Headline-value formatter that respects the indicator's unit.
 *  Mirrors HeatMap.formatValueCompact: AZN/money → K/M/B + ₼,
 *  % → fixed-precision percent, else compact decimals. Used for the
 *  big number at the top of Panel 3 — the "42682305" eyesore was raw
 *  formatValue() not knowing the unit (Phase 7.H follow-up fix). */
export function formatHeadlineValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  const u = (unit ?? "").trim();
  if (u === "%" || /percent/i.test(u)) {
    return `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;
  }
  const abs = Math.abs(v);
  if (u === "AZN" || u === "₼" || u === "USD" || u === "EUR" || /^[A-Z]{3}$/.test(u)) {
    const suffix = u === "AZN" ? "₼" : u;
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B ${suffix}`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M ${suffix}`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K ${suffix}`;
    return `${v.toFixed(0)} ${suffix}`;
  }
  // tCO2e / score / count / unitless — compact decimals.
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B${u ? " " + u : ""}`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M${u ? " " + u : ""}`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K${u ? " " + u : ""}`;
  return `${v.toFixed(abs >= 10 ? 1 : 2)}${u ? " " + u : ""}`;
}
