"use client";

/**
 * 2026-05-27 — Client component for /admin/indicator-backlog.
 *
 * 4 sections:
 *   1. Summary cards — total entities / applicable / present / missing /
 *      overall readiness %
 *   2. By-owner aggregate — «Risk Officer owes 5 items across 3 entities»
 *   3. Filter bar — entity / category / owner-role / hide-zero
 *   4. Per-entity expandable rows with item-level table
 *
 * Per-row actions:
 *   - «Upload file» → deep-link /admin/ai-import (system knows what
 *     dataType is expected)
 *   - «Email owner» → mailto: with pre-filled body listing missing items
 *
 * Per-entity actions:
 *   - «CSV export» — gap list for this entity
 *   - «Email all owners» — bulk mailto: grouped by owner
 *
 * Design: follows Companies Readiness conventions (hairline borders,
 * semantic colors, expand affordance). No card-in-card.
 */

import { useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Mail,
  Upload,
  Download,
  Filter,
  X,
  CheckCircle2,
  AlertCircle,
  Users,
  ListChecks,
} from "lucide-react";
import { groupByOwner } from "@/lib/onboarding/indicator-owner-map";
import type {
  CompanyBacklog,
  BacklogSummary,
  BacklogItem,
} from "@/lib/risk/indicator-backlog";

interface Props {
  companies: CompanyBacklog[];
  summary: BacklogSummary;
}

type CategoryFilter = "all" | string;
type OwnerFilter = "all" | string;

export function IndicatorBacklogView({ companies, summary }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [hideZero, setHideZero] = useState(true);

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
      .filter((co) => !hideZero || co.items.length > 0);
  }, [companies, categoryFilter, ownerFilter, hideZero]);

  const toggleExpand = (code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const expandAll = () => {
    setExpanded(new Set(filteredCompanies.map((c) => c.companyCode)));
  };
  const collapseAll = () => setExpanded(new Set());

  const hasFilters =
    categoryFilter !== "all" || ownerFilter !== "all" || !hideZero;

  return (
    <div className="space-y-6">
      {/* ─── Summary cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard
          icon={ListChecks}
          label="Entities"
          value={summary.totalEntities}
          tone="neutral"
        />
        <SummaryCard
          icon={ListChecks}
          label="Applicable indicators"
          value={summary.totalApplicable}
          tone="neutral"
        />
        <SummaryCard
          icon={CheckCircle2}
          label="With data"
          value={summary.totalPresent}
          tone="emerald"
        />
        <SummaryCard
          icon={AlertCircle}
          label="Missing"
          value={summary.totalMissing}
          tone={summary.totalMissing > 0 ? "rose" : "emerald"}
        />
        <SummaryCard
          icon={CheckCircle2}
          label="Overall readiness"
          value={`${summary.overallReadinessPct}%`}
          tone={
            summary.overallReadinessPct >= 80
              ? "emerald"
              : summary.overallReadinessPct >= 50
                ? "amber"
                : "rose"
          }
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
              Group items by who provides the data — one email per owner
              instead of N pings
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.byOwnerRole.map((r) => {
              const isActive = ownerFilter === r.role;
              return (
                <button
                  key={r.role}
                  type="button"
                  onClick={() =>
                    setOwnerFilter(isActive ? "all" : r.role)
                  }
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground/90 hover:bg-accent"
                  }`}
                >
                  <span className="font-medium">{r.role}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {r.missingCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Filter bar ─── */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
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
        <label className="inline-flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
            className="rounded border-border"
          />
          Hide entities with 0 missing
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setCategoryFilter("all");
              setOwnerFilter("all");
              setHideZero(true);
            }}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
            Clear filters
          </button>
        )}
        <span className="ml-auto text-muted-foreground">
          Showing {filteredCompanies.length} entities ·{" "}
          {filteredCompanies.reduce((s, c) => s + c.items.length, 0)} items
        </span>
        <button
          type="button"
          onClick={expanded.size === filteredCompanies.length ? collapseAll : expandAll}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          {expanded.size === filteredCompanies.length ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {/* ─── Per-entity rows ─── */}
      <div className="space-y-3">
        {filteredCompanies.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
            No entities match the current filters.
          </div>
        )}
        {filteredCompanies.map((co) => (
          <EntityRow
            key={co.companyCode}
            company={co}
            isExpanded={expanded.has(co.companyCode)}
            onToggle={() => toggleExpand(co.companyCode)}
          />
        ))}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: number | string;
  tone: "neutral" | "emerald" | "amber" | "rose";
}) {
  const toneClass = {
    neutral: "text-foreground",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
  }[tone];
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-2xl tabular-nums font-semibold ${toneClass}`}
      >
        {value}
      </div>
    </div>
  );
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
        className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground max-w-[260px]"
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

function EntityRow({
  company,
  isExpanded,
  onToggle,
}: {
  company: CompanyBacklog;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const handleCsv = () => {
    const header = [
      "Indicator",
      "Category",
      "Unit",
      "Direction",
      "Required input",
      "Owner role",
      "Owner name",
      "Owner email",
      "Scope",
    ];
    const rows = company.items.map((it) => [
      it.indicatorCode,
      it.category,
      it.unit,
      it.direction,
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
    // BacklogItem already has `requiredInput` — pass items as-is.
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
      const url = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${body}`;
      drafts.push(url);
    }
    // Open first; user can copy others from clipboard
    if (drafts.length > 0 && typeof window !== "undefined") {
      window.open(drafts[0], "_blank");
      if (drafts.length > 1) {
        alert(
          `Opened email to first owner (${grouped.size} groups total). For bulk send, use «Email» button on each entity row.`,
        );
      }
    }
  };

  const readinessTone =
    company.readinessPct >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : company.readinessPct >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";

  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-accent/30 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {company.companyCode}
            </span>
            <span className="font-medium text-foreground">
              {company.companyName}
            </span>
            {company.industry && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {company.industry}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-6 shrink-0">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
              Missing
            </div>
            <div className="font-mono text-xl tabular-nums font-semibold text-rose-600 dark:text-rose-400">
              {company.items.length}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
              Of total
            </div>
            <div className="font-mono text-xl tabular-nums text-muted-foreground">
              {company.applicableCount}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
              Ready
            </div>
            <div className={`font-mono text-xl tabular-nums font-semibold ${readinessTone}`}>
              {company.readinessPct}%
            </div>
          </div>
        </div>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t border-border/40 bg-muted/10">
          {/* Entity-level actions */}
          <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-b border-border/30">
            <button
              type="button"
              onClick={handleCsv}
              className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1 text-[11px] text-foreground/90 hover:bg-accent transition-colors"
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
            <button
              type="button"
              onClick={handleEmailAll}
              className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1 text-[11px] text-foreground/90 hover:bg-accent transition-colors"
            >
              <Mail className="h-3 w-3" />
              Email all owners
            </button>
            <a
              href={`/budgeting/admin/ai-import?forEntity=${company.companyCode}`}
              className="inline-flex items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/15 transition-colors"
            >
              <Upload className="h-3 w-3" />
              Upload file
            </a>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {company.items.length} items grouped into{" "}
              {new Set(company.items.map((it) => it.owner.role)).size} owner role
              {new Set(company.items.map((it) => it.owner.role)).size > 1
                ? "s"
                : ""}
            </span>
          </div>

          {/* Items table */}
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Indicator</th>
                <th className="px-4 py-2 text-left font-medium">Category</th>
                <th className="px-4 py-2 text-left font-medium">Owner</th>
                <th className="px-4 py-2 text-left font-medium">
                  What to send
                </th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {company.items.map((item) => (
                <ItemRow
                  key={item.indicatorCode}
                  item={item}
                  companyCode={company.companyCode}
                  companyName={company.companyName}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ItemRow({
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

  const isSystemOwned = item.owner.role === "BudgetPro System";

  return (
    <tr className="border-t border-border/30 hover:bg-accent/20 transition-colors">
      <td className="px-4 py-2">
        <div className="font-mono text-[11px] text-foreground">
          {item.indicatorCode}
        </div>
        <div className="text-[10px] text-muted-foreground truncate max-w-xs">
          {item.indicatorNameEn}
        </div>
      </td>
      <td className="px-4 py-2">
        <span className="inline-flex items-center rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-foreground/80">
          {item.category}
        </span>
      </td>
      <td className="px-4 py-2 max-w-[220px]">
        <div className="text-xs text-foreground/90">{item.owner.role}</div>
        {item.owner.name && (
          <div className="text-[10px] text-muted-foreground">{item.owner.name}</div>
        )}
      </td>
      <td className="px-4 py-2 text-xs text-muted-foreground max-w-md">
        {item.owner.scope ?? `Input: ${item.requiredInput}`}
      </td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        {!isSystemOwned && (
          <button
            type="button"
            onClick={handleEmail}
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-foreground/80 hover:bg-accent transition-colors"
            title={`Email ${item.owner.role}`}
          >
            <Mail className="h-3 w-3" />
            Email
          </button>
        )}
      </td>
    </tr>
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
