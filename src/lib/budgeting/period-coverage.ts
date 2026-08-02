/**
 * How much of the year a set of monthly figures actually covers.
 *
 * 2026-08-02 (11.92) — the P&L page compared a twelve-month budget against a
 * five-month actual and printed the difference as `−13.9M AZN · 2%`, with
 * nothing anywhere saying the two sides cover different amounts of time. Both
 * numbers were right: 14,213,417 is the client's own `PLF Budget 2026`
 * `PLF.08`, 271,160 is their own `PLF Actual 2026` `PLF.08`, and the actual
 * sheet carries January through May. Most of that "variance" is simply the
 * seven months that have not happened.
 *
 * The KPI card above it was worse than unhelpful: it captioned a five-month
 * actual total "Annual budget", asserting both the wrong basis and the wrong
 * span.
 *
 * Same failure as the 72.3M revenue and the 373M balance sheet before it — the
 * number is correct and the sentence around it is not. So this module answers
 * one question, "which months are actually in here", and the surfaces say it
 * out loud.
 */

/** Months carrying data, and whether they form a single unbroken run. */
export interface PeriodCoverage {
  /** 1-based month numbers that carry data, ascending. */
  months: number[]
  /** How many of the twelve. */
  count: number
  /**
   * True when `months` is one unbroken run, so a surface may write "Jan–May".
   * A year missing March cannot be described as a range, and writing one
   * anyway would hide the gap — which on a P&L is a finding, not a detail.
   */
  contiguous: boolean
  /** True when all twelve months carry data — nothing needs qualifying. */
  full: boolean
}

/**
 * Which of the twelve months carry a figure.
 *
 * A month counts as covered when ANY series has a non-zero value for it. Two
 * decisions inside that sentence:
 *
 * - **Any, not all.** A month where revenue landed but COGS happens to be zero
 *   is a month with data. Requiring every series would under-report coverage
 *   and re-introduce the same understatement from the other side.
 * - **Non-zero, not "present".** The monthly maps are dense — twelve keys,
 *   zero-filled — so presence says nothing. Zero is indistinguishable from
 *   absent in this data and is read as absent, which is the safe direction:
 *   it can only make the surface qualify a comparison it might not have had
 *   to, never suppress a qualification it owes.
 */
export function coverageOf(series: ReadonlyArray<ReadonlyArray<number>>): PeriodCoverage {
  const months: number[] = []
  for (let m = 0; m < 12; m++) {
    if (series.some((s) => Number.isFinite(s[m]) && s[m] !== 0)) months.push(m + 1)
  }
  const contiguous =
    months.length > 0 && months[months.length - 1] - months[0] === months.length - 1
  return {
    months,
    count: months.length,
    contiguous,
    full: months.length === 12,
  }
}

/**
 * The i18n key and params a surface needs to describe a coverage in words.
 *
 * Returns `null` when there is nothing to say — a full year needs no caveat,
 * and an empty one is already handled by the "no data" notices
 * (`missing-data.ts`). Emitting a string for those would put a disclaimer on
 * every healthy page, which is how disclaimers stop being read.
 */
export function coverageNotice(
  c: PeriodCoverage,
  monthLabel: (month1Based: number) => string,
): { key: string; params: Record<string, string | number> } | null {
  if (c.full || c.count === 0) return null
  if (c.contiguous) {
    return {
      key: "coverage.partialRange",
      params: {
        from: monthLabel(c.months[0]),
        to: monthLabel(c.months[c.months.length - 1]),
        count: c.count,
      },
    }
  }
  // Non-contiguous: name every month rather than a range. A gap mid-year is
  // the more alarming shape of the two and must not be smoothed into "Jan–Nov".
  return {
    key: "coverage.partialMonths",
    params: {
      months: c.months.map(monthLabel).join(", "),
      count: c.count,
    },
  }
}

/**
 * Call `t(key, params)` when the key is only known at runtime.
 *
 * `coverageNotice` picks between two keys, so next-intl's key union cannot be
 * satisfied statically and `t(key as never, params)` types the params away.
 * Both keys are real and covered by the catalogue-parity guard
 * (`catalogue-guard.test.ts`), so the cast narrows types, not the contract.
 */
export function tParam(
  t: (key: string, params?: Record<string, string | number>) => string,
  key: string,
  params: Record<string, string | number>,
): string {
  return (t as (k: string, p?: Record<string, string | number>) => string)(key, params)
}
