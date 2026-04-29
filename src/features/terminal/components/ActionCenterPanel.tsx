"use client";

/**
 * Tier-3 sub-28 — Action Center Panel (Bloomberg EMSX-orders equivalent
 * for the CFO use-case).
 *
 * Bloomberg's EMSX shows the buy-side trader's order lifecycle (pending
 * fills, working bids, rejected orders). Our holding-CFO equivalent is
 * a "pending review queue" of indicator cells whose state crossed a
 * threshold and now needs human attention before a decision is made.
 *
 * Data source: live `useMatrix()` cells filtered to red+amber, joined
 * with company / indicator metadata for human-readable labels. No
 * backend persistence in v1 — the queue is reconstructed from the
 * current matrix snapshot. Future v2 may add an Acknowledge action
 * (Alert table population per Phase 7.E C6 v3 🔄) so review state
 * survives across sessions.
 *
 * Click any row → `selectCompany(code)` + `setActiveIndicatorValue(id)`
 * + close modal so user lands on the offending cell with Panel 3 (drill-
 * down) auto-focused.
 *
 * Pattern: same as AlertsPanel / ScenarioPanel / ComparePanel — modal
 * overlay opens on `terminal:open-action-center` event (CommandBar `ACT
 * GO` verb). Esc / backdrop / × close. Locale-aware via next-intl.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ListChecks, X } from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";
import { useMatrix } from "../hooks/use-matrix";
import { statusColor } from "@/lib/risk/heatmap-matrix";
import type { IndicatorStatus } from "@/lib/risk/formula-engine";

/** A single row in the queue — derived from one HeatMapCell. */
interface WorkItem {
  /** Composite cell key — stable identifier for React list rendering. */
  key: string;
  /** Severity bucket — drives color + grouping. */
  severity: "red" | "amber";
  companyId: string;
  companyCode: string;
  companyName: string;
  industry: string;
  indicatorId: string;
  indicatorCode: string;
  indicatorLabel: string;
  status: IndicatorStatus;
  value: number;
  unit: string;
  /** IndicatorValue.id for jump-to-Variance-Explainer. Optional because
   *  pre-Phase-7.D cells didn't carry it; we still render the row but
   *  click action becomes selectCompany-only. */
  indicatorValueId?: string;
}

const SEVERITY_ORDER: Record<"red" | "amber", number> = {
  red: 0,
  amber: 1,
};

const SEVERITY_TONE: Record<"red" | "amber", string> = {
  red: "text-[#FF4757] border-[#FF4757]/40 bg-[#FF4757]/10",
  amber: "text-[#FFB020] border-[#FFB020]/40 bg-[#FFB020]/10",
};

export function ActionCenterPanel() {
  const t = useTranslations("terminal");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const selectCompany = useTerminalStore((s) => s.selectCompany);
  const setActiveIndicatorValue = useTerminalStore(
    (s) => s.setActiveIndicatorValue,
  );
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  const { matrix } = useMatrix();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-action-center", onOpen);
    return () =>
      window.removeEventListener("terminal:open-action-center", onOpen);
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

  /**
   * Synthesize work-item queue from matrix cells. Filters to
   * red + amber leaf cells (skips sub-group rollups — they double-count
   * the same underlying signals already represented by leaf rows). Sorts
   * red-first, then alphabetic by company code within each tier.
   */
  const items: WorkItem[] = useMemo(() => {
    if (!matrix) return [];
    const compById = new Map(
      matrix.companies.map((c) => [c.id, c] as const),
    );
    const indById = new Map(
      matrix.indicators.map((i) => [i.id, i] as const),
    );
    const out: WorkItem[] = [];
    for (const cell of matrix.cells) {
      if (cell.isSubgroupRollup) continue;
      if (cell.status !== "red" && cell.status !== "amber") continue;
      const co = compById.get(cell.companyId);
      const ind = indById.get(cell.indicatorId);
      if (!co || !ind) continue;
      // Locale-aware indicator label — matches the HeatMap column header
      // resolution chain so the same label appears in both surfaces.
      const indicatorLabel =
        (locale === "ru" && ind.nameRu) ||
        (locale === "az" && ind.nameAz) ||
        ind.nameEn ||
        ind.code;
      out.push({
        key: `${cell.companyId}:${cell.indicatorId}`,
        severity: cell.status,
        companyId: cell.companyId,
        companyCode: co.code,
        companyName: co.name,
        industry: co.industry,
        indicatorId: cell.indicatorId,
        indicatorCode: ind.code,
        indicatorLabel,
        status: cell.status,
        value: cell.value,
        unit: ind.unit,
        indicatorValueId: cell.indicatorValueId,
      });
    }
    out.sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return a.companyCode.localeCompare(b.companyCode);
    });
    return out;
  }, [matrix, locale]);

  const grouped = useMemo(() => {
    const out: Record<"red" | "amber", WorkItem[]> = { red: [], amber: [] };
    for (const it of items) out[it.severity].push(it);
    return out;
  }, [items]);

  if (!open) return null;

  const handleJump = (it: WorkItem) => {
    selectCompany(it.companyCode);
    if (it.indicatorValueId) {
      setActiveIndicatorValue(it.indicatorValueId);
      setActivePanel(3); // drill-down panel
    }
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("actionCenter.dialogAriaLabel")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-3xl max-h-[80vh] overflow-y-auto rounded-lg border border-gray-700 bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <ListChecks
              size={16}
              className="text-[#FFB020]"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("actionCenter.title", { count: items.length })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("actionCenter.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("actionCenter.closeAriaLabel")}
            className="rounded border border-gray-700 px-2 py-1 text-sm hover:bg-gray-800"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="px-6 py-4 space-y-4">
          {matrix === null ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="action-center-loading"
            >
              {t("actionCenter.matrixLoading")}
            </p>
          ) : items.length === 0 ? (
            <p
              className="text-sm text-[#00D4AA]"
              data-testid="action-center-empty"
            >
              {t("actionCenter.noWorkItems")}
            </p>
          ) : (
            (Object.keys(grouped) as Array<"red" | "amber">).map((sev) => {
              const list = grouped[sev];
              if (list.length === 0) return null;
              // Static t() calls so next-intl's typed-key inference can
              // also forward the {count} placeholder; dynamic key+values
              // doesn't type-narrow under `as never`.
              const sevHeader =
                sev === "red"
                  ? t("actionCenter.severityRed", { count: list.length })
                  : t("actionCenter.severityAmber", { count: list.length });
              return (
                <section
                  key={sev}
                  aria-label={t("actionCenter.severitySectionAriaLabel", {
                    severity: sev.toUpperCase(),
                  })}
                >
                  <h3
                    className={`text-xs font-mono uppercase tracking-wider mb-2 ${SEVERITY_TONE[sev].split(" ")[0]}`}
                  >
                    {sevHeader}
                  </h3>
                  <ul className="space-y-2">
                    {list.map((it) => (
                      <li
                        key={it.key}
                        data-testid={`action-center-row-${it.key}`}
                      >
                        <button
                          type="button"
                          onClick={() => handleJump(it)}
                          aria-label={t("actionCenter.itemAriaLabel", {
                            company: it.companyCode,
                            indicator: it.indicatorCode,
                          })}
                          title={t("actionCenter.itemReviewHint", {
                            company: it.companyCode,
                            indicator: it.indicatorCode,
                          })}
                          className={`w-full text-left rounded border px-3 py-2 transition-colors hover:bg-gray-800/40 ${SEVERITY_TONE[sev]}`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-[11px] font-semibold">
                              {it.companyCode}
                            </span>
                            <span
                              className="font-mono text-[10px] tabular-nums"
                              style={{ color: statusColor(it.status) }}
                            >
                              {t("actionCenter.currentValue")}:{" "}
                              {Number.isFinite(it.value)
                                ? it.value.toFixed(2)
                                : "—"}
                              {it.unit ? ` ${it.unit}` : ""}
                            </span>
                          </div>
                          <div className="text-[10px] opacity-70 mt-0.5">
                            {it.companyName}
                            {it.industry ? ` · ${it.industry}` : ""}
                          </div>
                          <div className="text-sm mt-1">{it.indicatorLabel}</div>
                          <div className="text-[10px] font-mono opacity-60 mt-0.5">
                            {it.indicatorCode}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
