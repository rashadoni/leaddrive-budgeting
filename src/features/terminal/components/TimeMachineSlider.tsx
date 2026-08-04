"use client";

/**
 * Tier 3 Time-Machine — scrub through months of the active year.
 *
 * Sits below PeriodChips. Slider position drives `onChange(period)` with
 * a "YYYY-MM" string. Play button auto-advances M1 → M12, pause halts.
 * Reset jumps back to the year-annual chip.
 *
 * Stateless: caller (HeatMap) owns the period state and re-fetches the
 * matrix on change. Nothing recomputed server-side — sparkline series
 * already covers the 12-month history.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  parseTimeMachineSelection,
  sliderPositionFor,
} from "../lib/time-machine-selection";
import { Play, Pause, SkipBack, RotateCcw } from "lucide-react";

interface Props {
  current: string;
  onChange: (period: string) => void;
  year?: number;
  /** ms between auto-advance steps when playing. */
  stepMs?: number;
}

function detectYear(period: string, fallback: number): number {
  const m = period.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : fallback;
}

function detectMonth(period: string): number | null {
  const m = period.match(/^\d{4}-(\d{2})$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 12 ? n : null;
}

export function TimeMachineSlider({ current, onChange, year, stepMs = 700 }: Props) {
  const t = useTranslations("terminal");
  const fallbackYear = new Date().getUTCFullYear();
  // 2026-08-04 audit — `detectMonth` returned null for "2025-Q1", which
  // collapsed the position to 0 and made the label read "All of 2025" beside a
  // chip row showing Q1. The selection is now parsed once, for both.
  const selection = parseTimeMachineSelection(current, year ?? fallbackYear);
  const activeYear = year ?? selection.year;
  const currentMonth = selection.kind === "month" ? selection.month : null;
  const sliderValue = sliderPositionFor(selection);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-advance loop. Stops at M12 (no wraparound — analyst expects
  // playback to end at year-end, not loop).
  useEffect(() => {
    if (!playing) return;
    intervalRef.current = setInterval(() => {
      const next = sliderValue + 1;
      if (next > 12) {
        setPlaying(false);
        return;
      }
      const mm = String(next).padStart(2, "0");
      onChange(`${activeYear}-${mm}`);
    }, stepMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, sliderValue, activeYear, onChange, stepMs]);

  const setMonth = (n: number) => {
    if (n === 0) {
      onChange(String(activeYear));
    } else {
      const mm = String(n).padStart(2, "0");
      onChange(`${activeYear}-${mm}`);
    }
  };

  const stepBack = () => setMonth(Math.max(0, sliderValue - 1));
  const stepForward = () => setMonth(Math.min(12, sliderValue + 1));
  const reset = () => {
    setPlaying(false);
    onChange(String(activeYear));
  };

  const label =
    selection.kind === "month"
      ? `M${selection.month} ${activeYear}`
      : selection.kind === "quarter"
        ? `Q${selection.quarter} ${activeYear}`
        : t("timeMachine.annual", { year: activeYear });

  return (
    <div
      className="flex items-center gap-2 text-[10px]"
      data-testid="time-machine-slider"
      aria-label={t("timeMachine.ariaLabel")}
    >
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        className="text-gray-500 hover:text-cyan-300 transition-colors"
        title={playing ? t("timeMachine.pause") : t("timeMachine.play")}
        aria-pressed={playing}
      >
        {playing ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <button
        type="button"
        onClick={stepBack}
        disabled={sliderValue <= 0}
        className="text-gray-500 hover:text-cyan-300 disabled:opacity-30 disabled:hover:text-gray-500 transition-colors"
        title={t("timeMachine.stepBack")}
      >
        <SkipBack size={11} />
      </button>
      <input
        type="range"
        min={0}
        max={12}
        step={1}
        value={sliderValue}
        onChange={(e) => {
          setPlaying(false);
          setMonth(parseInt(e.target.value, 10));
        }}
        className="flex-1 min-w-[120px] max-w-[280px] accent-cyan-500 cursor-pointer"
        aria-valuetext={label}
        aria-label={t("timeMachine.sliderLabel")}
      />
      <button
        type="button"
        onClick={stepForward}
        disabled={sliderValue >= 12}
        className="text-gray-500 hover:text-cyan-300 disabled:opacity-30 disabled:hover:text-gray-500 transition-colors rotate-180"
        title={t("timeMachine.stepForward")}
      >
        <SkipBack size={11} />
      </button>
      <span className="text-cyan-300 font-mono tabular-nums min-w-[60px]">
        {label}
      </span>
      <button
        type="button"
        onClick={reset}
        className="text-gray-500 hover:text-cyan-300 transition-colors"
        title={t("timeMachine.reset")}
      >
        <RotateCcw size={11} />
      </button>
    </div>
  );
}
