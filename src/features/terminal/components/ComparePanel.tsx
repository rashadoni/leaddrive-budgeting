"use client";

/**
 * Phase B5 (Bloomberg uplift plan) — side-by-side company comparison.
 *
 * Opens on `terminal:open-compare` event (fired by `CommandBar.dispatch`
 * for the `CMP <LHS> <RHS> GO` parsed command). Fetches the matrix once
 * (or reuses the in-flight one from HeatMap if available — small dup
 * in v1, deferred to a CARRYOVER 🔄 alongside the HeatMap dup-fetch
 * concern), then renders a 3-column table:
 *   indicator | LHS value | RHS value | Δ (RHS − LHS)
 *
 * Row sort: indicator code (alpha) — predictable for finance users.
 * Δ coloring: status-tinted by direction
 *   - higher_better + Δ > 0 → green; Δ < 0 → red
 *   - lower_better + Δ < 0 → green; Δ > 0 → red
 *   - band → grey (no directional preference)
 *
 * Modal pattern matches AuditModal: Escape closes, backdrop-click
 * closes, internal panel-click does NOT close. Manager+ gating is
 * NOT applied (compare is read-only viewer of already-rendered data).
 */

import React, { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useMatrix } from "../hooks/use-matrix";
import { statusShape } from "@/lib/risk/heatmap-matrix";
import { resolveIndicatorLabel } from "../lib/resolve-indicator-label";

interface CompareEvent {
  lhs: string;
  rhs: string;
}

interface MatrixCell {
  indicatorValueId?: string;
  companyId: string;
  indicatorId: string;
  value: number;
  status: "green" | "amber" | "red" | "unknown" | "missing";
  error?: { code: string; reason: string };
}

interface MatrixCompany {
  id: string;
  code: string;
  name: string;
}

interface MatrixIndicator {
  id: string;
  code: string;
  nameEn: string;
  nameAz?: string | null;
  nameRu?: string | null;
  unit: string;
  direction: "higher_better" | "lower_better" | "band";
}

interface MatrixResponse {
  period: string;
  companies: MatrixCompany[];
  indicators: MatrixIndicator[];
  cells: MatrixCell[];
}

export function ComparePanel() {
  const t = useTranslations("terminal");
  const [open, setOpen] = useState(false);
  const [pair, setPair] = useState<CompareEvent | null>(null);
  // Sub-20: shared `useMatrix()` hook. Module cache means an open
  // ComparePanel reuses HeatMap's already-fetched matrix instead of
  // a 2nd round-trip. Lazy-fetch is preserved via `enabled` gate
  // below (matches prior `if (!open || data) return` semantics).
  const { matrix: data, loading: hookLoading, error: hookError } = useMatrix();
  // Local "enabled" view: until modal opens, treat matrix as unloaded
  // so the closed-modal render path doesn't see stale subscription
  // state. Once open, reflect the hook's actual loading/error.
  const loading = open && hookLoading;
  const error = open ? hookError : null;

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<CompareEvent>).detail;
      if (!detail?.lhs || !detail?.rhs) return;
      setPair(detail);
      setOpen(true);
    };
    window.addEventListener("terminal:open-compare", onOpen);
    return () => window.removeEventListener("terminal:open-compare", onOpen);
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

  // Sub-20: matrix-fetch effect removed — `useMatrix()` hook handles
  // the shared cache + lifecycle. The original effect was lazy
  // (`if (!open || data) return`); the hook fetches eagerly on
  // component mount, but the module cache means there's at most one
  // network call across all consumers, so the eager-fetch overhead
  // is paid by HeatMap (always mounted) and ComparePanel just reads
  // the cached result on open.

  if (!open || !pair) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("compare.dialogAriaLabel", {
        lhs: pair.lhs,
        rhs: pair.rhs,
      })}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border border-gray-700 bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-background/95 px-6 py-3 backdrop-blur">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {t("compare.headerTitle")}{" "}
              <span className="font-mono text-[#FFB020]">{pair.lhs}</span>{" "}
              {t("compare.headerVs")}{" "}
              <span className="font-mono text-[#00D4AA]">{pair.rhs}</span>
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("compare.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("compare.closeAriaLabel")}
            className="rounded border border-gray-700 px-3 py-1 text-sm hover:bg-gray-800"
          >
            {t("compare.close")}
          </button>
        </header>
        <div className="px-6 py-4">
          {loading && (
            <div className="text-sm text-muted-foreground">{t("compare.loadingMatrix")}</div>
          )}
          {error && (
            <div className="text-sm text-[#FF4757]" role="alert">
              {t("compare.error")}: {error}
            </div>
          )}
          {data && <CompareTable data={data} pair={pair} />}
        </div>
      </div>
    </div>
  );
}

function CompareTable({
  data,
  pair,
}: {
  data: MatrixResponse;
  pair: CompareEvent;
}) {
  const t = useTranslations("terminal");
  const lhsCo = data.companies.find((c) => c.code === pair.lhs);
  const rhsCo = data.companies.find((c) => c.code === pair.rhs);
  if (!lhsCo || !rhsCo) {
    return (
      <div className="text-sm text-[#FF4757]" role="alert">
        Could not resolve company codes:{" "}
        {!lhsCo && <code>{pair.lhs}</code>}
        {!lhsCo && !rhsCo && " and "}
        {!rhsCo && <code>{pair.rhs}</code>}{" "}
        not found in current matrix.
      </div>
    );
  }

  // Index cells by (companyId, indicatorId) for O(1) lookup.
  const cellMap = new Map<string, MatrixCell>();
  for (const c of data.cells) {
    cellMap.set(`${c.companyId}:${c.indicatorId}`, c);
  }

  // Filter to indicators where at least ONE of the two companies has a
  // numeric value — sector-specific indicators that don't apply to the
  // selected pair (e.g. AGRO_* for Industrial cos) would otherwise show
  // "— vs —" rows that add visual noise. Sort remaining alphabetically.
  const indicators = data.indicators
    .filter((ind) => {
      const l = cellMap.get(`${lhsCo.id}:${ind.id}`);
      const r = cellMap.get(`${rhsCo.id}:${ind.id}`);
      return (
        (l && typeof l.value === "number") ||
        (r && typeof r.value === "number")
      );
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <table className="w-full text-sm font-mono border-collapse">
      <thead>
        <tr className="border-b border-gray-800/60 text-[10px] uppercase tracking-wider text-gray-500">
          <th className="text-left px-2 py-2">{t("compare.indicatorColumn")}</th>
          <th className="text-right px-2 py-2 w-32">{lhsCo.code}</th>
          <th className="text-right px-2 py-2 w-32">{rhsCo.code}</th>
          <th className="text-right px-2 py-2 w-24">Δ</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-800/40">
        {indicators.map((ind) => {
          const lCell = cellMap.get(`${lhsCo.id}:${ind.id}`);
          const rCell = cellMap.get(`${rhsCo.id}:${ind.id}`);
          return (
            <CompareRow
              key={ind.id}
              indicator={ind}
              lhs={lCell}
              rhs={rCell}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function CompareRow({
  indicator,
  lhs,
  rhs,
}: {
  indicator: MatrixIndicator;
  lhs: MatrixCell | undefined;
  rhs: MatrixCell | undefined;
}) {
  const locale = useLocale();
  const lhsValue = lhs?.value;
  const rhsValue = rhs?.value;

  let delta: number | null = null;
  if (typeof lhsValue === "number" && typeof rhsValue === "number") {
    delta = rhsValue - lhsValue;
  }

  const deltaColor = colorForDelta(delta, indicator.direction);
  const deltaShape = shapeForDelta(delta, indicator.direction);

  return (
    <tr className="hover:bg-muted/20">
      <td className="px-2 py-1.5">
        <div className="font-semibold text-gray-200">{indicator.code}</div>
        <div className="text-[10px] text-muted-foreground">
          {resolveIndicatorLabel(indicator, locale)}
          <span className="ml-1 text-gray-700">· {indicator.unit}</span>
        </div>
      </td>
      <td
        className="text-right px-2 py-1.5 tabular-nums"
        style={{ color: statusHex(lhs?.status) }}
      >
        {/* Tier-3 sub-29 Round-20 closure — shape glyph next to the
            colored value text. Round-20 architect scanner v4 caught
            this LHS/RHS column leak that prior rounds missed. */}
        <span aria-hidden="true" className="mr-0.5 opacity-70">
          {statusShape(lhs?.status ?? "missing")}
        </span>
        {formatValue(lhsValue, indicator.unit)}
      </td>
      <td
        className="text-right px-2 py-1.5 tabular-nums"
        style={{ color: statusHex(rhs?.status) }}
      >
        <span aria-hidden="true" className="mr-0.5 opacity-70">
          {statusShape(rhs?.status ?? "missing")}
        </span>
        {formatValue(rhsValue, indicator.unit)}
      </td>
      <td
        className="text-right px-2 py-1.5 tabular-nums font-semibold"
        style={{ color: deltaColor }}
      >
        {/* Tier-3 sub-29 M7 sweep — shape glyph encodes direction in
            addition to color (●=better, ▲=worse, ◇=neutral/no-data). */}
        <span aria-hidden="true" className="mr-0.5 opacity-80">
          {deltaShape}
        </span>
        {delta === null ? "—" : formatDelta(delta, indicator.unit)}
      </td>
    </tr>
  );
}

function colorForDelta(
  delta: number | null,
  direction: MatrixIndicator["direction"],
): string {
  if (delta === null || !Number.isFinite(delta)) return "#6B7280";
  if (direction === "band") return "#9CA3AF"; // no directional preference
  if (delta === 0) return "#9CA3AF";
  const isPositive = delta > 0;
  if (direction === "higher_better") {
    return isPositive ? "#00D4AA" : "#FF4757";
  }
  // lower_better
  return isPositive ? "#FF4757" : "#00D4AA";
}

/** Tier-3 sub-29 M7 sweep — color-blind safe redundant signal for delta
 *  direction. Maps to statusShape glyphs: ●=improvement (green),
 *  ▲=regression (amber/red — pick the heavier ▲ for any negative move
 *  to draw the eye), ◇=neutral or no-data. Better-vs-worse is judged
 *  against `direction` (higher_better / lower_better / band). */
function shapeForDelta(
  delta: number | null,
  direction: MatrixIndicator["direction"],
): string {
  if (delta === null || !Number.isFinite(delta)) return "◇";
  if (direction === "band" || delta === 0) return "◇";
  const isPositive = delta > 0;
  if (direction === "higher_better") {
    return isPositive ? "●" : "▲";
  }
  // lower_better — positive delta is a regression
  return isPositive ? "▲" : "●";
}

function statusHex(status: MatrixCell["status"] | undefined): string {
  switch (status) {
    case "green":
      return "#00D4AA";
    case "amber":
      return "#FFB020";
    case "red":
      return "#FF4757";
    case "missing":
    case undefined:
      return "#6B7280";
    default:
      return "#E8EDF5";
  }
}

function formatValue(v: number | undefined, unit: string): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const rounded =
    abs >= 1000 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${rounded} ${unit}`;
}

function formatDelta(d: number, unit: string): string {
  const sign = d > 0 ? "+" : "";
  return `${sign}${formatValue(d, unit)}`;
}
