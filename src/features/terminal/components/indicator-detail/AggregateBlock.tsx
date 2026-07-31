"use client";

/**
 * Panel-3 aggregate-breakdown renderer — extracted from IndicatorDetail.tsx
 * (Phase 8 D1 2026-05-29). The AggregateBlock component + its per-shape render
 * helpers (industryFactor / commodityPrice / rollup) + the formatAggValue /
 * hintForKey value formatters. AggregateBlock takes `data` + a `t(key)=>string`
 * translator as props; formatAggValue + hintForKey are also used directly by
 * IndicatorDetail's resolved-vars table, so both are exported.
 */

import React from "react";

/** Pretty-renderer for the industryFactor-resolver aggregate shape:
 *  { scopes: { scope_N: { factor, confidence } }, industry }.
 *  Used by ESG composite indicators. Returns null if shape doesn't match. */
function renderIndustryFactorAggregate(
  data: Record<string, unknown>,
  t: (k: string) => string,
): React.ReactElement | null {
  const scopes = data.scopes;
  const industry = data.industry;
  if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) return null;
  const scopeEntries = Object.entries(scopes as Record<string, unknown>);
  type ScopeEntry = { key: string; factor: number; confidence: string };
  const parsed: ScopeEntry[] = [];
  for (const [key, raw] of scopeEntries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.factor !== "number") return null;
    parsed.push({ key, factor: r.factor, confidence: String(r.confidence ?? "?") });
  }
  if (parsed.length === 0) return null;
  return (
    <div className="bg-foreground/95 dark:bg-background rounded border border-border px-2 py-1.5 space-y-1">
      {typeof industry === "string" && (
        <div className="text-[9px] text-muted-foreground uppercase font-mono mb-1">{industry}</div>
      )}
      <table className="text-[10px] tabular-nums w-full">
        <tbody>
          {parsed.map((s) => (
            <tr key={s.key}>
              <td className="text-muted-foreground pr-2 font-mono">{s.key.replace("_", " ")}</td>
              <td className="text-gray-200 text-right pr-3">{(s.factor * 100).toFixed(0)}%</td>
              <td className="text-muted-foreground text-right text-[9px] w-8">
                <span title={t("indicatorDetail.dataConfidence")}>
                  {s.confidence}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pretty-renderer for the commodityPrice-resolver aggregate shape:
 *  { alias_name: { value, samples, aggregator, sourceCode } }.
 *  Used by Phase 7.K external-feed indicators. Returns null if shape
 *  doesn't match → caller tries renderRollupAggregate then falls back
 *  to JSON. */
function renderCommodityPriceAggregate(
  data: Record<string, unknown>,
): React.ReactElement | null {
  const entries = Object.entries(data)
  if (entries.length === 0) return null
  // Validate every value matches the {value, sourceCode, ...} contract.
  type AliasEntry = {
    alias: string
    value: number
    samples: number | null
    aggregator: string | null
    sourceCode: string | null
  }
  const parsed: AliasEntry[] = []
  for (const [alias, raw] of entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
    const r = raw as Record<string, unknown>
    if (typeof r.value !== "number") return null
    if (typeof r.sourceCode !== "string") return null
    parsed.push({
      alias,
      value: r.value,
      samples: typeof r.samples === "number" ? r.samples : null,
      aggregator: typeof r.aggregator === "string" ? r.aggregator : null,
      sourceCode: r.sourceCode,
    })
  }
  return (
    <div className="space-y-1 bg-foreground/95 dark:bg-background rounded border border-border px-2 py-1.5">
      <table className="text-[10px] tabular-nums w-full">
        <tbody>
          {parsed.map((p) => (
            <tr
              key={p.alias}
              className="border-b border-border/30 last:border-b-0"
            >
              <td className="text-muted-foreground pr-2 font-mono align-top py-0.5">
                {p.alias}
              </td>
              <td
                className="text-gray-200 text-right pr-2 align-top py-0.5"
                title={p.value.toLocaleString("ru-RU")}
              >
                {Number.isFinite(p.value)
                  ? Math.abs(p.value) >= 1e6
                    ? p.value.toLocaleString("ru-RU", {
                        maximumFractionDigits: 0,
                      })
                    : p.value.toLocaleString("ru-RU", {
                        maximumFractionDigits: 4,
                      })
                  : "—"}
              </td>
              <td className="text-muted-foreground text-[9px] text-right pl-1 align-top py-0.5 w-32">
                <code className="font-mono">{p.sourceCode}</code>
                {p.aggregator && p.aggregator !== "latest" && (
                  <span className="ml-1 opacity-70">· {p.aggregator}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Pretty-renderer for the rollup-resolver aggregate shape:
 *  { sums: { INDICATOR_CODE: { sum, matched_count } }, children_count }.
 *  Returns null if shape doesn't match → caller falls back to JSON. */
function renderRollupAggregate(
  data: Record<string, unknown>,
): React.ReactElement | null {
  const sums = data.sums;
  const childrenCount = typeof data.children_count === "number" ? data.children_count : null;
  if (!sums || typeof sums !== "object" || Array.isArray(sums)) return null;
  const sumEntries = Object.entries(sums as Record<string, unknown>);
  // Validate every sum entry has the expected shape.
  type SumEntry = { code: string; sum: number; matchedCount: number };
  const parsed: SumEntry[] = [];
  for (const [code, raw] of sumEntries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.sum !== "number") return null;
    parsed.push({
      code,
      sum: r.sum,
      matchedCount:
        typeof r.matched_count === "number" ? r.matched_count : 0,
    });
  }
  if (parsed.length === 0) return null;
  return (
    <div className="space-y-1 bg-foreground/95 dark:bg-background rounded border border-border px-2 py-1.5">
      <table className="text-[10px] tabular-nums w-full">
        <tbody>
          {parsed.map((p) => (
            <tr key={p.code}>
              <td className="text-muted-foreground pr-2 font-mono">{p.code}</td>
              <td
                className="text-gray-200 text-right pr-2"
                title={p.sum.toLocaleString("ru-RU")}
              >
                {formatAggValue(p.sum, "money")}
              </td>
              <td className="text-muted-foreground text-right text-[9px] w-12">
                ({p.matchedCount})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {childrenCount != null && (
        <div className="text-muted-foreground text-[9px] pt-1 border-t border-border/40">
          children_count: <span className="text-muted-foreground">{childrenCount}</span>
        </div>
      )}
    </div>
  );
}

/** Compact magnitude formatter (K/M/B) + unit-aware suffix.
 *  Mirrors HeatMap.formatValueCompact so a finance reader sees the same
 *  "1.2M ₼" / "34.1%" / "0.62" representation across drill-down + matrix. */
export function formatAggValue(v: number, hint: "money" | "count" | "ratio" | "percent"): string {
  if (!Number.isFinite(v)) return "—";
  if (hint === "count") return String(Math.round(v));
  if (hint === "percent") return `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;
  if (hint === "ratio") {
    // Large magnitudes here are money inputs coerced to "ratio" for a
    // non-currency indicator (e.g. cogs/revenue under a %-margin indicator) —
    // show them rounded with thousands separators instead of "438874.36".
    // True small ratios (e.g. fx_revenue_share 0.42) keep two decimals.
    if (v === 0) return "0";
    if (Math.abs(v) >= 100) return Math.round(v).toLocaleString("ru-RU");
    return v.toFixed(2);
  }
  // money
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B ₼`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M ₼`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K ₼`;
  return `${v.toFixed(0)} ₼`;
}

/** Heuristic — derive a presentation hint from the key name. Used to
 *  disambiguate "line_count: 900" (integer count) vs "revenue: 28713024"
 *  (money) vs "fx_revenue_share: 0.42" (ratio).
 *
 *  Phase 8 fix: lowercase the key first — the regexes were case-sensitive,
 *  so UPPERCASE indicator-code keys (AUDIT_CLOSED_PCT, …) matched nothing and
 *  fell through to "money" (₼). Also `_pct` now → percent (was shadowed into
 *  "ratio" by the line above, leaving the percent branch dead). For a
 *  resolved variable that IS an indicator, prefer `unitToHint(ind.unit)` —
 *  the real stored unit — over this name heuristic. */
export function hintForKey(key: string): "money" | "count" | "ratio" | "percent" {
  const k = key.toLowerCase();
  if (/_count$|_n$|^count$/.test(k)) return "count";
  if (/_pct$|_percent$|^pct/.test(k)) return "percent";
  if (/_share$|_ratio$|^ratio$/.test(k)) return "ratio";
  // FX rates — small ratio-like numbers (1, 1.7, 1.85)
  if (/^fx_/.test(k)) return "ratio";
  // Default: money (revenue/cogs/opex/total_cost/imported_input_cost/etc.)
  return "money";
}

/** Map a stored `IndicatorDefinition.unit` to a `formatAggValue` hint, so a
 *  resolved variable that IS the indicator (passthrough) shows its REAL unit
 *  instead of the name-heuristic default of ₼. DB units seen: "%", "cases",
 *  "count", "index", "AZN". Unknown non-currency → "ratio" (a plain number),
 *  NEVER money — so we never invent a currency that isn't there. */
export function unitToHint(
  unit: string | null | undefined,
): "money" | "count" | "ratio" | "percent" {
  const u = (unit ?? "").trim().toLowerCase();
  if (u === "%" || u === "percent" || u === "pct") return "percent";
  if (u === "cases" || u === "count" || u === "n" || u === "items") return "count";
  if (u === "azn" || u === "₼" || u === "usd" || u === "eur" || /^[a-z]{3}$/.test(u)) return "money";
  // index / ratio / score / x / tCO2e / unknown → plain number, no currency.
  return "ratio";
}

/** Render one aggregate namespace as a clean key-value table. Falls back to
 *  raw JSON for non-flat (nested) shapes — most production aggregates today
 *  are flat numeric records (budget_line / currency_rate / operational_fact
 *  / booking) so the table path covers ~95% of cases. */
export function AggregateBlock({
  data,
  t,
}: {
  data: unknown;
  t: (k: string) => string;
}) {
  // Non-record fallback — show raw JSON for nested / non-flat payloads.
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return (
      <pre className="text-muted-foreground text-[10px] whitespace-pre-wrap break-words bg-foreground/95 dark:bg-background rounded border border-border px-1.5 py-1">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }
  const entries = Object.entries(data as Record<string, unknown>);
  // If any value is non-primitive, attempt structured rollup rendering
  // before falling back to raw JSON (Phase 7.H follow-up: rollup
  // aggregates were unreadable JSON dumps).
  const allPrimitive = entries.every(
    ([, v]) => v === null || ["number", "string", "boolean"].includes(typeof v),
  );
  if (!allPrimitive) {
    // Try specific structured renderers in priority order. The first
    // that recognizes the shape wins; raw JSON only as last resort.
    const industryView = renderIndustryFactorAggregate(
      data as Record<string, unknown>,
      t,
    );
    if (industryView) return industryView;
    const commodityView = renderCommodityPriceAggregate(
      data as Record<string, unknown>,
    );
    if (commodityView) return commodityView;
    const rollupView = renderRollupAggregate(data as Record<string, unknown>);
    if (rollupView) return rollupView;
    return (
      <pre className="text-muted-foreground text-[10px] whitespace-pre-wrap break-words bg-foreground/95 dark:bg-background rounded border border-border px-1.5 py-1">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }
  return (
    <table className="text-[10px] tabular-nums w-full bg-foreground/95 dark:bg-background rounded border border-border">
      <tbody>
        {entries.map(([k, v]) => {
          const hint = typeof v === "number" ? hintForKey(k) : "money";
          const display =
            typeof v === "number"
              ? formatAggValue(v, hint)
              : v === null
                ? "—"
                : String(v);
          return (
            <tr key={k} className="border-b border-gray-900 last:border-b-0">
              <td className="px-2 py-0.5 text-muted-foreground font-mono">{k}</td>
              <td className="px-2 py-0.5 text-gray-200 text-right">{display}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

