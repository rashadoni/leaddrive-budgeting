"use client";
/**
 * Compliance Hub presentational subcomponents — extracted from
 * ComplianceHub.tsx (Phase 8 D1 2026-05-29). All props-only (defined outside
 * the main component, so they never captured its state): severity/status
 * chips, the CSV helper, summary cards, tab + filter controls, and the audit
 * / court tables. The main component imports them back.
 */
import React from "react";
import { useTranslations } from "next-intl";
import {
  Shield,
  AlertOctagon,
  AlertTriangle,
  Info,
  CheckCircle2,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { type AuditFinding, type CourtCase } from "./compliance-types";

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

export function SeverityChip({ severity }: { severity: string }) {
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

export function StatusBadge({ closed }: { closed: boolean }) {
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

export function downloadCsv(filename: string, rows: string[][]) {
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

export function SummaryCard({
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

export function TabButton({
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

export function FilterSelect({
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

export function AuditTable({
  rows,
  isRowClosed,
  pendingRows,
  onToggle,
  onOpenDrilldown,
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
  onOpenDrilldown: (row: {
    entityId: string;
    entityCode: string;
    entityName: string;
    findingIdx: number;
  }) => void;
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
                {/* Phase 8 E2 — clickable audit text opens drill-down
                    modal with full description, mutation history,
                    comments. Underline-on-hover signals affordance. */}
                <button
                  type="button"
                  onClick={() =>
                    onOpenDrilldown({
                      entityId: r.entityId,
                      entityCode: r.entityCode,
                      entityName: r.entityName,
                      findingIdx: r.findingIdx,
                    })
                  }
                  className="text-left hover:text-foreground hover:underline underline-offset-2 decoration-dotted decoration-muted-foreground cursor-pointer transition-colors"
                  data-testid={`finding-drilldown-${r.entityCode}-${r.findingIdx}`}
                  aria-label={t("ariaOpenDrilldown", { idx: r.findingIdx + 1 })}
                >
                  {r.finding.audit}
                </button>
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

export function CourtTable({
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
