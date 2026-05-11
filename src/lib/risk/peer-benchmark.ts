/**
 * Phase 7.H Feature 3 — Peer Benchmarking pure module.
 *
 * Given an "own" series (your company's IV values across 12 trailing
 * periods) and a cohort (other companies in the same industry, same
 * indicator, same periods), compute median + p75 per period + the
 * own-company's rank.
 *
 * Pure: no Prisma, no I/O. Caller fetches the rows + period list.
 */

export interface PeerSeriesPoint {
  period: string;
  value: number | null;
}

export interface PeerBenchmarkInput {
  /** Your company's series — values per period (null = no data). */
  ownSeries: PeerSeriesPoint[];
  /** Cohort: other companies' values per period. Length per company
   *  matches periods count; nulls represent missing data. */
  cohortSeries: Array<{ companyId: string; values: (number | null)[] }>;
  /** Period strings, ordered oldest-to-newest. Same length as
   *  ownSeries + each cohort entry's `values` array. */
  periods: string[];
  /** "higher_better" / "lower_better" affects ranking direction. */
  direction: "higher_better" | "lower_better" | "band";
}

export interface PeerBenchmarkResult {
  ownSeries: PeerSeriesPoint[];
  medianSeries: PeerSeriesPoint[];
  p75Series: PeerSeriesPoint[];
  /** Rank as of the latest period — 1 = best in cohort.
   *  total = ownCompany + cohort companies with data this period.
   *  null when own value is null OR cohort is empty. */
  rank: { position: number; total: number } | null;
  /** True when cohort has < 3 distinct companies → median/p75 not
   *  meaningful; UI should hide the chart. */
  insufficientPeers: boolean;
}

const MIN_COHORT = 3

export function computePeerBenchmark(
  input: PeerBenchmarkInput,
): PeerBenchmarkResult {
  const periods = input.periods
  // Cohort distinct companies (excluding own which the caller passes
  // separately).
  const cohortCount = input.cohortSeries.length

  if (cohortCount < MIN_COHORT) {
    return {
      ownSeries: input.ownSeries,
      medianSeries: periods.map((p) => ({ period: p, value: null })),
      p75Series: periods.map((p) => ({ period: p, value: null })),
      rank: null,
      insufficientPeers: true,
    }
  }

  const medianSeries: PeerSeriesPoint[] = []
  const p75Series: PeerSeriesPoint[] = []
  for (let i = 0; i < periods.length; i++) {
    const slice: number[] = []
    for (const c of input.cohortSeries) {
      const v = c.values[i]
      if (typeof v === "number" && Number.isFinite(v)) slice.push(v)
    }
    if (slice.length === 0) {
      medianSeries.push({ period: periods[i], value: null })
      p75Series.push({ period: periods[i], value: null })
      continue
    }
    slice.sort((a, b) => a - b)
    medianSeries.push({ period: periods[i], value: percentile(slice, 0.5) })
    p75Series.push({ period: periods[i], value: percentile(slice, 0.75) })
  }

  // Rank at latest period — count own + cohort values this period,
  // sort by direction, find own's position.
  const lastIdx = periods.length - 1
  const ownLast = input.ownSeries[lastIdx]?.value
  let rank: { position: number; total: number } | null = null
  if (typeof ownLast === "number" && Number.isFinite(ownLast)) {
    const all: number[] = [ownLast]
    for (const c of input.cohortSeries) {
      const v = c.values[lastIdx]
      if (typeof v === "number" && Number.isFinite(v)) all.push(v)
    }
    if (all.length >= 2) {
      const sorted =
        input.direction === "lower_better"
          ? [...all].sort((a, b) => a - b)
          : [...all].sort((a, b) => b - a)
      const position = sorted.indexOf(ownLast) + 1
      rank = { position, total: sorted.length }
    }
  }

  return {
    ownSeries: input.ownSeries,
    medianSeries,
    p75Series,
    rank,
    insufficientPeers: false,
  }
}

/** Linear-interpolation percentile for a sorted ascending array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  if (sortedAsc.length === 1) return sortedAsc[0]
  const idx = (sortedAsc.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  const frac = idx - lo
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac
}
