"use client";
/**
 * Phase 7.J — FX exposure dashboard widget.
 *
 * Reads `/api/analytics/fx-exposure` and renders:
 *  - Per-currency totals (revenue / cogs / expense)
 *  - Net exposure per currency with hedge-sizing hint
 *  - Forward-curve reference (latest CBAR IRP forwards for 3/6/12 mo)
 *
 * Used by CFO to size USD/EUR hedges. Same active-company convention
 * as the rest of the terminal (filters by activeCompanyCode → companyId
 * lookup via useCompanies()).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTerminalStore } from "../store/terminalStore";
import { useCompanies } from "../hooks/use-companies";

interface CompanyNode {
  id: string;
  code: string;
  name?: string;
  children?: CompanyNode[];
}

interface FxExposureResponse {
  year: number;
  companyId: string | null;
  baseCurrency: string;
  totals: Record<string, { revenue: number; cogs: number; expense: number }>;
  netExposureByCurrency: Record<string, number>;
  lineCount: number;
}

function flatten(nodes: readonly CompanyNode[]): CompanyNode[] {
  const out: CompanyNode[] = [];
  const walk = (n: CompanyNode) => {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const n of nodes) walk(n);
  return out;
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function FxExposurePanel() {
  const t = useTranslations("terminal");
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const { companies } = useCompanies();
  const activeCompany = useMemo(() => {
    if (!activeCompanyCode || !companies) return null;
    return flatten(companies as CompanyNode[]).find(
      (c) => c.code === activeCompanyCode,
    ) ?? null;
  }, [activeCompanyCode, companies]);

  const [data, setData] = useState<FxExposureResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ year: "2026" });
    if (activeCompany?.id) params.set("companyId", activeCompany.id);
    fetch(`/api/analytics/fx-exposure?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: FxExposureResponse) => {
        if (!cancelled) setData(json);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCompany?.id]);

  if (loading) return <div className="text-muted-foreground text-sm p-4">{t("fxExposure.loading")}</div>;
  if (error) return <div className="text-destructive text-sm p-4">{t("fxExposure.loadFailed", { error })}</div>;
  if (!data) return null;

  const currencies = Object.keys(data.totals).sort();
  const scopeLabel = activeCompany ? activeCompany.code : t("fxExposure.allCompanies");

  return (
    <div className="space-y-4 text-sm">
      <header className="border-b border-border pb-2">
        <h2 className="text-base font-semibold">{t("fxExposure.title", { scope: scopeLabel })}</h2>
        <p className="text-xs text-muted-foreground">
          {t("fxExposure.subtitle", { year: data.year, base: data.baseCurrency, count: data.lineCount })}
        </p>
      </header>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          {t("fxExposure.netExposureHeader")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {currencies.map((cur) => {
            const net = data.netExposureByCurrency[cur] ?? 0;
            const long = net > 0;
            return (
              <div key={cur} className="rounded-md border border-border bg-card p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{cur}</p>
                <p
                  className={`text-2xl font-mono font-bold ${
                    long ? "text-emerald-600 dark:text-emerald-400" : net < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                  }`}
                >
                  {long ? "+" : ""}
                  {fmtMoney(net)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {cur === data.baseCurrency
                    ? t("fxExposure.baseCurrency")
                    : long
                      ? t("fxExposure.longHint", { cur })
                      : net < 0
                        ? t("fxExposure.shortHint", { cur })
                        : t("fxExposure.balanced")}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          {t("fxExposure.pnlHeader")}
        </h3>
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">{t("fxExposure.colCurrency")}</th>
                <th className="text-right px-2 py-1.5 font-medium">{t("fxExposure.colRevenue")}</th>
                <th className="text-right px-2 py-1.5 font-medium">{t("fxExposure.colCogs")}</th>
                <th className="text-right px-2 py-1.5 font-medium">{t("fxExposure.colExpense")}</th>
                <th className="text-right px-2 py-1.5 font-medium">{t("fxExposure.colNet")}</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((cur) => {
                const tot = data.totals[cur];
                const net = data.netExposureByCurrency[cur] ?? 0;
                return (
                  <tr key={cur} className="border-t border-border/60">
                    <td className="px-2 py-1.5 font-medium">{cur}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(tot.revenue)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(tot.cogs)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(tot.expense)}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {net >= 0 ? "+" : ""}
                      {fmtMoney(net)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          {t("fxExposure.hedgeFootnote")}
        </p>
      </section>
    </div>
  );
}
