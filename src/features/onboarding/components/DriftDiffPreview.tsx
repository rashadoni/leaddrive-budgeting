"use client";
/**
 * Phase D follow-up — drift-diff preview using server dryRun.
 *
 * Calls POST /api/onboarding/import/staging/[id]/apply-multi?dryRun=true
 * which returns aggregated current vs incoming totals (revenue / cogs /
 * expense / gross profit) for the target company at the target plan,
 * without writing anything. Surface in the wizard between analyze + apply.
 *
 * Replaces the lightweight Phase C.5 PreImportSafetyCheck which only
 * showed current totals. Now the user sees BOTH sides of the diff +
 * percent change before pressing Apply.
 */
import React from "react";
import { Loader2, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";

interface DryRunResponse {
  dryRun: true;
  stagingId: string;
  year: number;
  planExisted: boolean;
  currentLineCount: number;
  incomingLineCount: number;
  sheetCount: { success: number; failure: number };
  totals: {
    revenue: { current: number; incoming: number; deltaPct: number };
    cogs: { current: number; incoming: number; deltaPct: number };
    expense: { current: number; incoming: number; deltaPct: number };
  };
  gross_profit: { current: number; incoming: number };
  /** Phase L7 — EBITDA computed with D&A add-back (703-11 / 721-11). */
  ebitda?: { current: number; incoming: number; deltaPct: number };
}

function formatMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function DriftDiffPreview({
  stagingId,
  file,
  companyCode,
  companyName,
  confirmed,
  onConfirmChange,
  onHasExistingDataChange,
}: {
  stagingId: string;
  file: File | null;
  companyCode: string;
  companyName: string;
  confirmed: boolean;
  onConfirmChange: (v: boolean) => void;
  /**
   * Phase L1 hard-gate — invoked when the dryRun result resolves so the
   * wizard parent can disable the Apply button until the user ticks
   * the diff-confirm checkbox. `true` = existing data present, Apply
   * needs a confirmation; `false` = fresh onboarding, Apply free to
   * proceed.
   */
  onHasExistingDataChange?: (hasExistingData: boolean) => void;
}) {
  const [data, setData] = React.useState<DryRunResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    fetch(
      `/api/onboarding/import/staging/${encodeURIComponent(stagingId)}/apply-multi?dryRun=true`,
      { method: "POST", body: form },
    )
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.text();
          setError(`HTTP ${res.status}: ${body.slice(0, 200)}`);
          return;
        }
        const body = (await res.json()) as DryRunResponse;
        if (!cancelled) {
          setData(body);
          // L1 hard-gate — tell the wizard whether Apply should require
          // user confirmation. planExisted + currentLineCount > 0 is the
          // same criterion used to render the warning panel below.
          if (onHasExistingDataChange) {
            onHasExistingDataChange(body.planExisted && body.currentLineCount > 0);
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stagingId, file]);

  if (loading) {
    return (
      <div className="rounded border border-border bg-card p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="animate-spin h-4 w-4" /> Computing diff preview…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700">
        Diff preview failed: {error}
      </div>
    );
  }
  if (!data) return null;

  const hasExistingPlan = data.planExisted && data.currentLineCount > 0;
  const tone = hasExistingPlan
    ? "border-amber-500/40 bg-amber-500/5"
    : "border-emerald-500/40 bg-emerald-500/5";

  return (
    <div className={`rounded-lg border ${tone} p-4 space-y-3`}>
      <div className="flex items-start gap-2">
        {hasExistingPlan ? (
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">
            Drift Diff Preview — {companyCode}
            {companyName && companyName !== companyCode ? ` · ${companyName}` : ""}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {hasExistingPlan
              ? `Target plan exists with ${data.currentLineCount} lines. Applying will REPLACE them with ${data.incomingLineCount} new lines.`
              : "No existing plan data — fresh onboarding. Nothing will be overwritten."}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b border-border/60">
              <th className="py-1.5 font-medium text-muted-foreground">Metric</th>
              <th className="py-1.5 font-medium text-muted-foreground text-right">Current</th>
              <th className="py-1.5 font-medium text-muted-foreground text-right" />
              <th className="py-1.5 font-medium text-muted-foreground text-right">Incoming</th>
              <th className="py-1.5 font-medium text-muted-foreground text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            <DiffRow
              label="Revenue"
              cur={data.totals.revenue.current}
              inc={data.totals.revenue.incoming}
              pct={data.totals.revenue.deltaPct}
            />
            <DiffRow
              label="COGS"
              cur={data.totals.cogs.current}
              inc={data.totals.cogs.incoming}
              pct={data.totals.cogs.deltaPct}
            />
            <DiffRow
              label="Expense"
              cur={data.totals.expense.current}
              inc={data.totals.expense.incoming}
              pct={data.totals.expense.deltaPct}
            />
            <DiffRow
              label="Gross Profit"
              cur={data.gross_profit.current}
              inc={data.gross_profit.incoming}
              bold
            />
            {data.ebitda && (
              <DiffRow
                label="EBITDA"
                cur={data.ebitda.current}
                inc={data.ebitda.incoming}
                pct={data.ebitda.deltaPct}
                bold
              />
            )}
          </tbody>
        </table>
      </div>

      {hasExistingPlan && (
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => onConfirmChange(e.target.checked)}
            className="rounded border-gray-400"
            data-testid="drift-diff-confirm"
          />
          <span>
            I reviewed the diff above and confirm I want to REPLACE current data
            with the incoming numbers.
          </span>
        </label>
      )}
    </div>
  );
}

function DiffRow({
  label,
  cur,
  inc,
  pct,
  bold,
}: {
  label: string;
  cur: number;
  inc: number;
  pct?: number;
  bold?: boolean;
}) {
  const driftColor =
    pct === undefined || Math.abs(pct) < 0.5
      ? "text-muted-foreground"
      : Math.abs(pct) > 5
        ? "text-red-600 font-semibold"
        : "text-amber-600";
  return (
    <tr className={`border-b border-border/30 ${bold ? "font-semibold" : ""}`}>
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-right font-mono tabular-nums">
        {formatMoney(cur)}
      </td>
      <td className="py-1.5 text-center text-muted-foreground">
        <ArrowRight size={12} className="inline opacity-50" />
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums">
        {formatMoney(inc)}
      </td>
      <td className={`py-1.5 text-right font-mono tabular-nums ${driftColor}`}>
        {pct === undefined ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}
      </td>
    </tr>
  );
}
