"use client";
/**
 * Phase 7.J — Risk Terminal Concentration panel.
 *
 * Reads `/api/counterparties?companyId=<active>` and renders:
 *   - HHI score per role with color (green ≤0.15 / amber ≤0.25 / red >0.25)
 *   - Top-10 customers table (name + %, contract expiry, payment terms,
 *     notes)
 *   - Top-10 suppliers table (single-source flagged)
 *
 * Single source of truth for the Counterparty register. Edits happen
 * via the admin form (Phase 7.J — separate); this panel is read-only.
 */
import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useTerminalStore } from "../store/terminalStore";
import { useCompanies } from "../hooks/use-companies";

interface CounterpartyRow {
  id: string;
  companyId: string;
  role: "customer" | "supplier";
  name: string;
  sharePct: number;
  annualAmount: number | null;
  contractExpiry: string | null;
  paymentTermsDays: number | null;
  singleSource: boolean;
  notes: string | null;
  period: string;
}

interface CounterpartyResponse {
  period: string;
  companyId: string | null;
  counterparties: CounterpartyRow[];
  summary: {
    customerCount: number;
    supplierCount: number;
    singleSourceSuppliers: number;
    customerHhi: number;
    supplierHhi: number;
  };
}

function hhiColor(hhi: number, customerScale: boolean): string {
  // Customer thresholds: green ≤0.15 / amber ≤0.25 / red >0.25.
  // Supplier thresholds (more tolerant since suppliers often concentrated):
  //   green ≤0.20 / amber ≤0.35 / red >0.35.
  const greenMax = customerScale ? 0.15 : 0.2;
  const amberMax = customerScale ? 0.25 : 0.35;
  if (hhi <= greenMax) return "text-emerald-600 dark:text-emerald-400";
  if (hhi <= amberMax) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

interface CompanyNode {
  id: string;
  code: string;
  name?: string;
  children?: CompanyNode[];
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

export function ConcentrationPanel() {
  const t = useTranslations("terminal");
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const { companies } = useCompanies();
  const activeCompany = useMemo(() => {
    if (!activeCompanyCode || !companies) return null;
    return flatten(companies as CompanyNode[]).find(
      (c) => c.code === activeCompanyCode,
    ) ?? null;
  }, [activeCompanyCode, companies]);
  const companyId = activeCompany?.id;
  const [data, setData] = useState<CounterpartyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/counterparties?companyId=${encodeURIComponent(companyId)}`)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((json: CounterpartyResponse) => {
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
  }, [companyId]);

  if (!activeCompany) {
    return (
      <div className="text-muted-foreground text-sm p-4">
        {t("concentration.pickCompanyPrompt")}
      </div>
    );
  }
  if (loading) return <div className="text-muted-foreground text-sm p-4">{t("concentration.loading")}</div>;
  if (error) return <div className="text-destructive text-sm p-4">{t("concentration.failedToLoad", { error })}</div>;
  if (!data) return null;

  const customers = data.counterparties.filter((r) => r.role === "customer");
  const suppliers = data.counterparties.filter((r) => r.role === "supplier");

  return (
    <div className="space-y-4 text-sm">
      <header className="border-b border-border pb-2">
        <h2 className="text-base font-semibold">
          {t("concentration.heading", { code: activeCompany.code })}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("concentration.summaryLine", {
            period: data.period,
            customers: customers.length,
            suppliers: suppliers.length,
          })}
          {data.summary.singleSourceSuppliers > 0 && (
            <> · <span className="text-red-600 dark:text-red-400 font-semibold">{t("concentration.singleSourceCount", { count: data.summary.singleSourceSuppliers })}</span></>
          )}
        </p>
      </header>

      {/* HHI summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("concentration.customerHhi")}</p>
          <p className={`text-2xl font-mono font-bold ${hhiColor(data.summary.customerHhi, true)}`}>
            {data.summary.customerHhi.toFixed(3)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {data.summary.customerHhi > 0.25 ? t("concentration.customerHhiHigh") : data.summary.customerHhi > 0.15 ? t("concentration.customerHhiModerate") : t("concentration.customerHhiCompetitive")}
          </p>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("concentration.supplierHhi")}</p>
          <p className={`text-2xl font-mono font-bold ${hhiColor(data.summary.supplierHhi, false)}`}>
            {data.summary.supplierHhi.toFixed(3)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {data.summary.supplierHhi > 0.35 ? t("concentration.supplierHhiHigh") : data.summary.supplierHhi > 0.2 ? t("concentration.supplierHhiModerate") : t("concentration.supplierHhiDiversified")}
          </p>
        </div>
      </div>

      {/* Customer table */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("concentration.topCustomers")}</h3>
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">{t("concentration.colCustomer")}</th>
                <th className="text-right px-2 py-1.5 font-medium w-16">%</th>
                <th className="text-left px-2 py-1.5 font-medium w-24">{t("concentration.colContract")}</th>
                <th className="text-right px-2 py-1.5 font-medium w-12">{t("concentration.colNetDays")}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t("concentration.colNotes")}</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-border/60">
                  <td className="px-2 py-1.5 font-medium">{c.name}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{c.sharePct.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{c.contractExpiry ? new Date(c.contractExpiry).toISOString().slice(0, 10) : t("concentration.contractOpen")}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{c.paymentTermsDays ?? "—"}</td>
                  <td className="px-2 py-1.5 text-muted-foreground text-[11px]">{c.notes}</td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">{t("concentration.noCustomers")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Supplier table */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("concentration.topSuppliers")}</h3>
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">{t("concentration.colSupplier")}</th>
                <th className="text-right px-2 py-1.5 font-medium w-16">%</th>
                <th className="text-left px-2 py-1.5 font-medium w-20">{t("concentration.colSource")}</th>
                <th className="text-right px-2 py-1.5 font-medium w-12">{t("concentration.colNetDays")}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t("concentration.colNotes")}</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <td className="px-2 py-1.5 font-medium">{s.name}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{s.sharePct.toFixed(1)}</td>
                  <td className="px-2 py-1.5">
                    {s.singleSource ? (
                      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                        <span aria-hidden="true">⚠</span> {t("concentration.sourceSingle")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t("concentration.sourceMulti")}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{s.paymentTermsDays ?? "—"}</td>
                  <td className="px-2 py-1.5 text-muted-foreground text-[11px]">{s.notes}</td>
                </tr>
              ))}
              {suppliers.length === 0 && (
                <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">{t("concentration.noSuppliers")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
