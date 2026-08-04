/**
 * What period is the time machine actually looking at?
 *
 * 2026-08-04 audit, measured on production. `detectMonth` matched only
 * /^\d{4}-(\d{2})$/, so "2025-Q1" returned null, the slider position collapsed
 * to 0, and the label rendered "All of 2025" — while the period chips beside it
 * showed Q1 pressed and the heatmap header read "HEATMAP · 2025-Q1". Three
 * controls on one strip, two of them right and the loudest one wrong.
 *
 * A label that contradicts the data under it is worse than no label: the reader
 * has no way to tell which of the two is stale.
 */

export type TimeMachineSelection =
  | { kind: "annual"; year: number }
  | { kind: "quarter"; year: number; quarter: number }
  | { kind: "month"; year: number; month: number };

/**
 * Parse a period string as the time machine understands it. Anything that is
 * not a recognised month or quarter is treated as the whole year — the same
 * fallback as before, now reached only when the period really is annual or
 * unparseable, rather than for every quarter.
 */
export function parseTimeMachineSelection(
  period: string,
  fallbackYear: number,
): TimeMachineSelection {
  const yearMatch = /^(\d{4})/.exec(period ?? "");
  const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : fallbackYear;

  const month = /^\d{4}-(\d{2})$/.exec(period ?? "");
  if (month) {
    const n = Number.parseInt(month[1], 10);
    if (n >= 1 && n <= 12) return { kind: "month", year, month: n };
  }

  const quarter = /^\d{4}-Q([1-4])$/i.exec(period ?? "");
  if (quarter) {
    return { kind: "quarter", year, quarter: Number.parseInt(quarter[1], 10) };
  }

  return { kind: "annual", year };
}

/**
 * Slider knob position, on the 0..12 month scale the control is built on.
 *
 * A quarter spans three months, so it has no single honest position; it stays
 * at 0, the slider's "no specific month" slot. The LABEL still names the
 * quarter, which is the part that was lying.
 */
export function sliderPositionFor(selection: TimeMachineSelection): number {
  return selection.kind === "month" ? selection.month : 0;
}
