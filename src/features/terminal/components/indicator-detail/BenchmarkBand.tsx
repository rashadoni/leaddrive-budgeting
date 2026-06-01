"use client";
/**
 * Client feedback #1 — per-ha (and any threshold) indicator benchmark band.
 * Shows floor (red boundary) → target (green boundary) as a colored track with
 * the current value marked, so «is my per-ha number good?» is answerable at a
 * glance. Bounds come from the indicator's REAL configured thresholds — no
 * fabricated industry numbers. Distinct from the peer "Benchmark" button (which
 * compares against other companies); this is the configured target range.
 */
import { useTranslations } from "next-intl";
import { computeBenchmarkBand, type IndicatorThresholds } from "../../lib/benchmark-band";

const ZONE_BG: Record<"red" | "amber" | "green", string> = {
  red: "bg-[#FF4757]/60",
  amber: "bg-[#FFB800]/60",
  green: "bg-[#00D4AA]/60",
};
const STATUS_TEXT: Record<"red" | "amber" | "green", string> = {
  red: "text-[#FF4757]",
  amber: "text-[#FFB800]",
  green: "text-[#00D4AA]",
};

function fmt(n: number): string {
  return Math.abs(n) >= 1000
    ? Math.round(n).toLocaleString("ru-RU")
    : String(Math.round(n * 100) / 100);
}

export function BenchmarkBand({
  thresholds,
  direction,
  value,
  unit,
}: {
  thresholds: IndicatorThresholds | null | undefined;
  direction: string;
  value: number;
  unit: string;
}) {
  const t = useTranslations("terminal");
  const b = computeBenchmarkBand(thresholds, direction, value);
  if (!b) return null;

  return (
    <section
      data-testid="benchmark-band"
      className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2.5"
    >
      <h4 className="text-[10px] font-mono uppercase tracking-wider text-gray-400 mb-2">
        {t("benchmarkBand.title")}
      </h4>

      {/* Colored zone track + current-value marker. */}
      <div className="relative h-2.5 rounded-full overflow-hidden bg-white/5">
        {b.zones.map((z) => (
          <div
            key={z.status}
            className={`absolute inset-y-0 ${ZONE_BG[z.status]}`}
            style={{ left: `${z.fromPct}%`, width: `${Math.max(0, z.toPct - z.fromPct)}%` }}
          />
        ))}
        <div
          className="absolute -inset-y-1 w-[3px] rounded bg-white shadow"
          style={{ left: `calc(${b.valuePct}% - 1.5px)` }}
          data-testid="benchmark-marker"
          aria-hidden="true"
        />
      </div>

      {/* Floor / target boundary labels at their track positions. */}
      <div className="relative h-4 mt-1 text-[9px] text-gray-500">
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${b.floorPct}%` }}>
          {t("benchmarkBand.floor")} {fmt(b.floor)}
        </span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${b.targetPct}%` }}>
          {t("benchmarkBand.target")} {fmt(b.target)}
        </span>
      </div>

      {/* Current value + plain verdict. */}
      <p className="text-[11px] text-gray-300 mt-1">
        {t("benchmarkBand.current")}{" "}
        <b className={`tabular-nums ${STATUS_TEXT[b.valueStatus]}`} data-testid="benchmark-current">
          {fmt(value)} {unit}
        </b>{" "}
        — {t(`benchmarkBand.verdict.${b.valueStatus}` as never)}
      </p>
      <p className="text-[9px] text-gray-600 mt-0.5">{t("benchmarkBand.note")}</p>
    </section>
  );
}
