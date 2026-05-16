"use client";
/**
 * Phase C.5 — pre-import safety check.
 *
 * Lives between the AI-mapper "analyzed" step and the final Apply button.
 * Fetches the SELECTED company's CURRENT plan totals (Revenue / COGS /
 * Gross Profit / EBITDA) and shows them before commit. This catches the
 * most damaging onboarding failure mode — uploading the wrong file or
 * picking the wrong target company — before the import overwrites
 * months of correct data.
 *
 * NOTE: this is not a full row-by-row drift diff (idea #4 from the
 * brainstorm). That requires server-side dry-run apply, which is the
 * follow-up. The MVP here lets the user EYEBALL whether the existing
 * totals match what they expect for the target company, plus an
 * explicit confirm checkbox before Apply.
 */
import React from "react";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

interface PnlResponse {
  year?: number;
  rows?: Array<{ accountType: string; total: number }>;
  monthlyRevenue?: Record<string, number>;
  monthlyCogs?: Record<string, number>;
}

function formatMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function PreImportSafetyCheck({
  companyId,
  companyCode,
  companyName,
  confirmed,
  onConfirmChange,
}: {
  companyId: string;
  companyCode: string;
  companyName: string;
  confirmed: boolean;
  onConfirmChange: (v: boolean) => void;
}) {
  // Discover the most recent plan that owns BudgetLines for this company,
  // then pull its P&L totals. If the company has no plan yet → "fresh
  // onboarding" branch below skips the warning.
  //
  // NOTE: hand-rolled fetch (not useQuery) so the component can mount
  // inside existing wizard tests that don't wrap the tree in
  // QueryClientProvider. Side-effect cleanup via the `cancelled` flag.
  const [data, setData] = React.useState<PnlResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  React.useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setData(null);
    (async () => {
      try {
        const plansRes = await fetch("/api/budgeting/plans");
        if (!plansRes.ok) return;
        const plansBody = await plansRes.json();
        const plans: Array<{ id: string }> = plansBody?.data ?? plansBody ?? [];
        for (const p of plans) {
          if (cancelled) return;
          const cmpRes = await fetch(
            `/api/budgeting/plans/${encodeURIComponent(p.id)}/companies`,
          );
          if (!cmpRes.ok) continue;
          const cmpBody = await cmpRes.json();
          const ids: string[] = cmpBody?.companyIds ?? [];
          if (ids.includes(companyId)) {
            const pnlRes = await fetch(
              `/api/budgeting/pnl?planId=${encodeURIComponent(p.id)}&companyId=${encodeURIComponent(companyId)}`,
            );
            if (!pnlRes.ok) continue;
            const pnl = (await pnlRes.json()) as PnlResponse;
            if (!cancelled) setData(pnl);
            return;
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // Compute totals.
  let totals: { revenue: number; cogs: number; gross: number } | null = null;
  if (data?.monthlyRevenue || data?.monthlyCogs) {
    const revenue = Object.values(data.monthlyRevenue ?? {}).reduce(
      (a: number, b: unknown) => a + (Number(b) || 0),
      0,
    );
    const cogs = Math.abs(
      Object.values(data.monthlyCogs ?? {}).reduce(
        (a: number, b: unknown) => a + (Number(b) || 0),
        0,
      ),
    );
    totals = { revenue, cogs, gross: revenue - cogs };
  }
  const hasExistingData = !!totals && (totals.revenue > 0 || totals.cogs > 0);

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Pre-import safety check — {companyCode}
            {companyName && companyName !== companyCode ? ` · ${companyName}` : ""}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Applying will <strong>overwrite</strong> existing budget data for the
            company above. Verify the figures below match what you expect for the
            TARGET company before continuing.
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 pl-6">
          <Loader2 className="animate-spin h-3 w-3" /> Loading current plan totals…
        </div>
      )}

      {!isLoading && !hasExistingData && (
        <div className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 pl-6">
          <CheckCircle2 className="h-3 w-3" />
          No existing budget data for this company — fresh onboarding, nothing
          will be overwritten.
        </div>
      )}

      {!isLoading && hasExistingData && totals && (
        <div className="pl-6 space-y-2">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Metric label="Current Revenue" value={formatMoney(totals.revenue)} />
            <Metric label="Current COGS" value={`−${formatMoney(totals.cogs)}`} />
            <Metric label="Gross Profit" value={formatMoney(totals.gross)} />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => onConfirmChange(e.target.checked)}
              className="rounded border-gray-400"
              data-testid="pre-import-confirm"
            />
            <span>
              I confirm these numbers are for the correct company and I want to
              REPLACE them with the new xlsx data.
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-amber-500/30 bg-background/50 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
