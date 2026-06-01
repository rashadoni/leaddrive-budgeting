/**
 * Client feedback #1 (Azik demo): per-ha indicators show a value but no
 * benchmark — «1 hektara aşağı plankanı göstərir, yuxarı planka best case nə
 * qədər ola bilər». This derives a benchmark BAND from the indicator's REAL
 * configured thresholds (no fabricated "industry best" numbers):
 *   - floor  = the red boundary  (the minimum-acceptable / worst-acceptable line)
 *   - target = the green boundary (the "good / best-practice target")
 * and positions the current value on a track so the user can see at a glance
 * whether their per-ha figure is below the floor, mid-range, or at target.
 *
 * Pure + side-effect-free — fits `src/features/terminal/lib/`. Returns null when
 * a meaningful band can't be derived (missing/equal thresholds, `band`-type
 * indicators) so the UI simply omits the band rather than rendering garbage.
 */

export interface ThresholdRule {
  op: string;
  value: number;
}
export interface IndicatorThresholds {
  green?: ThresholdRule | null;
  amber?: ThresholdRule | null;
  red?: ThresholdRule | null;
}

export interface BenchmarkZone {
  status: "red" | "amber" | "green";
  fromPct: number;
  toPct: number;
}

export interface BenchmarkGeometry {
  /** Lower-acceptable / worst-acceptable boundary (the «aşağı planka»). */
  floor: number;
  /** Good / best-practice target boundary (the «yuxarı planka»). */
  target: number;
  /** Which band the current value falls in. */
  valueStatus: "red" | "amber" | "green";
  /** 0–100 position of the value on the rendered track (clamped). */
  valuePct: number;
  /** True when the value sits beyond the padded track ends. */
  valueOutLow: boolean;
  valueOutHigh: boolean;
  /** 0–100 positions of the floor / target boundary labels on the track. */
  floorPct: number;
  targetPct: number;
  /** Colored zones across the track, left→right. */
  zones: BenchmarkZone[];
  /** True when low values are good (cost/ha) — flips the visual order. */
  lowerIsBetter: boolean;
}

const numOrNull = (r?: ThresholdRule | null): number | null =>
  r && typeof r.value === "number" && Number.isFinite(r.value) ? r.value : null;

const clampPct = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * Compute the benchmark-band geometry for an indicator + current value.
 * Supports `higher_better` and `lower_better`; returns null otherwise.
 */
export function computeBenchmarkBand(
  thresholds: IndicatorThresholds | null | undefined,
  direction: string,
  value: number,
): BenchmarkGeometry | null {
  if (!thresholds || !Number.isFinite(value)) return null;
  const g = numOrNull(thresholds.green);
  const r = numOrNull(thresholds.red);
  if (g === null || r === null) return null;

  const lowerIsBetter = direction === "lower_better";
  if (!lowerIsBetter && direction !== "higher_better") return null;

  // Order the two boundaries low→high on the number line.
  const lo = Math.min(g, r);
  const hi = Math.max(g, r);
  if (hi <= lo) return null; // degenerate / equal thresholds — no meaningful band

  const span = hi - lo;
  const pad = span * 0.4;
  const trackMin = lo - pad;
  const trackMax = hi + pad;
  const range = trackMax - trackMin;
  const pct = (x: number) => clampPct(((x - trackMin) / range) * 100);

  // For higher_better: red below `lo`(=red boundary), green above `hi`(=green).
  // For lower_better: green below `lo`(=green boundary), red above `hi`(=red).
  const zones: BenchmarkZone[] = lowerIsBetter
    ? [
        { status: "green", fromPct: 0, toPct: pct(lo) },
        { status: "amber", fromPct: pct(lo), toPct: pct(hi) },
        { status: "red", fromPct: pct(hi), toPct: 100 },
      ]
    : [
        { status: "red", fromPct: 0, toPct: pct(lo) },
        { status: "amber", fromPct: pct(lo), toPct: pct(hi) },
        { status: "green", fromPct: pct(hi), toPct: 100 },
      ];

  // Value's band status, from the real thresholds.
  let valueStatus: "red" | "amber" | "green";
  if (lowerIsBetter) {
    valueStatus = value <= lo ? "green" : value <= hi ? "amber" : "red";
  } else {
    valueStatus = value < lo ? "red" : value < hi ? "amber" : "green";
  }

  return {
    floor: lowerIsBetter ? hi : lo, // worst-acceptable line
    target: lowerIsBetter ? lo : hi, // good/best target
    valueStatus,
    valuePct: pct(value),
    valueOutLow: value < trackMin,
    valueOutHigh: value > trackMax,
    floorPct: lowerIsBetter ? pct(hi) : pct(lo),
    targetPct: lowerIsBetter ? pct(lo) : pct(hi),
    zones,
    lowerIsBetter,
  };
}
