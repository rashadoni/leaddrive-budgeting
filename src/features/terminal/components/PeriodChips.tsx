"use client";

/**
 * Phase 7.G CLI (Bloomberg-sweep) — Period selector chips for the HeatMap.
 *
 * Bloomberg analyst convention: every chart/grid has a horizontal row of
 * period chips (`1D 5D 1M 3M YTD 1Y 5Y MAX`). We mirror with:
 *   - Year   : current year (also acts as "annual" anchor)
 *   - Quarter: Q1 Q2 Q3 Q4
 *   - Month  : 1 2 … 12 (Roman M1..M12 in compact mode)
 *
 * Stateless — caller owns `current` + `onChange`. The period string format
 * matches `parsePeriod` (src/lib/risk/periods.ts):
 *   "2026"    annual
 *   "2026-Q1" quarter
 *   "2026-04" month (zero-padded)
 *
 * No new dep. Pure React + Tailwind.
 */

import { useTranslations } from "next-intl";

interface Props {
  /** Active period string (annual "YYYY", quarter "YYYY-Qn", month "YYYY-MM"). */
  current: string;
  /** Caller dispatches the new period. */
  onChange: (period: string) => void;
  /** Optional year override; defaults to current year. */
  year?: number;
  /** Tighter density (smaller chips, no labels). */
  compact?: boolean;
  /**
   * 2026-07-15 — years the org actually has data for (matrix
   * `availableYears`). When provided, ONE annual chip renders per year so
   * the user can navigate across fiscal years; without it only the active
   * year's chip renders (the pre-fix behaviour, which left every other
   * year's data unreachable). The active year is always included even if
   * absent from the list.
   */
  availableYears?: number[];
}

const QUARTERS = [1, 2, 3, 4] as const;
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function detectKind(period: string): "year" | "quarter" | "month" {
  if (/^\d{4}-Q[1-4]$/.test(period)) return "quarter";
  if (/^\d{4}-\d{2}$/.test(period)) return "month";
  return "year";
}

function detectYear(period: string, fallback: number): number {
  const m = period.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : fallback;
}

export function PeriodChips({
  current,
  onChange,
  year,
  compact = false,
  availableYears,
}: Props) {
  const t = useTranslations("terminal");
  const fallbackYear = new Date().getUTCFullYear();
  const activeYear = year ?? detectYear(current, fallbackYear);
  const kind = detectKind(current);
  const isAnnualActive = kind === "year";
  const activeQuarter = kind === "quarter" ? parseInt(current.slice(-1), 10) : null;
  const activeMonth = kind === "month" ? parseInt(current.slice(-2), 10) : null;

  // One chip per navigable year; the active year is always present so a
  // caller passing a stale/partial list can't orphan the current selection.
  const yearChips = [...new Set([...(availableYears ?? []), activeYear])].sort(
    (a, b) => a - b,
  );

  const chipBase =
    "px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-tight border transition-colors cursor-pointer select-none";
  const chipInactive = "border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300";
  const chipActive = "border-cyan-500/60 bg-cyan-500/15 text-cyan-300";
  /** Year carrying the active quarter/month selection (annual not selected). */
  const chipActiveYearContext = "border-cyan-700/50 text-cyan-500";

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap"
      data-testid="period-chips"
      aria-label={t("periodChips.ariaLabel")}
    >
      {/* Years (annual anchors) */}
      {yearChips.map((y) => {
        const value = String(y);
        const isActive = isAnnualActive && current === value;
        const isContext = !isAnnualActive && y === activeYear;
        return (
          <button
            key={y}
            type="button"
            onClick={() => onChange(value)}
            aria-pressed={isActive}
            className={`${chipBase} ${
              isActive ? chipActive : isContext ? chipActiveYearContext : chipInactive
            }`}
            title={t("periodChips.annualHint", { year: y })}
          >
            {value}
          </button>
        );
      })}

      {!compact && <span className="text-gray-700">·</span>}

      {/* Quarters */}
      <div className="flex items-center gap-0.5">
        {QUARTERS.map((q) => {
          const value = `${activeYear}-Q${q}`;
          const isActive = activeQuarter === q;
          return (
            <button
              key={q}
              type="button"
              onClick={() => onChange(value)}
              aria-pressed={isActive}
              className={`${chipBase} ${isActive ? chipActive : chipInactive}`}
              title={t("periodChips.quarterHint", { q, year: activeYear })}
            >
              Q{q}
            </button>
          );
        })}
      </div>

      {!compact && <span className="text-gray-700">·</span>}

      {/* Months */}
      <div className="flex items-center gap-0.5">
        {MONTHS.map((m) => {
          const mm = String(m).padStart(2, "0");
          const value = `${activeYear}-${mm}`;
          const isActive = activeMonth === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onChange(value)}
              aria-pressed={isActive}
              className={`${chipBase} ${isActive ? chipActive : chipInactive}`}
              title={t("periodChips.monthHint", { m, year: activeYear })}
            >
              M{m}
            </button>
          );
        })}
      </div>
    </div>
  );
}
