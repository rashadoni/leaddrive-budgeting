"use client";

/**
 * 2026-05-27 — Compliance Hub client UI.
 *
 * Two tabs (Audit Findings | Court Cases), per-tab summary cards,
 * filterable table, CSV export.
 *
 * Design language follows the dashboard admin pages (Companies Readiness,
 * Indicator Health): max-w-7xl container, hairline borders, sticky
 * column headers, semantic severity colors (rose=major/open, amber=minor,
 * slate=observation, emerald=completed).
 */

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Shield,
  Scale,
  AlertOctagon,
  AlertTriangle,
  Info,
  CheckCircle2,
  Download,
  Filter,
  X,
  RotateCcw,
  Loader2,
} from "lucide-react";

interface AuditFinding {
  severity: string;
  audit: string;
  status: string;
  grouping: string;
  findingStatusJan: string;
  // Phase 8 E1 — write-back overlay fields. Optional; present after
  // PATCH /api/admin/compliance/finding flips them.
  closed?: boolean;
  closedAt?: string;
  closedBy?: string;
}

interface CourtCase {
  date: string;
  court: string;
  claimant: string;
  defendant: string;
  disputeType: string;
  status: string;
  closed: boolean;
}

interface AuditData {
  summary: Record<string, number | undefined>;
  items: AuditFinding[];
  source?: string;
  importedAt?: string;
}

interface CourtData {
  summary: Record<string, number | undefined>;
  cases: CourtCase[];
  source?: string;
  importedAt?: string;
}

export interface EntityComplianceData {
  /** Phase 8 E1 — companyId needed for the per-finding write-back PATCH. */
  id: string;
  code: string;
  name: string;
  industry: string;
  auditFindings: AuditData | null;
  courtDisputes: CourtData | null;
}

interface Props {
  entities: EntityComplianceData[];
}

type Tab = "audit" | "court";
type SeverityFilter = "all" | "Major" | "Minor" | "Observation" | "OFI";
type StatusFilter = "all" | "open" | "closed";

// Severity → visual treatment
const SEVERITY_META: Record<
  string,
  { label: string; classes: string; icon: typeof AlertOctagon }
> = {
  Major: {
    label: "Major",
    classes: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/40",
    icon: AlertOctagon,
  },
  "Major NC": {
    label: "Major NC",
    classes: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/40",
    icon: AlertOctagon,
  },
  Minor: {
    label: "Minor",
    classes: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40",
    icon: AlertTriangle,
  },
  "Minor NC": {
    label: "Minor NC",
    classes: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40",
    icon: AlertTriangle,
  },
  Observation: {
    label: "Observation",
    classes: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700",
    icon: Info,
  },
  OFI: {
    label: "OFI",
    classes: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/40",
    icon: Info,
  },
};

function SeverityChip({ severity }: { severity: string }) {
  const meta = SEVERITY_META[severity] ?? {
    label: severity,
    classes: "bg-muted text-muted-foreground border-border",
    icon: Info,
  };
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.classes}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function StatusBadge({ closed }: { closed: boolean }) {
  const t = useTranslations("adminCompliance");
  if (closed) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        {t("statusClosed")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-rose-700 dark:text-rose-300">
      <AlertTriangle className="h-3 w-3" />
      {t("statusOpen")}
    </span>
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

export function ComplianceHub({ entities }: Props) {
  const t = useTranslations("adminCompliance");
  const [tab, setTab] = useState<Tab>("audit");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Phase 8 E1 — local close-override map. Server is the source of truth
  // once PATCH succeeds; this lets the UI render optimistically while the
  // request is in flight and recover from API errors without a refresh.
  // Key shape: `${entityId}::${findingIdx}` → true(closed)/false(reopen).
  const [closedOverrides, setClosedOverrides] = useState<Record<string, boolean>>({});
  // Per-row pending state to disable the toggle + show spinner.
  const [pendingRows, setPendingRows] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * PATCH the compliance finding. Optimistic UI: flip locally first,
   * roll back if the request fails. Each pending row shows a spinner
   * and disables its button to prevent double-clicks.
   */
  const toggleClosed = useCallback(
    async (entityId: string, findingIdx: number, nextClosed: boolean) => {
      const key = `${entityId}::${findingIdx}`;
      setActionError(null);
      setClosedOverrides((m) => ({ ...m, [key]: nextClosed }));
      setPendingRows((s) => {
        const n = new Set(s);
        n.add(key);
        return n;
      });
      try {
        const res = await fetch("/api/admin/compliance/finding", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: entityId,
            findingIdx,
            action: nextClosed ? "close" : "reopen",
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          // Rollback override on failure.
          setClosedOverrides((m) => {
            const n = { ...m };
            delete n[key];
            return n;
          });
          setActionError(
            body.error ?? t("actionFailed", { status: res.status }),
          );
        }
      } catch (err) {
        setClosedOverrides((m) => {
          const n = { ...m };
          delete n[key];
          return n;
        });
        setActionError(
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        setPendingRows((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
      }
    },
    [t],
  );

  // Flatten audit findings across entities (one row per finding).
  // Phase 8 E1 — each row carries entityId + findingIdx so the
  // per-row close/reopen toggle can call the right PATCH endpoint.
  const auditRows = useMemo(() => {
    const rows: Array<{
      entityId: string;
      entityCode: string;
      entityName: string;
      findingIdx: number;
      finding: AuditFinding;
    }> = [];
    for (const e of entities) {
      if (!e.auditFindings) continue;
      e.auditFindings.items.forEach((f, idx) => {
        rows.push({
          entityId: e.id,
          entityCode: e.code,
          entityName: e.name,
          findingIdx: idx,
          finding: f,
        });
      });
    }
    return rows;
  }, [entities]);

  const courtRows = useMemo(() => {
    const rows: Array<{
      entityCode: string;
      entityName: string;
      case: CourtCase;
    }> = [];
    for (const e of entities) {
      if (!e.courtDisputes) continue;
      for (const c of e.courtDisputes.cases) {
        rows.push({ entityCode: e.code, entityName: e.name, case: c });
      }
    }
    return rows;
  }, [entities]);

  /** Phase 8 E1 — effective closed state for a row: server-stored OR
   *  the in-flight override OR the imported MNG status text match. */
  const isRowClosed = useCallback(
    (entityId: string, findingIdx: number, finding: AuditFinding) => {
      const key = `${entityId}::${findingIdx}`;
      if (key in closedOverrides) return closedOverrides[key];
      if (typeof finding.closed === "boolean") return finding.closed;
      return /yerinə yetirilib/i.test(finding.status);
    },
    [closedOverrides],
  );

  // Apply filters
  const filteredAuditRows = useMemo(() => {
    return auditRows.filter((r) => {
      if (entityFilter !== "all" && r.entityCode !== entityFilter) return false;
      if (severityFilter !== "all" && !r.finding.severity.startsWith(severityFilter))
        return false;
      if (statusFilter !== "all") {
        const isCompleted = isRowClosed(r.entityId, r.findingIdx, r.finding);
        if (statusFilter === "open" && isCompleted) return false;
        if (statusFilter === "closed" && !isCompleted) return false;
      }
      return true;
    });
  }, [auditRows, entityFilter, severityFilter, statusFilter, isRowClosed]);

  const filteredCourtRows = useMemo(() => {
    return courtRows.filter((r) => {
      if (entityFilter !== "all" && r.entityCode !== entityFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "open" && r.case.closed) return false;
        if (statusFilter === "closed" && !r.case.closed) return false;
      }
      return true;
    });
  }, [courtRows, entityFilter, statusFilter]);

  // Aggregates for summary cards
  const auditTotals = useMemo(() => {
    let total = 0,
      completed = 0,
      majorOpen = 0,
      minorOpen = 0,
      obsOpen = 0;
    for (const e of entities) {
      if (!e.auditFindings) continue;
      const s = e.auditFindings.summary;
      total += s.total ?? 0;
      completed += s.completed ?? 0;
      majorOpen += s.major_open ?? 0;
      minorOpen += s.minor_open ?? 0;
      obsOpen += s.observation_open ?? 0;
    }
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, completedPct: pct, majorOpen, minorOpen, obsOpen };
  }, [entities]);

  const courtTotals = useMemo(() => {
    let total = 0,
      open = 0,
      defendant = 0,
      plaintiff = 0,
      moneyClaims = 0;
    for (const e of entities) {
      if (!e.courtDisputes) continue;
      const s = e.courtDisputes.summary;
      total += s.total ?? 0;
      open += s.open ?? 0;
      defendant += s.as_defendant ?? 0;
      plaintiff += s.as_plaintiff ?? 0;
      moneyClaims += s.money_claims ?? 0;
    }
    return { total, open, defendant, plaintiff, moneyClaims };
  }, [entities]);

  // Distinct entity codes that have data
  const entityOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const e of entities) {
      if (e.auditFindings || e.courtDisputes) seen.add(e.code);
    }
    return [...seen].sort();
  }, [entities]);

  const handleExport = () => {
    if (tab === "audit") {
      const header = ["Entity", "Name", "Severity", "Audit", "Status", "Grouping", "Status Jan-26"];
      const rows = [header, ...filteredAuditRows.map((r) => [
        r.entityCode,
        r.entityName,
        r.finding.severity,
        r.finding.audit,
        r.finding.status,
        r.finding.grouping,
        r.finding.findingStatusJan,
      ])];
      downloadCsv(`compliance-audit-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    } else {
      const header = ["Entity", "Name", "Date", "Court", "Plaintiff", "Defendant", "Dispute Type", "Status", "Closed"];
      const rows = [header, ...filteredCourtRows.map((r) => [
        r.entityCode,
        r.entityName,
        r.case.date,
        r.case.court,
        r.case.claimant,
        r.case.defendant,
        r.case.disputeType,
        r.case.status,
        r.case.closed ? "yes" : "no",
      ])];
      downloadCsv(`compliance-court-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    }
  };

  const hasFilters = entityFilter !== "all" || severityFilter !== "all" || statusFilter !== "all";

  return (
    <div className="space-y-6">
      {/* Summary cards — tab-specific */}
      {tab === "audit" ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard icon={Shield} label={t("cardTotalFindings")} value={auditTotals.total} tone="neutral" />
          <SummaryCard
            icon={CheckCircle2}
            label={t("cardCompleted")}
            value={`${auditTotals.completed} (${auditTotals.completedPct}%)`}
            tone={auditTotals.completedPct >= 80 ? "emerald" : auditTotals.completedPct >= 60 ? "amber" : "rose"}
          />
          <SummaryCard icon={AlertOctagon} label={t("cardMajorOpen")} value={auditTotals.majorOpen} tone={auditTotals.majorOpen > 5 ? "rose" : auditTotals.majorOpen > 0 ? "amber" : "emerald"} />
          <SummaryCard icon={AlertTriangle} label={t("cardMinorOpen")} value={auditTotals.minorOpen} tone="amber" />
          <SummaryCard icon={Info} label={t("cardObservationOpen")} value={auditTotals.obsOpen} tone="slate" />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard icon={Scale} label={t("cardTotalCourtCases")} value={courtTotals.total} tone="neutral" />
          <SummaryCard icon={AlertTriangle} label={t("cardCurrentlyOpen")} value={courtTotals.open} tone={courtTotals.open > 10 ? "rose" : courtTotals.open > 2 ? "amber" : "emerald"} />
          <SummaryCard icon={AlertOctagon} label={t("cardAsDefendant")} value={courtTotals.defendant} tone={courtTotals.defendant > 10 ? "rose" : "amber"} />
          <SummaryCard icon={Info} label={t("cardAsPlaintiff")} value={courtTotals.plaintiff} tone="slate" />
          <SummaryCard icon={Info} label={t("cardMoneyClaims")} value={courtTotals.moneyClaims} tone="amber" />
        </div>
      )}

      {/* Tab + controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60">
        <div className="flex gap-1">
          <TabButton active={tab === "audit"} onClick={() => setTab("audit")} icon={Shield}>
            {t("tabAudit", { n: auditRows.length })}
          </TabButton>
          <TabButton active={tab === "court"} onClick={() => setTab("court")} icon={Scale}>
            {t("tabCourt", { n: courtRows.length })}
          </TabButton>
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors mb-1"
        >
          <Download className="h-3.5 w-3.5" />
          {t("exportCsv")}
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <FilterSelect
          label={t("filterEntity")}
          value={entityFilter}
          onChange={setEntityFilter}
          options={[
            { value: "all", label: t("filterAllEntities") },
            ...entityOptions.map((c) => ({ value: c, label: c })),
          ]}
        />
        {tab === "audit" && (
          <FilterSelect
            label={t("filterSeverity")}
            value={severityFilter}
            onChange={(v) => setSeverityFilter(v as SeverityFilter)}
            options={[
              { value: "all", label: t("filterAllSeverities") },
              { value: "Major", label: "Major" },
              { value: "Minor", label: "Minor" },
              { value: "Observation", label: "Observation" },
              { value: "OFI", label: "OFI" },
            ]}
          />
        )}
        <FilterSelect
          label={t("filterStatus")}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          options={[
            { value: "all", label: t("filterAllStatuses") },
            { value: "open", label: t("filterOpenOnly") },
            { value: "closed", label: t("filterClosedOnly") },
          ]}
        />
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setEntityFilter("all");
              setSeverityFilter("all");
              setStatusFilter("all");
            }}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
            {t("clearFilters")}
          </button>
        )}
        <span className="ml-auto text-muted-foreground">
          {t("showingCount", { n: tab === "audit" ? filteredAuditRows.length : filteredCourtRows.length })}
        </span>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-md border border-rose-300 bg-rose-50 text-rose-800 text-xs px-3 py-2 dark:bg-rose-950/40 dark:border-rose-800/40 dark:text-rose-300"
        >
          ⚠ {actionError}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        {tab === "audit" ? (
          <AuditTable
            rows={filteredAuditRows}
            isRowClosed={isRowClosed}
            pendingRows={pendingRows}
            onToggle={(entityId, findingIdx, nextClosed) =>
              startTransition(() => {
                void toggleClosed(entityId, findingIdx, nextClosed);
              })
            }
          />
        ) : (
          <CourtTable rows={filteredCourtRows} />
        )}
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
  icon: typeof Shield;
  label: string;
  value: number | string;
  tone: "neutral" | "emerald" | "amber" | "rose" | "slate";
}) {
  const toneClass = {
    neutral: "text-foreground",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
    slate: "text-slate-600 dark:text-slate-400",
  }[tone];
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={`mt-1 font-mono text-2xl tabular-nums font-semibold ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Shield;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-primary text-foreground font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
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
        className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground"
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

function AuditTable({
  rows,
  isRowClosed,
  pendingRows,
  onToggle,
}: {
  rows: Array<{
    entityId: string;
    entityCode: string;
    entityName: string;
    findingIdx: number;
    finding: AuditFinding;
  }>;
  isRowClosed: (entityId: string, findingIdx: number, f: AuditFinding) => boolean;
  pendingRows: Set<string>;
  onToggle: (entityId: string, findingIdx: number, nextClosed: boolean) => void;
}) {
  const t = useTranslations("adminCompliance");
  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {t("emptyAudit")}
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
        <tr>
          <th className="px-3 py-2 text-left font-medium">{t("thEntity")}</th>
          <th className="px-3 py-2 text-left font-medium">{t("thSeverity")}</th>
          <th className="px-3 py-2 text-left font-medium">{t("thAudit")}</th>
          <th className="px-3 py-2 text-left font-medium">{t("thStatusMng")}</th>
          <th className="px-3 py-2 text-left font-medium">{t("thGrouping")}</th>
          <th className="px-3 py-2 text-right font-medium">{t("thActions")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => {
          const isCompleted = isRowClosed(r.entityId, r.findingIdx, r.finding);
          const key = `${r.entityId}::${r.findingIdx}`;
          const isPending = pendingRows.has(key);
          return (
            <tr
              key={idx}
              className="border-t border-border/40 hover:bg-accent/30 transition-colors"
            >
              <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                {r.entityCode.replace("AZSEKER-", "")}
              </td>
              <td className="px-3 py-2">
                <SeverityChip severity={r.finding.severity} />
              </td>
              <td className="px-3 py-2 text-foreground/90 max-w-md">
                {r.finding.audit}
              </td>
              <td className="px-3 py-2">
                <StatusBadge closed={isCompleted} />
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground max-w-[180px] truncate">
                {r.finding.grouping}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => onToggle(r.entityId, r.findingIdx, !isCompleted)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    isCompleted
                      ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40 dark:hover:bg-amber-950/60"
                      : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40 dark:hover:bg-emerald-950/60"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                  aria-label={
                    isCompleted
                      ? t("ariaReopenAction", { idx: r.findingIdx + 1 })
                      : t("ariaCloseAction", { idx: r.findingIdx + 1 })
                  }
                  data-testid={`finding-toggle-${r.entityCode}-${r.findingIdx}`}
                >
                  {isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : isCompleted ? (
                    <RotateCcw className="h-3 w-3" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  {isCompleted ? t("btnReopen") : t("btnClose")}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CourtTable({
  rows,
}: {
  rows: Array<{ entityCode: string; entityName: string; case: CourtCase }>;
}) {
  const t = useTranslations("adminCompliance");
  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {t("emptyCourt")}
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
        <tr>
          <th className="px-3 py-2 text-left font-medium">{t("thEntity")}</th>
          <th className="px-3 py-2 text-left font-medium">{t("thDate")}</th>
          <th className="px-3 py-2 text-left font-medium">{t("thCourt")}</th>
          <th className="px-3 py-2 text-left font-medium">{t("thType")}</th>
          <th className="px-3 py-2 text-left font-medium">{t("thPlaintiffDefendant")}</th>
          <th className="px-3 py-2 text-left font-medium">{t("thStatus")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr
            key={idx}
            className="border-t border-border/40 hover:bg-accent/30 transition-colors"
          >
            <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {r.entityCode.replace("AZSEKER-", "")}
            </td>
            <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
              {r.case.date}
            </td>
            <td className="px-3 py-2 text-xs text-foreground/80 max-w-[140px] truncate">
              {r.case.court}
            </td>
            <td className="px-3 py-2 text-xs text-foreground/80">
              {r.case.disputeType}
            </td>
            <td className="px-3 py-2 text-xs text-foreground/90 max-w-md">
              <span className="text-muted-foreground">{r.case.claimant}</span>
              <span className="mx-1 text-muted-foreground/60">→</span>
              <span>{r.case.defendant}</span>
            </td>
            <td className="px-3 py-2">
              <StatusBadge closed={r.case.closed} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
