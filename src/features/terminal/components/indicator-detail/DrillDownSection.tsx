"use client";

/**
 * Panel-3 drill-down subsystem — extracted from IndicatorDetail.tsx (Phase 8 D1
 * 2026-05-29) to shrink that component. Self-contained: its own types
 * (DrillDownLine / DrillDownData / MonthlySeries / DrillState), the
 * DrillDownSection container, the DrillDownTable, the MonthlyBars chart, and
 * the formatThousands helper. Reads only React hooks + next-intl; the parent
 * passes `ivId` + the `t` translator as props. DrillDownSection is the only
 * export — IndicatorDetail imports it back.
 */

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface DrillDownLine {
  id: string;
  accountCode: string | null;
  accountName: string | null;
  accountType: string;
  category: string;
  department: string | null;
  plannedAmount: number;
  amountBase: number;
  currencyCode: string;
  exchangeRate: number | null;
  monthIndex: number | null;
  notes: string | null;
}
interface DrillDownData {
  companyId: string;
  year: number;
  lines: DrillDownLine[];
  summary: Record<string, { count: number; total: number }>;
  truncated: boolean;
}
interface MonthlySeries {
  months: { monthIndex: number; amountBase: number; lineCount: number }[];
}
type DrillState =
  | { kind: "collapsed" }
  | { kind: "loading" }
  | { kind: "loaded"; data: DrillDownData }
  | { kind: "error"; message: string };

export function DrillDownSection({
  ivId,
  t,
}: {
  ivId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [state, setState] = useState<DrillState>({ kind: "collapsed" });

  // Reset to collapsed whenever the active cell changes — otherwise a
  // previous cell's lines briefly flash when navigating between rows.
  useEffect(() => {
    setState({ kind: "collapsed" });
  }, [ivId]);

  const expand = async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/indicators/values/${encodeURIComponent(ivId)}/drilldown`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState({
          kind: "error",
          message: body.error || `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as DrillDownData;
      setState({ kind: "loaded", data });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-0.5">
        <div className="text-muted-foreground uppercase tracking-wider text-[9px]">
          {t("indicatorDetail.drilldown.title")}
        </div>
        {state.kind === "collapsed" && (
          <button
            type="button"
            onClick={expand}
            className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-[#00E5BB] uppercase tracking-wider"
            data-testid="drilldown-expand"
          >
            {t("indicatorDetail.drilldown.show")}
          </button>
        )}
        {state.kind === "loaded" && (
          <button
            type="button"
            onClick={() => setState({ kind: "collapsed" })}
            className="text-[10px] text-muted-foreground hover:text-muted-foreground uppercase tracking-wider"
          >
            {t("indicatorDetail.drilldown.hide")}
          </button>
        )}
      </div>
      {state.kind === "loading" && (
        <p className="text-muted-foreground text-[11px]">
          {t("indicatorDetail.drilldown.loading")}
        </p>
      )}
      {state.kind === "error" && (
        <p className="text-red-600 dark:text-red-400 text-[11px]" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "loaded" && (
        <DrillDownTable data={state.data} t={t} />
      )}
    </section>
  );
}

function DrillDownTable({
  data,
  t,
}: {
  data: DrillDownData;
  t: ReturnType<typeof useTranslations>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [seriesState, setSeriesState] = useState<
    | { kind: "idle" }
    | { kind: "loading"; id: string }
    | { kind: "loaded"; id: string; data: MonthlySeries }
    | { kind: "error"; id: string; message: string }
  >({ kind: "idle" });

  if (data.lines.length === 0) {
    return (
      <p className="text-muted-foreground text-[11px]">
        {t("indicatorDetail.drilldown.empty")}
      </p>
    );
  }

  const toggle = async (line: DrillDownLine) => {
    if (expandedId === line.id) {
      setExpandedId(null);
      setSeriesState({ kind: "idle" });
      return;
    }
    setExpandedId(line.id);
    setSeriesState({ kind: "loading", id: line.id });
    const params = new URLSearchParams({
      companyId: data.companyId,
      year: String(data.year),
    });
    if (line.accountCode) params.set("accountCode", line.accountCode);
    else if (line.category) params.set("category", line.category);
    try {
      const res = await fetch(
        `/api/budget-lines/monthly-series?${params.toString()}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSeriesState({
          kind: "error",
          id: line.id,
          message: body.error || `HTTP ${res.status}`,
        });
        return;
      }
      const body = (await res.json()) as MonthlySeries;
      setSeriesState({ kind: "loaded", id: line.id, data: body });
    } catch (err) {
      setSeriesState({
        kind: "error",
        id: line.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="space-y-1.5">
      {Object.keys(data.summary).length > 0 && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-b border-border/40 pb-1">
          {Object.entries(data.summary).map(([type, info]) => (
            <span key={type}>
              <span className="text-muted-foreground uppercase">{type}</span>{" "}
              <span className="text-muted-foreground tabular-nums">
                {formatThousands(info.total)}
              </span>{" "}
              <span className="text-muted-foreground">({info.count})</span>
            </span>
          ))}
        </div>
      )}
      <table className="w-full text-[10px] tabular-nums">
        <thead>
          <tr className="text-muted-foreground uppercase text-[9px]">
            <th className="text-left font-normal py-0.5 w-3"></th>
            <th className="text-left font-normal py-0.5">
              {t("indicatorDetail.drilldown.code")}
            </th>
            <th className="text-left font-normal py-0.5">
              {t("indicatorDetail.drilldown.name")}
            </th>
            <th className="text-right font-normal py-0.5">
              {t("indicatorDetail.drilldown.amount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => {
            const isExpanded = expandedId === l.id;
            return (
              <React.Fragment key={l.id}>
                <tr
                  className="border-t border-border/30 hover:bg-muted/50/20 cursor-pointer"
                  onClick={() => toggle(l)}
                  data-testid={isExpanded ? "drilldown-row-expanded" : undefined}
                >
                  <td className="text-muted-foreground py-0.5 pr-0.5 text-center w-3">
                    {isExpanded ? "▾" : "▸"}
                  </td>
                  <td
                    className="text-muted-foreground py-0.5 pr-1 max-w-[60px] truncate"
                    // Phase 3.3 — hover reveals full code when truncated.
                    title={l.accountCode ?? undefined}
                  >
                    {l.accountCode ?? "—"}
                  </td>
                  <td
                    className="text-muted-foreground py-0.5 pr-1 truncate"
                    // Phase 3.3 — hover reveals qualified identifier so users
                    // can see "<code> — <name>" without expanding the row.
                    title={
                      l.accountName || l.category
                        ? `${l.accountCode ? `${l.accountCode} — ` : ""}${l.accountName ?? l.category ?? ""}`
                        : undefined
                    }
                  >
                    {l.accountName ?? l.category ?? "—"}
                    {l.currencyCode !== "AZN" && (
                      <span className="ml-1 text-[#FFB800]">
                        {l.currencyCode}
                      </span>
                    )}
                  </td>
                  <td className="text-gray-200 text-right py-0.5">
                    {formatThousands(l.amountBase)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-t border-border/20 bg-muted/50/10">
                    <td colSpan={4} className="py-1.5 px-2">
                      {seriesState.kind === "loading" &&
                        seriesState.id === l.id && (
                          <span className="text-muted-foreground text-[10px]">
                            {t("indicatorDetail.drilldown.loading")}
                          </span>
                        )}
                      {seriesState.kind === "error" &&
                        seriesState.id === l.id && (
                          <span
                            className="text-red-600 dark:text-red-400 text-[10px]"
                            role="alert"
                          >
                            {seriesState.message}
                          </span>
                        )}
                      {seriesState.kind === "loaded" &&
                        seriesState.id === l.id && (
                          <MonthlyBars
                            data={seriesState.data}
                            t={t}
                          />
                        )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {data.truncated && (
        <p className="text-[#FFB800] text-[10px]">
          {t("indicatorDetail.drilldown.truncated")}
        </p>
      )}
    </div>
  );
}

function MonthlyBars({
  data,
  t,
}: {
  data: MonthlySeries;
  t: ReturnType<typeof useTranslations>;
}) {
  const amounts = data.months.map((m) => m.amountBase);
  const maxAbs = Math.max(1, ...amounts.map((a) => Math.abs(a)));
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground uppercase tracking-wider text-[8px]">
        {t("indicatorDetail.drilldown.monthlySeries")}
      </div>
      <div className="flex items-end gap-1 h-10">
        {data.months.map((m) => {
          const heightPct = (Math.abs(m.amountBase) / maxAbs) * 100;
          const isPositive = m.amountBase >= 0;
          return (
            <div
              key={m.monthIndex}
              className="flex-1 flex flex-col items-center gap-0.5"
              title={`M${m.monthIndex + 1}: ${formatThousands(m.amountBase)} (${m.lineCount} ${t("indicatorDetail.drilldown.lines")})`}
            >
              <div className="w-full h-8 flex items-end justify-center">
                <div
                  className={`w-full ${isPositive ? "bg-emerald-500/60" : "bg-red-500/60"} rounded-sm`}
                  style={{ height: `${Math.max(2, heightPct)}%` }}
                />
              </div>
              <span className="text-muted-foreground text-[8px]">
                M{m.monthIndex + 1}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-[9px] text-muted-foreground pt-1 border-t border-border/40">
        {data.months.map((m) => (
          <span key={m.monthIndex} className="flex-1 text-center">
            {formatThousands(m.amountBase)}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatThousands(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toFixed(0);
}
