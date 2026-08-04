"use client";

/**
 * Phase 7.G CLI Tier 2 #6 — multi-company peer comparison.
 *
 * Opens on `terminal:open-peer` event (fired by CommandBar on
 * `<A>,<B>,<C>,... PEER GO` parse). Renders an N+1 column table:
 *   indicator | co1 value | co2 value | ... | best/worst marker
 *
 * Differs from ComparePanel (2-col fixed):
 *   - Variable column count (2-5)
 *   - Best/Worst markers per row driven by direction (▲ best, ▼ worst)
 *   - Compact value column width to fit 5 cols on standard viewport
 *
 * Modal pattern: same as ComparePanel/AuditModal — Escape closes,
 * backdrop closes, internal click stays.
 */

import React, { useEffect, useMemo, useState } from "react";
import { hasEvidencedValue } from "@/lib/risk/heatmap-matrix";
import { useTranslations, useLocale } from "next-intl";
import { useMatrix } from "../hooks/use-matrix";
import { resolveIndicatorLabel } from "../lib/resolve-indicator-label";

interface PeerEvent {
  codes: string[];
}

function formatVal(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "ratio") return v.toFixed(2);
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(abs >= 10 ? 0 : 1);
}

export function PeerPanel() {
  const t = useTranslations("terminal");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const { matrix } = useMatrix(undefined, false, { enabled: open });

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<PeerEvent>).detail;
      if (!detail?.codes || detail.codes.length < 2) return;
      setCodes(detail.codes);
      setOpen(true);
    };
    window.addEventListener("terminal:open-peer", onOpen);
    return () => window.removeEventListener("terminal:open-peer", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Build per-company × per-indicator value lookup. Filter to the
  // intersection of indicators that have at least one value across
  // selected companies (skip rows where all-N/A).
  const tableData = useMemo(() => {
    if (!matrix || codes.length === 0) return null;
    const coCodeUpper = codes.map((c) => c.toUpperCase());
    const cosByCode = new Map(matrix.companies.map((c) => [c.code.toUpperCase(), c]));
    const selectedCos = coCodeUpper.map((c) => cosByCode.get(c)).filter((c): c is NonNullable<typeof c> => !!c);
    const selectedIds = new Set(selectedCos.map((c) => c.id));

    const cellByPair = new Map<string, (typeof matrix.cells)[number]>();
    for (const c of matrix.cells) {
      if (selectedIds.has(c.companyId)) cellByPair.set(`${c.companyId}_${c.indicatorId}`, c);
    }

    const rows = matrix.indicators
      .map((ind) => {
        const cells = selectedCos.map((co) => cellByPair.get(`${co.id}_${ind.id}`));
        // 2026-08-04 audit — the guard was Number.isFinite, and an unscored
        // row's stored 0 IS finite. On a lower_better indicator (HHI, DSO,
        // opex ratio) that 0 is the minimum, so the company with no data won
        // the best-in-cohort slot in bold emerald with a ▲, and a company that
        // had actually reported a figure was pushed into the ▼ worst slot.
        // The inversion landed on the one screen whose entire purpose is
        // ranking.
        const numericValues = cells
          .map((c) => (hasEvidencedValue(c?.status, c?.value) ? c!.value : null))
          .filter((v): v is number => v !== null);
        if (numericValues.length === 0) return null;
        // Best/worst by direction
        let bestIdx = -1;
        let worstIdx = -1;
        if (numericValues.length >= 2 && ind.direction !== "band") {
          let bestV = ind.direction === "higher_better" ? -Infinity : Infinity;
          let worstV = ind.direction === "higher_better" ? Infinity : -Infinity;
          cells.forEach((c, i) => {
            if (!c || !hasEvidencedValue(c.status, c.value)) return;
            if (ind.direction === "higher_better") {
              if (c.value > bestV) { bestV = c.value; bestIdx = i; }
              if (c.value < worstV) { worstV = c.value; worstIdx = i; }
            } else {
              if (c.value < bestV) { bestV = c.value; bestIdx = i; }
              if (c.value > worstV) { worstV = c.value; worstIdx = i; }
            }
          });
        }
        return { ind, cells, bestIdx, worstIdx };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return { selectedCos, rows };
  }, [matrix, codes]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("peer.dialogAriaLabel", { codes: codes.join(", ") })}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      data-testid="peer-panel"
    >
      <div
        className="relative bg-[#0A0E27] border border-input rounded-lg shadow-2xl w-[1100px] max-w-[95vw] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between px-5 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-mono font-semibold text-cyan-300 uppercase tracking-wider">
              {t("peer.title", { count: codes.length })}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t("peer.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-gray-200 transition-colors text-xl leading-none px-1"
            aria-label={t("peer.close")}
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-auto p-3">
          {!tableData ? (
            <p className="text-[11px] text-muted-foreground text-center py-10">{t("peer.loading")}</p>
          ) : tableData.selectedCos.length < codes.length ? (
            <p className="text-[11px] text-amber-400 text-center py-2">
              {t("peer.someNotFound", { found: tableData.selectedCos.length, total: codes.length })}
            </p>
          ) : null}
          {tableData && tableData.rows.length > 0 && (
            <table className="w-full text-[10px] font-mono tabular-nums">
              <thead className="sticky top-0 bg-[#0A0E27] border-b border-border">
                <tr>
                  <th className="text-left px-2 py-1.5 text-muted-foreground uppercase">{t("peer.colIndicator")}</th>
                  {tableData.selectedCos.map((co) => (
                    <th key={co.id} className="text-right px-2 py-1.5 text-cyan-300">{co.code}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.rows.map((row) => {
                  const dir = row.ind.direction === "higher_better" ? "▲" : row.ind.direction === "lower_better" ? "▼" : "◆";
                  return (
                    <tr key={row.ind.id} className="border-b border-gray-900 hover:bg-cyan-500/5">
                      <td className="px-2 py-1 text-gray-200">
                        <span className="text-muted-foreground mr-1">{dir}</span>{row.ind.code}
                        <span className="text-muted-foreground ml-2 text-[9px]">
                          {resolveIndicatorLabel(row.ind, locale).slice(0, 30)}
                        </span>
                      </td>
                      {row.cells.map((cell, i) => {
                        if (!cell || !hasEvidencedValue(cell.status, cell.value)) {
                          return <td key={i} className="px-2 py-1 text-right text-muted-foreground/50">—</td>;
                        }
                        const isBest = i === row.bestIdx;
                        const isWorst = i === row.worstIdx;
                        const tone = isBest ? "text-emerald-400 font-bold" : isWorst ? "text-rose-400 font-bold" : "text-gray-200";
                        const marker = isBest ? "▲ " : isWorst ? "▼ " : "";
                        return (
                          <td key={i} className={`px-2 py-1 text-right ${tone}`}>
                            {marker}{formatVal(cell.value, row.ind.unit)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
