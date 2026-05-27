"use client";

/**
 * 2026-05-27 — Client component for /admin/indicator-backlog.
 *
 * Redesign brief: original version showed only «missing» items in a
 * collapsible table — user feedback «как тут понять чего не хватает?
 * а что есть?» surfaced that we hid present indicators entirely.
 *
 * This version is per-entity CARD layout with two clear sides:
 *   - LEFT (✅ green): indicators that HAVE data, with status pills
 *   - RIGHT (⏳ amber): indicators that are MISSING, with owner + actions
 *
 * Plus visual progress bar per entity, summary cards top, by-owner
 * pills, filters that don't hide-zero by default.
 */

import { useMemo, useState } from "react";
import {
  Mail,
  Upload,
  Download,
  Filter,
  X,
  CheckCircle2,
  AlertCircle,
  Users,
  ListChecks,
  Circle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { groupByOwner } from "@/lib/onboarding/indicator-owner-map";
import type {
  CompanyBacklog,
  BacklogSummary,
  BacklogItem,
  PresentItem,
} from "@/lib/risk/indicator-backlog";

interface Props {
  companies: CompanyBacklog[];
  summary: BacklogSummary;
}

type CategoryFilter = "all" | string;
type OwnerFilter = "all" | string;

export function IndicatorBacklogView({ companies, summary }: Props) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  // Show all entities by default (incl. those at 100%) — user wanted to
  // SEE the complete picture, not hide healthy entities.
  const [hideComplete, setHideComplete] = useState(false);

  const filteredCompanies = useMemo(() => {
    return companies
      .map((co) => ({
        ...co,
        items: co.items.filter((it) => {
          if (categoryFilter !== "all" && it.category !== categoryFilter)
            return false;
          if (ownerFilter !== "all" && it.owner.role !== ownerFilter)
            return false;
          return true;
        }),
      }))
      .filter((co) => !hideComplete || co.items.length > 0);
  }, [companies, categoryFilter, ownerFilter, hideComplete]);

  const hasFilters =
    categoryFilter !== "all" || ownerFilter !== "all" || hideComplete;

  return (
    <div className="space-y-6">
      {/* ─── Summary cards with visual progress ─── */}
      <div className="rounded-xl border border-border/60 bg-gradient-to-br from-card to-card/50 p-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <SummaryCell
            label="Entities"
            value={summary.totalEntities}
            sub="active sub-cos"
          />
          <SummaryCell
            label="Total indicators"
            value={summary.totalApplicable}
            sub="industry-applicable"
          />
          <SummaryCell
            label="With data"
            value={summary.totalPresent}
            sub="have values"
            tone="emerald"
            icon={CheckCircle2}
          />
          <SummaryCell
            label="Missing"
            value={summary.totalMissing}
            sub="awaiting data"
            tone="rose"
            icon={AlertCircle}
          />
          <SummaryCell
            label="Holding readiness"
            value={`${summary.overallReadinessPct}%`}
            sub={`${summary.totalPresent} of ${summary.totalApplicable}`}
            tone={readinessTone(summary.overallReadinessPct)}
          />
        </div>
        <ProgressBar
          present={summary.totalPresent}
          total={summary.totalApplicable}
          height="h-2.5"
        />
      </div>

      {/* ─── By-owner aggregate ─── */}
      {summary.byOwnerRole.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">
              By owner role
            </h3>
            <span className="text-xs text-muted-foreground ml-auto">
              Group by who provides the data — one email per owner
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.byOwnerRole.map((r) => {
              const isActive = ownerFilter === r.role;
              const isUnknown = r.role.toLowerCase().includes("unknown");
              const isSystem = r.role.toLowerCase().includes("budgetpro");
              return (
                <button
                  key={r.role}
                  type="button"
                  onClick={() =>
                    setOwnerFilter(isActive ? "all" : r.role)
                  }
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-all ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : isUnknown
                        ? "border-dashed border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                        : isSystem
                          ? "border-sky-300 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/50"
                          : "border-border bg-card text-foreground/90 hover:bg-accent"
                  }`}
                >
                  <span className="font-medium">{r.role}</span>
                  <span
                    className={`font-mono tabular-nums px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      isActive
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-foreground/10 text-foreground/80"
                    }`}
                  >
                    {r.missingCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Filter bar ─── */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          <span>Filter:</span>
        </div>
        <FilterSelect
          label="Category"
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={[
            { value: "all", label: "All categories" },
            ...summary.byCategory.map((c) => ({
              value: c.category,
              label: `${c.category} (${c.missingCount})`,
            })),
          ]}
        />
        <FilterSelect
          label="Owner"
          value={ownerFilter}
          onChange={setOwnerFilter}
          options={[
            { value: "all", label: "All owners" },
            ...summary.byOwnerRole.map((r) => ({
              value: r.role,
              label: `${r.role} (${r.missingCount})`,
            })),
          ]}
        />
        <label className="inline-flex items-center gap-1.5 text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={hideComplete}
            onChange={(e) => setHideComplete(e.target.checked)}
            className="rounded border-border"
          />
          Hide entities at 100% ready
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setCategoryFilter("all");
              setOwnerFilter("all");
              setHideComplete(false);
            }}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
            Clear all filters
          </button>
        )}
        <span className="ml-auto text-muted-foreground">
          {filteredCompanies.length} entities shown
        </span>
      </div>

      {/* ─── Per-entity cards ─── */}
      <div className="space-y-4">
        {filteredCompanies.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-card p-12 text-center text-sm text-muted-foreground">
            No entities match the current filters.
          </div>
        )}
        {filteredCompanies.map((co) => (
          <EntityCard key={co.companyCode} company={co} />
        ))}
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  sub: string;
  tone?: "emerald" | "amber" | "rose" | "neutral";
  icon?: typeof CheckCircle2;
}) {
  const valueClass = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
    neutral: "text-foreground",
  }[tone ?? "neutral"];
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className={`font-mono text-3xl tabular-nums font-bold ${valueClass}`}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</div>
    </div>
  );
}

function readinessTone(pct: number): "emerald" | "amber" | "rose" {
  if (pct >= 80) return "emerald";
  if (pct >= 50) return "amber";
  return "rose";
}

function ProgressBar({
  present,
  total,
  height = "h-2",
}: {
  present: number;
  total: number;
  height?: string;
}) {
  const pct = total > 0 ? (present / total) * 100 : 0;
  const fillClass =
    pct >= 80
      ? "bg-emerald-500"
      : pct >= 50
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <div className={`relative w-full ${height} rounded-full bg-muted overflow-hidden`}>
      <div
        className={`absolute inset-y-0 left-0 ${fillClass} transition-all duration-500 ease-out`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatusDot({ status }: { status: "green" | "amber" | "red" }) {
  const cls = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-rose-500",
  }[status];
  return <span className={`inline-block h-2 w-2 rounded-full ${cls} shrink-0`} />;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground max-w-[260px] focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EntityCard({ company }: { company: CompanyBacklog }) {
  const [expandedPresent, setExpandedPresent] = useState(false);

  const handleCsv = () => {
    const header = [
      "Indicator",
      "Category",
      "Required input",
      "Owner role",
      "Owner name",
      "Owner email",
      "Scope",
    ];
    const rows = company.items.map((it) => [
      it.indicatorCode,
      it.category,
      it.requiredInput,
      it.owner.role,
      it.owner.name ?? "",
      it.owner.email ?? "",
      it.owner.scope ?? "",
    ]);
    downloadCsv(
      `backlog-${company.companyCode}-${new Date().toISOString().slice(0, 10)}.csv`,
      [header, ...rows],
    );
  };

  const handleEmailAll = () => {
    if (company.items.length === 0) return;
    const grouped = groupByOwner(company.items);
    const drafts: string[] = [];
    for (const [, bucket] of grouped) {
      const owner = bucket.owner;
      const recipient = owner.email ?? "";
      const subject = `[${company.companyCode}] Missing data — ${bucket.items.length} indicator${bucket.items.length > 1 ? "s" : ""}`;
      const lines = [
        `Hi${owner.name ? " " + owner.name : ""},`,
        "",
        `We're onboarding ${company.companyName} (${company.companyCode}) onto BudgetPro Risk Terminal and need data you own:`,
        "",
        ...bucket.items.map(
          (it) =>
            `- ${it.indicatorCode} (${it.category}): ${it.owner.scope ?? "see system"}`,
        ),
        "",
        `Please send the file(s) when ready. Upload at ${typeof window !== "undefined" ? window.location.origin : ""}/budgeting/admin/ai-import`,
        "",
        `Thanks!`,
      ];
      const body = encodeURIComponent(lines.join("\n"));
      drafts.push(
        `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${body}`,
      );
    }
    if (drafts.length > 0 && typeof window !== "undefined") {
      window.open(drafts[0], "_blank");
      if (drafts.length > 1) {
        alert(
          `Opened email to first owner (${grouped.size} groups total).`,
        );
      }
    }
  };

  const isComplete = company.items.length === 0;
  const accentClass = isComplete
    ? "border-emerald-300 dark:border-emerald-700/60"
    : company.readinessPct >= 50
      ? "border-amber-300 dark:border-amber-700/60"
      : "border-rose-300 dark:border-rose-700/60";

  return (
    <div className={`rounded-xl border ${accentClass} bg-card overflow-hidden`}>
      {/* ─── Card header ─── */}
      <div className="px-5 py-4 border-b border-border/40 bg-gradient-to-r from-card to-muted/20">
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-mono text-[11px] text-muted-foreground">
                {company.companyCode}
              </span>
              <h3 className="text-base font-semibold text-foreground">
                {company.companyName}
              </h3>
              {company.industry && (
                <span className="inline-flex items-center rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/90">
                  {company.industry}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {company.presentCount} with data · {company.items.length} missing
              · readiness{" "}
              <span
                className={`font-semibold ${
                  company.readinessPct >= 80
                    ? "text-emerald-600 dark:text-emerald-400"
                    : company.readinessPct >= 50
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {company.readinessPct}%
              </span>
            </div>
          </div>
          {!isComplete && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCsv}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground/90 hover:bg-accent transition-colors"
                title="Export gap list as CSV"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
              <button
                type="button"
                onClick={handleEmailAll}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground/90 hover:bg-accent transition-colors"
                title="Email owners with grouped requests"
              >
                <Mail className="h-3.5 w-3.5" />
                Email owners
              </button>
              <a
                href={`/budgeting/admin/ai-import?forEntity=${company.companyCode}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload file
              </a>
            </div>
          )}
        </div>
        {/* Progress bar at bottom of header */}
        <div className="mt-3">
          <ProgressBar
            present={company.presentCount}
            total={company.applicableCount}
          />
        </div>
      </div>

      {/* ─── Two-column body: Active | Missing ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] divide-y lg:divide-y-0 lg:divide-x divide-border/40">
        {/* LEFT: Present indicators */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <h4 className="text-sm font-medium text-foreground">
                Has data
              </h4>
              <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                {company.presentItems.length}
              </span>
            </div>
            {company.presentItems.length > 12 && (
              <button
                type="button"
                onClick={() => setExpandedPresent((v) => !v)}
                className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
              >
                {expandedPresent ? "Show less" : `Show all ${company.presentItems.length}`}
                {expandedPresent ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            )}
          </div>
          {company.presentItems.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-4 text-center">
              No data yet
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(expandedPresent
                ? company.presentItems
                : company.presentItems.slice(0, 12)
              ).map((item) => (
                <PresentChip key={item.indicatorCode} item={item} />
              ))}
              {!expandedPresent && company.presentItems.length > 12 && (
                <span className="text-[11px] text-muted-foreground/70 self-center px-2">
                  +{company.presentItems.length - 12} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Missing indicators */}
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-rose-500" />
            <h4 className="text-sm font-medium text-foreground">
              Needs data
            </h4>
            <span className="font-mono text-xs text-rose-600 dark:text-rose-400 font-semibold">
              {company.items.length}
            </span>
            {company.items.length > 0 && (
              <span className="text-[11px] text-muted-foreground ml-auto">
                {new Set(company.items.map((it) => it.owner.role)).size} owner
                role{new Set(company.items.map((it) => it.owner.role)).size > 1 ? "s" : ""}
              </span>
            )}
          </div>
          {company.items.length === 0 ? (
            <div className="text-xs text-emerald-700 dark:text-emerald-300 italic py-4 text-center font-medium">
              ✓ All data present for this entity
            </div>
          ) : (
            <div className="space-y-1.5">
              {company.items.map((item) => (
                <MissingRow
                  key={item.indicatorCode}
                  item={item}
                  companyCode={company.companyCode}
                  companyName={company.companyName}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PresentChip({ item }: { item: PresentItem }) {
  const ringClass = {
    green: "ring-emerald-300 dark:ring-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200",
    amber: "ring-amber-300 dark:ring-amber-700/60 bg-amber-50/60 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200",
    red: "ring-rose-300 dark:ring-rose-700/60 bg-rose-50/60 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200",
  }[item.status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 ring-1 rounded-md px-2 py-0.5 text-[11px] font-mono ${ringClass}`}
      title={`${item.indicatorNameEn} (${item.category}, ${item.unit}) — status: ${item.status}`}
    >
      <StatusDot status={item.status} />
      {item.indicatorCode}
    </span>
  );
}

function MissingRow({
  item,
  companyCode,
  companyName,
}: {
  item: BacklogItem;
  companyCode: string;
  companyName: string;
}) {
  const handleEmail = () => {
    const subject = `[${companyCode}] Missing data — ${item.indicatorCode}`;
    const body = [
      `Hi${item.owner.name ? " " + item.owner.name : ""},`,
      "",
      `We need data for ${companyName} (${companyCode}):`,
      "",
      `Indicator: ${item.indicatorCode} (${item.indicatorNameEn})`,
      `Required: ${item.owner.scope ?? item.requiredInput}`,
      "",
      `Please send when ready. Upload at ${typeof window !== "undefined" ? window.location.origin : ""}/budgeting/admin/ai-import`,
      "",
      `Thanks!`,
    ].join("\n");
    const url = `mailto:${item.owner.email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (typeof window !== "undefined") window.open(url, "_blank");
  };

  const isSystemOwned = item.owner.role.toLowerCase().includes("budgetpro");
  const isUnknownOwner = item.owner.role.toLowerCase().includes("unknown");

  return (
    <div
      className={`group flex items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
        isUnknownOwner
          ? "border-dashed border-amber-300/60 bg-amber-50/30 dark:border-amber-800/40 dark:bg-amber-950/15"
          : "border-border/60 bg-muted/20 hover:bg-muted/40"
      }`}
    >
      <Circle className="h-2 w-2 fill-rose-500 text-rose-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[12px] font-medium text-foreground">
            {item.indicatorCode}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {item.category}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          {item.indicatorNameEn}
        </div>
      </div>
      <div className="hidden md:block min-w-0 max-w-[200px]">
        <div className="text-[11px] font-medium text-foreground/90 truncate">
          {item.owner.role}
        </div>
        {item.owner.scope && (
          <div className="text-[10px] text-muted-foreground truncate">
            {item.owner.scope}
          </div>
        )}
      </div>
      {!isSystemOwned && (
        <button
          type="button"
          onClick={handleEmail}
          className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent hover:border-primary/40 transition-colors opacity-60 group-hover:opacity-100 shrink-0"
          title={`Email ${item.owner.role}`}
        >
          <Mail className="h-3 w-3" />
          Email
        </button>
      )}
    </div>
  );
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
