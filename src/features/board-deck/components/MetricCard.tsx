/**
 * Phase 7.G Turn XLIX (Board Deck v2 Turn 3) — supporting metric card.
 *
 * Three of these sit beside the trend chart, one each for: red-cell
 * count, sub-cos in red band, indicators-tracked count. Each card is
 * a single big number + a label + an optional delta line.
 *
 * Apple/Stripe minimalism — calm, restrained. No mini-sparklines on
 * the cards (the trend chart owns the visual story); the cards exist
 * to give the reader 3 supporting numbers without the table-dump.
 *
 * Pure presentational component — no data fetching, no state. Caller
 * passes resolved values.
 */

import type { ReactNode } from "react";

export type DeltaTone = "improving" | "worsening" | "neutral" | null;

export interface MetricCardProps {
  /** Eyebrow label above the number (small uppercase). */
  label: string;
  /** The headline value — string so caller can format ("12" / "—" /
   *  "AZN 12.4M" / etc). */
  value: string;
  /** Optional sub-line below the value. e.g. "of 7 sub-cos" or
   *  "across 14 sectors". */
  context?: string;
  /** Optional delta annotation. */
  delta?: {
    /** Display string (e.g. "+3 vs Q3", "-2 cells", "no change"). */
    label: string;
    /** Tone drives color: improving = green, worsening = red,
     *  neutral = muted. `null` skips the delta entirely. */
    tone: DeltaTone;
  };
  /** Optional accent color (e.g. tone-by-band). Drops in as a small
   *  left bar — restrained, not hero-level. */
  accent?: "red" | "amber" | "green" | null;
  /** Optional test id override. */
  testId?: string;
  /** Optional content rendered after the metric — can host an icon
   *  or microviz. Reserved for future enhancement. */
  children?: ReactNode;
}

const ACCENT_BG: Record<"red" | "amber" | "green", string> = {
  red: "bg-[#FF4757]",
  amber: "bg-[#FFB800]",
  green: "bg-[#00D4AA]",
};

const DELTA_TONE: Record<Exclude<DeltaTone, null>, string> = {
  improving: "text-[#00D4AA]",
  worsening: "text-[#FF4757]",
  neutral: "text-muted-foreground",
};

export function MetricCard({
  label,
  value,
  context,
  delta,
  accent,
  testId,
  children,
}: MetricCardProps) {
  return (
    <div
      data-testid={testId ?? "metric-card"}
      className="relative rounded-lg bg-card border border-border p-5 print:border-black print:break-inside-avoid"
    >
      {accent && (
        <span
          aria-hidden="true"
          className={`absolute left-0 top-4 bottom-4 w-1 rounded-r ${ACCENT_BG[accent]}`}
        />
      )}
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
        {label}
      </p>
      <p
        data-testid={`${testId ?? "metric-card"}-value`}
        className="text-4xl md:text-5xl font-light font-mono tabular-nums leading-none text-foreground"
      >
        {value}
      </p>
      {context && (
        <p className="mt-2 text-xs text-muted-foreground">{context}</p>
      )}
      {delta && delta.tone !== null && (
        <p
          data-testid={`${testId ?? "metric-card"}-delta`}
          className={`mt-3 text-xs font-mono ${DELTA_TONE[delta.tone]}`}
        >
          {delta.label}
        </p>
      )}
      {children}
    </div>
  );
}
