"use client";

/**
 * Phase 7.H Feature 2 — Sector Movers section in Today's Brief.
 *
 * Renders top-5 indicator movements grouped by sector, each with a
 * mini sparkline + delta% colored by direction. Click → drill-down.
 */

import { useTranslations } from "next-intl";
import { Sparkline } from "./Sparkline";
import { groupBySector, type MoverRow } from "@/lib/risk/movers";

interface Props {
  movers: MoverRow[];
  onOpen: (companyCode: string, ivId?: string) => void;
}

/** Format an absolute indicator value compactly (no sign). */
function fmtAbs(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return v.toFixed(1)
}

export function MoversSection({ movers, onOpen }: Props) {
  const t = useTranslations("terminal");
  if (movers.length === 0) {
    return (
      <section data-testid="today-brief-movers">
        <div className="text-[#FFB800] text-[10px] uppercase tracking-wider mb-1">
          ↕ {t("todayBrief.moversTitle")}
        </div>
        <p className="text-gray-700 text-[10px]">{t("todayBrief.empty")}</p>
      </section>
    );
  }

  const grouped = groupBySector(movers);
  const sectors = Array.from(grouped.keys());

  return (
    <section data-testid="today-brief-movers">
      <div className="text-[#FFB800] text-[10px] uppercase tracking-wider mb-1">
        ↕ {t("todayBrief.moversTitle")}
      </div>
      <div className="space-y-1.5">
        {sectors.map((sector) => (
          <div key={sector}>
            <div className="text-[9px] uppercase tracking-wider text-gray-600 mb-0.5">
              {sector}
            </div>
            <ul className="space-y-0.5">
              {grouped.get(sector)!.map((m) => {
                // When deltaPct ≈ −100% the sparkline has only one
                // meaningful data point (no prior year base). Show the
                // absolute first value instead of a meaningless "−100%".
                const noBase = m.deltaPct <= -99.5
                const positive = m.deltaPct > 0;
                const arrow = positive ? "▲" : "▼";
                const tone = positive ? "text-[#00D4AA]" : "text-[#FF4757]";
                return (
                  <li
                    key={`${m.companyId}-${m.indicatorId}`}
                    className="flex items-center gap-2 text-[12px] hover:bg-gray-800/30 cursor-pointer transition-colors px-1 py-0.5 rounded"
                    onClick={() => onOpen(m.companyCode, m.ivId)}
                    title={`${m.companyCode} · ${m.indicatorCode} · ${noBase ? `= ${fmtAbs(m.firstValue)}` : `${m.deltaPct.toFixed(1)}%`}`}
                  >
                    <span className="text-gray-500 font-mono w-14 truncate flex-shrink-0">
                      {m.companyCode}
                    </span>
                    <span className="text-gray-300 truncate flex-1" title={m.indicatorCode}>
                      {m.indicatorName}
                    </span>
                    <Sparkline
                      data={m.sparkline}
                      status={m.status}
                      compact
                    />
                    {noBase ? (
                      <span className="text-gray-400 tabular-nums w-14 text-right">
                        = {fmtAbs(m.firstValue)}
                      </span>
                    ) : (
                      <span className={`${tone} tabular-nums w-14 text-right`}>
                        {arrow} {positive ? "+" : ""}
                        {m.deltaPct.toFixed(1)}%
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
