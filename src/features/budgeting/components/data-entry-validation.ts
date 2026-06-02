import type { MetricValidationRule } from "@/lib/risk/metric-validation-rules"

/**
 * Live client-side check for the operational-KPI value field, so the user
 * gets immediate in-range / out-of-range feedback as they type — mirroring
 * the server bounds (hard min/max → reject; soft warnMin/warnMax → confirm).
 * Pre-empts the server's 400 / confirm round-trip with inline guidance.
 */
export type ValueCheck =
  | { state: "empty" }
  | { state: "ok" }
  | { state: "warn"; bound: number; dir: "low" | "high" }
  | { state: "error"; bound: number; dir: "low" | "high" }
  | { state: "nan" }

export function checkMetricValue(
  rule: MetricValidationRule,
  raw: string,
): ValueCheck {
  if (raw.trim() === "") return { state: "empty" }
  const v = Number(raw)
  if (!Number.isFinite(v)) return { state: "nan" }
  if (v < rule.min) return { state: "error", bound: rule.min, dir: "low" }
  if (v > rule.max) return { state: "error", bound: rule.max, dir: "high" }
  if (rule.warnMin != null && v < rule.warnMin)
    return { state: "warn", bound: rule.warnMin, dir: "low" }
  if (rule.warnMax != null && v > rule.warnMax)
    return { state: "warn", bound: rule.warnMax, dir: "high" }
  return { state: "ok" }
}
