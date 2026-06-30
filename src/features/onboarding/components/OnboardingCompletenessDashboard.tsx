"use client";
/**
 * Financial-truth-infra Phase C.3 — onboarding completeness dashboard.
 *
 * Lives at `/budgeting/admin/onboarding`. Lists every company in the org
 * with its current completeness % (P&L / Sales / Balance Sheet / Cash
 * Flow / ESG / industry KPI baseline). Re-derives state on every render
 * via /api/companies/[id]/onboarding — no persisted state, no stale
 * snapshots; even after a fresh xlsx import the next click on "Re-check"
 * reflects the new state.
 *
 * Per-company drill-down shows each section (§1 CoA … §R.industry) with
 * a colored chip + hint copy ("Import Sales Budget xlsx", etc.). Click
 * "Send report to client" → copies a markdown summary to clipboard the
 * user can paste into email.
 */
import React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, CheckCircle2, Circle, AlertTriangle, MinusCircle, ClipboardCopy } from "lucide-react";
import { useIndustryLabel } from "@/lib/industries/label";

type SectionStatus = "missing" | "partial" | "complete" | "n_a";

interface SectionResult {
  code: string;
  label: string;
  status: SectionStatus;
  rowCount: number;
  hint: string;
  blocking: boolean;
}

interface CompletenessReport {
  companyId: string;
  companyCode: string;
  companyIndustry: string | null;
  period: string;
  percentComplete: number;
  overall: "verified" | "partial" | "pending";
  sections: SectionResult[];
  generatedAt: string;
}

interface CompanyRow {
  id: string;
  code: string;
  name: string;
  industry: string | null;
  level: number;
  parentCompanyId: string | null;
  children?: CompanyRow[];
}

const OVERALL_COLOR: Record<CompletenessReport["overall"], string> = {
  verified: "text-emerald-600 dark:text-emerald-400",
  partial: "text-amber-600 dark:text-amber-400",
  pending: "text-gray-500 dark:text-gray-400",
};

const STATUS_PILL_COLOR: Record<SectionStatus, string> = {
  complete: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  partial: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  missing: "bg-red-500/10 text-red-600 border-red-500/30",
  n_a: "bg-gray-500/10 text-gray-500 border-gray-500/30",
};

const STATUS_ICON: Record<SectionStatus, React.ReactNode> = {
  complete: <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />,
  partial: <AlertTriangle size={14} className="text-amber-600 shrink-0" />,
  missing: <Circle size={14} className="text-red-600 shrink-0" />,
  n_a: <MinusCircle size={14} className="text-gray-500 shrink-0" />,
};

function flattenCompanies(roots: CompanyRow[]): CompanyRow[] {
  const out: CompanyRow[] = [];
  const walk = (n: CompanyRow) => {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

export function OnboardingCompletenessDashboard() {
  const t = useTranslations("onboardingDashboard");
  const { data: companies, isLoading: companiesLoading } = useQuery({
    queryKey: ["onboarding-companies"],
    queryFn: async () => {
      const res = await fetch("/api/companies");
      const body = await res.json();
      const tree: CompanyRow[] = body?.data || body;
      return flattenCompanies(tree).filter((c) => c.level >= 1);
    },
  });

  if (companiesLoading || !companies) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="animate-spin h-4 w-4" /> {t("loadingCompanies")}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <header>
        <h1 className="text-2xl font-bold mb-1">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t.rich("description", {
            code: (chunks) => (
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{chunks}</code>
            ),
          })}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {companies.map((c) => (
          <CompanyCompletenessCard key={c.id} company={c} />
        ))}
      </div>
    </div>
  );
}

function CompanyCompletenessCard({ company }: { company: CompanyRow }) {
  const t = useTranslations("onboardingDashboard");
  const industryLabel = useIndustryLabel();
  const [expanded, setExpanded] = React.useState(false);
  const { data, isLoading, refetch, isFetching } = useQuery<CompletenessReport>({
    queryKey: ["onboarding", company.id],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${company.id}/onboarding?period=2026`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const copyReport = () => {
    if (!data) return;
    const md = formatReportAsMarkdown(company, data);
    navigator.clipboard?.writeText(md);
  };

  return (
    <div className="border rounded-lg bg-card text-card-foreground shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        // Phase 3.3 hover pattern — full identifier on hover when name truncates.
        title={`${company.code} — ${company.name}${company.industry ? ` · ${industryLabel(company.industry)}` : ""}`}
        className="w-full p-4 flex items-start justify-between gap-3 text-left hover:bg-accent/30 transition-colors rounded-t-lg"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
            <span className="font-mono">{company.code}</span>
            {company.industry && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-muted normal-case">
                {industryLabel(company.industry)}
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-border/60">
              {t("level", { n: company.level })}
            </span>
          </div>
          <div className="text-sm font-semibold mt-0.5 truncate">{company.name}</div>
        </div>
        <CompletenessGauge report={data} loading={isLoading} />
      </button>

      {expanded && (
        <div className="border-t border-border/60 p-4 space-y-2">
          {isLoading && (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="animate-spin h-3 w-3" /> {t("computing")}
            </div>
          )}
          {data && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground">
                  {t("generated", {
                    when: new Date(data.generatedAt).toLocaleString(),
                  })}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyReport();
                    }}
                    title={t("copyHint")}
                    className="text-[10px] px-2 py-1 rounded border border-border/60 hover:bg-accent flex items-center gap-1"
                  >
                    <ClipboardCopy size={11} /> {t("copyButton")}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      refetch();
                    }}
                    disabled={isFetching}
                    title={t("recheckHint")}
                    className="text-[10px] px-2 py-1 rounded border border-border/60 hover:bg-accent flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} />
                    {t("recheckButton")}
                  </button>
                </div>
              </div>
              <ul className="space-y-1.5">
                {data.sections.map((s) => (
                  <SectionRow key={s.code} section={s} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CompletenessGauge({
  report,
  loading,
}: {
  report?: CompletenessReport;
  loading: boolean;
}) {
  const t = useTranslations("onboardingDashboard");
  if (loading || !report) {
    return (
      <div className="shrink-0 w-20 text-right text-xs text-muted-foreground">
        <Loader2 className="animate-spin h-4 w-4 ml-auto" />
      </div>
    );
  }
  const pct = report.percentComplete;
  return (
    <div className="shrink-0 w-24 text-right">
      <div className={`text-xl font-bold ${OVERALL_COLOR[report.overall]}`}>
        {pct}%
      </div>
      <div className={`text-[10px] uppercase tracking-wider ${OVERALL_COLOR[report.overall]}`}>
        {t(`overall.${report.overall}`)}
      </div>
    </div>
  );
}

function SectionRow({ section }: { section: SectionResult }) {
  const t = useTranslations("onboardingDashboard");
  return (
    <li className="flex items-start gap-2 text-xs">
      {STATUS_ICON[section.status]}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-muted-foreground shrink-0">{section.code}</span>
          <span
            className="font-medium truncate"
            title={`${section.code} — ${section.label}`}
          >
            {section.label}
          </span>
          <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_PILL_COLOR[section.status]}`}>
            {t(`status.${section.status}`)}
          </span>
          {section.rowCount > 0 && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {t("rowsCount", { n: section.rowCount.toLocaleString() })}
            </span>
          )}
        </div>
        {section.hint && section.status !== "complete" && (
          <div className="text-[10px] text-muted-foreground leading-snug mt-0.5">
            → {section.hint}
          </div>
        )}
      </div>
    </li>
  );
}

function formatReportAsMarkdown(co: CompanyRow, r: CompletenessReport): string {
  const lines: string[] = [];
  lines.push(`# ${co.code} — ${co.name}`);
  lines.push(`Industry: ${co.industry ?? "(not set)"} · Level: ${co.level} · Period: ${r.period}`);
  lines.push("");
  lines.push(`**Completeness: ${r.percentComplete}% · ${r.overall.toUpperCase()}**`);
  lines.push("");
  lines.push("| Code | Section | Status | Rows | Hint |");
  lines.push("|---|---|---|---:|---|");
  for (const s of r.sections) {
    const status =
      s.status === "complete"
        ? "✅"
        : s.status === "partial"
          ? "🟡"
          : s.status === "missing"
            ? "🔴"
            : "—";
    lines.push(
      `| ${s.code} | ${s.label} | ${status} ${s.status} | ${s.rowCount.toLocaleString()} | ${s.hint || ""} |`,
    );
  }
  lines.push("");
  lines.push(`_Generated ${new Date(r.generatedAt).toISOString()}_`);
  return lines.join("\n");
}
