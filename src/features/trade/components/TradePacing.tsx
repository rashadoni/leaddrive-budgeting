"use client";

// Phase 9.7 completion — the "day-15 picture": spend progress vs month
// elapsed, month-end run-rate forecast, risk chip. Data: budget pool
// (9.3) + spend ledger (9.6); sales actuals join with 9.5.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Gauge, RefreshCw } from "lucide-react";

interface PacingResult {
  elapsedShare: number;
  salesPlanMtd: number;
  salesAchievementPct: number | null;
  salesProgressPct: number | null;
  spendProgressPct: number | null;
  forecastSpendMonth: number | null;
  forecastBudgetVariance: number | null;
  forecastBudgetVariancePct: number | null;
  riskStatus: "ok" | "watch" | "high" | "critical";
  dataQuality: "complete" | "partial" | "empty";
  salesFeedPending?: boolean;
  math: Record<string, number | null>;
}

interface SpendCascade {
  budget: number;
  committed: number;
  accrued: number;
  actual: number;
  control: number;
  available: number;
}

const RISK_CLASSES: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  watch: "bg-sky-100 text-sky-800",
  high: "bg-amber-100 text-amber-800",
  critical: "bg-rose-100 text-rose-800",
};

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("az-AZ", { maximumFractionDigits: 0 });

export function TradePacing() {
  const t = useTranslations("trade.pacing");
  const [result, setResult] = useState<PacingResult | null>(null);
  const [cascade, setCascade] = useState<SpendCascade | null>(null);
  const [channels, setChannels] = useState<{ grainKey: string; name: string; result: PacingResult }[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trade/pacing");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setResult(data.result);
      setCascade(data.cascade ?? null);
      setChannels((data.channels ?? []) as { grainKey: string; name: string; result: PacingResult }[]);
      setAsOf(data.snapshot?.asOfDate ?? null);
      setLoaded(true);
    } catch {
      setError(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const recompute = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trade/pacing", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(String(data.error ?? res.status));
        return;
      }
      setResult(data.result);
      setCascade(data.cascade ?? null);
      await load();
      setAsOf(new Date().toISOString());
    } finally {
      setBusy(false);
    }
  }, []);

  const bar = (pct: number | null, tone: string) => (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-2 rounded-full ${tone}`}
        style={{ width: `${Math.min(Math.max(pct ?? 0, 0), 100)}%` }}
      />
    </div>
  );

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4" /> {t("title")}
          {result && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${RISK_CLASSES[result.riskStatus]}`}
            >
              {t(`risk.${result.riskStatus}`)}
            </span>
          )}
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => void recompute()}
          className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> {t("recompute")}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loaded ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : !result ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-muted-foreground">{t("monthElapsed")}</span>
                <span className="font-medium tabular-nums">
                  {Math.round(result.elapsedShare * 100)}%
                </span>
              </div>
              {bar(result.elapsedShare * 100, "bg-slate-400")}
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-muted-foreground">{t("spendProgress")}</span>
                <span className="font-medium tabular-nums">
                  {result.spendProgressPct != null ? `${result.spendProgressPct}%` : "—"}
                </span>
              </div>
              {bar(
                result.spendProgressPct,
                (result.spendProgressPct ?? 0) > result.elapsedShare * 100 ? "bg-rose-500" : "bg-emerald-500",
              )}
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-muted-foreground">{t("salesProgress")}</span>
                <span className="font-medium tabular-nums">
                  {result.math.salesActualMtd ? `${result.salesProgressPct}%` : t("awaitingFeed")}
                </span>
              </div>
              {bar(result.math.salesActualMtd ? result.salesProgressPct : 0, "bg-sky-500")}
            </div>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{t("budgetMonth")}</div>
              <div className="font-semibold tabular-nums">{fmt(result.math.budgetMonth)} AZN</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{t("controlSpendMtd")}</div>
              <div className="font-semibold tabular-nums">{fmt(result.math.controlSpendMtd)} AZN</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{t("forecastMonthEnd")}</div>
              <div className="font-semibold tabular-nums">
                {fmt(result.forecastSpendMonth)} AZN
                {result.forecastBudgetVariancePct != null && (
                  <span
                    className={`ml-2 text-xs ${result.forecastBudgetVariancePct > 0 ? "text-rose-600" : "text-emerald-600"}`}
                  >
                    {result.forecastBudgetVariancePct > 0 ? "+" : ""}
                    {result.forecastBudgetVariancePct}%
                  </span>
                )}
              </div>
            </div>
          </div>

          {cascade && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(["budget", "committed", "accrued", "actual", "available"] as const).map((k) => (
                <div key={k} className="rounded-md border p-2">
                  <div className="text-[10px] text-muted-foreground">{t(`cascade.${k}`)}</div>
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      k === "available" && cascade.available < 0 ? "text-rose-600" : ""
                    }`}
                  >
                    {fmt(cascade[k])}
                  </div>
                </div>
              ))}
            </div>
          )}

          {channels.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{t("byChannel")}</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {channels.map((c) => (
                  <div key={c.grainKey} className="rounded-md border p-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold">{c.name}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${RISK_CLASSES[c.result.riskStatus]}`}
                      >
                        {t(`risk.${c.result.riskStatus}`)}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                      <div>
                        {t("cascade.budget")}
                        <div className="text-xs font-medium tabular-nums text-foreground">
                          {fmt(c.result.math.budgetMonth)}
                        </div>
                      </div>
                      <div>
                        {t("controlShort")}
                        <div className="text-xs font-medium tabular-nums text-foreground">
                          {fmt(c.result.math.controlSpendMtd)}
                        </div>
                      </div>
                      <div>
                        {t("forecastShort")}
                        <div
                          className={`text-xs font-medium tabular-nums ${
                            (c.result.forecastBudgetVariancePct ?? 0) > 0 ? "text-rose-600" : "text-foreground"
                          }`}
                        >
                          {c.result.forecastBudgetVariancePct != null
                            ? `${c.result.forecastBudgetVariancePct > 0 ? "+" : ""}${c.result.forecastBudgetVariancePct}%`
                            : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {asOf && (
            <p className="text-[10px] text-muted-foreground">
              {t("asOf")}: {new Date(asOf).toLocaleString()} ·{" "}
              {result.salesFeedPending ? t("feedPending") : t(`quality.${result.dataQuality}`)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
