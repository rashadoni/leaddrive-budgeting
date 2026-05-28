"use client";

/**
 * Tier 2 #9 — Market ticker companion to AuditTicker.
 *
 * Horizontal strip above the audit-events strip. Pulls from
 * `/api/market/ticker` every 60s and renders each metric as
 *   USD/AZN  1.7000  ▲ +0.02
 * Color-coded delta: green up, red down, gray flat.
 *
 * Phase 8 D2 (2026-05-28) — drill-down wired: clicking any entry
 * opens the Data Sources Catalog admin page (`/budgeting/admin/data-
 * sources`) where the operator can see freshness, sample value
 * interpretation, and the upstream provider for every metric in the
 * ticker. The dedicated `/exchange-rates` page from the original
 * sketch never shipped — the Data Sources Catalog covers the same UX
 * need and is already production-quality.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

interface TickerEntry {
  metric: string;
  label: string;
  current: number;
  previous: number | null;
  unit: string;
  source: string;
}

const REFRESH_MS = 60_000;

function formatVal(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  const formatted =
    Math.abs(v) >= 1_000_000
      ? (v / 1_000_000).toFixed(2) + "M"
      : Math.abs(v) >= 1_000
        ? (v / 1_000).toFixed(2) + "K"
        : Math.abs(v) >= 10
          ? v.toFixed(2)
          : v.toFixed(4);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatDelta(curr: number, prev: number | null): { text: string; tone: string } {
  if (prev == null || prev === 0 || !Number.isFinite(curr - prev)) {
    return { text: "—", tone: "text-gray-700" };
  }
  const delta = curr - prev;
  const pct = (delta / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.005) return { text: "0.00%", tone: "text-gray-500" };
  const sign = delta > 0 ? "▲" : "▼";
  const tone = delta > 0 ? "text-[#00D4AA]" : "text-[#FF4757]";
  return { text: `${sign} ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`, tone };
}

export function MarketTicker() {
  const t = useTranslations("terminal");
  const router = useRouter();
  const [entries, setEntries] = useState<TickerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchOnce = async () => {
      try {
        const res = await fetch("/api/market/ticker", { cache: "no-store" });
        if (!res.ok) {
          if (alive) setError(`HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as { entries: TickerEntry[] };
        if (alive) {
          setEntries(body.entries);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Hide strip entirely if there's nothing to show — keeps the
  // bottom-of-terminal real-estate clean for orgs without FX data.
  if (entries != null && entries.length === 0) return null;

  return (
    <div
      role="status"
      aria-label={t("marketTicker.ariaLabel")}
      data-testid="market-ticker"
      className="flex items-center gap-3 px-3 py-1 bg-[#050814] border-t border-gray-800/60 font-mono text-[10px] text-gray-400 overflow-x-auto whitespace-nowrap shrink-0"
    >
      <span className="text-gray-700 uppercase tracking-wider shrink-0">
        {t("marketTicker.label")}
      </span>
      {error && (
        <span className="text-[#FF4757] text-[10px]" role="alert">
          {error}
        </span>
      )}
      {entries == null && !error && (
        <span className="text-gray-700">{t("marketTicker.loading")}</span>
      )}
      {entries?.map((e) => {
        const delta = formatDelta(e.current, e.previous);
        return (
          <button
            type="button"
            key={e.metric}
            onClick={() => router.push("/budgeting/admin/data-sources")}
            className="inline-flex items-baseline gap-1.5 shrink-0 hover:bg-gray-800/40 hover:text-gray-100 transition-colors px-1 -mx-1 rounded cursor-pointer"
            aria-label={t("marketTicker.entryAriaLabel", { label: e.label })}
            data-testid={`market-ticker-entry-${e.metric}`}
            title={t("marketTicker.clickHint", { source: e.source })}
          >
            <span className="text-gray-500 uppercase">{e.label}</span>
            <span className="text-gray-200 tabular-nums">
              {formatVal(e.current, e.unit)}
            </span>
            <span className={`${delta.tone} tabular-nums text-[9px]`}>
              {delta.text}
            </span>
          </button>
        );
      })}
    </div>
  );
}
