"use client";

/**
 * Action Center Panel (Bloomberg EMSX-orders equivalent for the CFO
 * use-case).
 *
 * Birth: Tier-3 sub-28 (v1 — cells-only).
 * v2: sub-31 (added rule-engine alerts wiring — Round-13 holdover closed).
 *
 * Bloomberg's EMSX shows the buy-side trader's order lifecycle (pending
 * fills, working bids, rejected orders). Our holding-CFO equivalent is
 * a "pending review queue" of items needing human attention.
 *
 * Data sources:
 *  - `terminalStore.alertMatches` → rule-engine-grouped items rendered
 *    in the TOP section (sub-31 v2). De-duped + rule-context: when
 *    sector-red-spread fires across 5 sub-cos, the user sees ONE alert
 *    row with 5 affected-company chips, not 5 separate cell rows.
 *  - `useMatrix()` cells filtered to red+amber → cell-level work items
 *    in the BOTTOM section (sub-28 v1), grouped by severity for granular
 *    drill-in.
 *
 * Click handlers:
 *  - Cell row → `selectCompany(code)` + `setActiveIndicatorValue(id)`
 *    + Panel 3 focus + close modal
 *  - Alert chip → `selectCompany(code)` + close modal (matches
 *    AlertsPanel chip behavior)
 *
 * Pattern: same as AlertsPanel / ScenarioPanel / ComparePanel — modal
 * overlay opens on `terminal:open-action-center` event (CommandBar `ACT
 * GO` verb). Esc / backdrop / × close. Locale-aware via next-intl.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  localizeAlertMessageParams,
  type IndustryTranslator,
} from "@/lib/risk/alert-message-i18n";
import { ListChecks, X, AlertTriangle } from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";
import { useMatrix } from "../hooks/use-matrix";
import { useCompanies } from "../hooks/use-companies";
import { isAggregateRollup, statusColor, statusShape } from "@/lib/risk/heatmap-matrix";
import type { IndicatorStatus } from "@/lib/risk/formula-engine";
import { DEFAULT_ALERT_RULE_IDS } from "@/lib/risk/alert-rules";
import type { AlertSeverity } from "@/lib/risk/alert-rules";
import { resolveIndicatorLabel } from "../lib/resolve-indicator-label";

/** A single row in the queue — derived from one HeatMapCell. */
interface WorkItem {
  /** Composite cell key — stable identifier for React list rendering. */
  key: string;
  /** Severity bucket — drives color + grouping. */
  severity: "red" | "amber";
  companyId: string;
  companyCode: string;
  companyName: string;
  industry: string;
  indicatorId: string;
  indicatorCode: string;
  indicatorLabel: string;
  status: IndicatorStatus;
  value: number;
  unit: string;
  /** IndicatorValue.id for jump-to-Variance-Explainer. Optional because
   *  pre-Phase-7.D cells didn't carry it; we still render the row but
   *  click action becomes selectCompany-only. */
  indicatorValueId?: string;
}

const SEVERITY_ORDER: Record<"red" | "amber", number> = {
  red: 0,
  amber: 1,
};

const SEVERITY_TONE: Record<"red" | "amber", string> = {
  red: "text-red-600 dark:text-red-400 border-red-500/40 bg-red-500/10",
  amber: "text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10",
};

/** Sub-31 — alertMatches → IndicatorStatus mapping for shape glyph
 *  selection. critical→red→■ / warning→amber→▲ / info→green→●. Mirrors
 *  AlertsPanel SEVERITY_SHAPE pattern for cross-panel consistency. */
const ALERT_SEVERITY_STATUS: Record<
  AlertSeverity,
  "red" | "amber" | "green"
> = {
  critical: "red",
  warning: "amber",
  info: "green",
};

const ALERT_SEVERITY_TONE: Record<AlertSeverity, string> = {
  critical: "text-red-600 dark:text-red-400 border-red-500/40 bg-red-500/10",
  warning: "text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10",
  info: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
};

/** Round-26 closure — hoisted from per-render set construction.
 *  Sub-35 closure: now an alias for the canonical `DEFAULT_ALERT_RULE_IDS`
 *  exported from the engine, replacing the hand-maintained duplicate.
 *  Adding a new built-in rule to `DEFAULT_ALERT_RULES` automatically
 *  registers it for the locale path; no third-party update needed. */
const KNOWN_DEFAULT_RULES = DEFAULT_ALERT_RULE_IDS;

export function ActionCenterPanel() {
  const t = useTranslations("terminal");
  // Phase 7.G Turn G — see AlertsPanel.tsx for the same pattern.
  const tIndustries = useTranslations(
    "industries",
  ) as unknown as IndustryTranslator;
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const selectCompany = useTerminalStore((s) => s.selectCompany);
  const setActiveIndicatorValue = useTerminalStore(
    (s) => s.setActiveIndicatorValue,
  );
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  // Sub-31 v2 — pull rule-engine matches for the de-duped alerts
  // section. Same store slice AlertsPanel reads from; published by
  // HeatMap after each matrix fetch via `evaluateAlertRules(...)`.
  const alertMatches = useTerminalStore((s) => s.alertMatches);
  const { matrix } = useMatrix();
  // Resolve company codes for alert-chip rendering (id → code lookup);
  // shared with AlertsPanel via the useCompanies module-cache hook.
  const { idToCode, loading: companiesLoading } = useCompanies();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-action-center", onOpen);
    return () =>
      window.removeEventListener("terminal:open-action-center", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * Synthesize work-item queue from matrix cells. Filters to
   * red + amber leaf cells (skips sub-group rollups — they double-count
   * the same underlying signals already represented by leaf rows). Sorts
   * red-first, then alphabetic by company code within each tier.
   */
  const items: WorkItem[] = useMemo(() => {
    if (!matrix) return [];
    const compById = new Map(
      matrix.companies.map((c) => [c.id, c] as const),
    );
    const indById = new Map(
      matrix.indicators.map((i) => [i.id, i] as const),
    );
    const out: WorkItem[] = [];
    for (const cell of matrix.cells) {
      // Sub-44 cont'd architect closure — gate via shared helper to
      // also skip real parent-co rollup IVs (sub-44 cont'd render-path).
      if (isAggregateRollup(cell)) continue;
      if (cell.status !== "red" && cell.status !== "amber") continue;
      const co = compById.get(cell.companyId);
      const ind = indById.get(cell.indicatorId);
      if (!co || !ind) continue;
      // Round-24 Stage 3 — single-source-of-truth resolver shared with
      // HeatMap, IndicatorDetail, CommentsLayer, SubCoFinanceChat.
      const indicatorLabel = resolveIndicatorLabel(ind, locale);
      out.push({
        key: `${cell.companyId}:${cell.indicatorId}`,
        severity: cell.status,
        companyId: cell.companyId,
        companyCode: co.code,
        companyName: co.name,
        industry: co.industry,
        indicatorId: cell.indicatorId,
        indicatorCode: ind.code,
        indicatorLabel,
        status: cell.status,
        value: cell.value,
        unit: ind.unit,
        indicatorValueId: cell.indicatorValueId,
      });
    }
    out.sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return a.companyCode.localeCompare(b.companyCode);
    });
    return out;
  }, [matrix, locale]);

  const grouped = useMemo(() => {
    const out: Record<"red" | "amber", WorkItem[]> = { red: [], amber: [] };
    for (const it of items) out[it.severity].push(it);
    return out;
  }, [items]);

  if (!open) return null;

  const handleJump = (it: WorkItem) => {
    selectCompany(it.companyCode);
    if (it.indicatorValueId) {
      setActiveIndicatorValue(it.indicatorValueId);
      setActivePanel(3); // drill-down panel
    }
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("actionCenter.dialogAriaLabel")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-3xl max-h-[80vh] overflow-y-auto rounded-lg border border-input bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <ListChecks
              size={16}
              className="text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("actionCenter.title", { count: items.length })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("actionCenter.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("actionCenter.closeAriaLabel")}
            className="rounded border border-input px-2 py-1 text-sm hover:bg-muted/50"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="px-6 py-4 space-y-4">
          {/* Sub-31 v2 — rule-engine alerts section. Renders ABOVE the
              cell-level work items so the user sees high-level rule
              context (e.g. "sector-red-spread fired across 5 sub-cos")
              first, then drills into individual cells if needed. Same
              store slice AlertsPanel modal consumes — keeping the two
              surfaces in sync without a separate fetch. */}
          {alertMatches !== null && alertMatches.length > 0 && (
            <section
              aria-label={t("actionCenter.alertsSectionAriaLabel")}
              data-testid="action-center-alerts-section"
            >
              <h3 className="text-xs font-mono uppercase tracking-wider mb-2 text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle
                  size={12}
                  className="text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                {t("actionCenter.alertsSectionTitle", {
                  count: alertMatches.length,
                })}
              </h3>
              <ul className="space-y-2">
                {alertMatches.map((m, i) => {
                  const status = ALERT_SEVERITY_STATUS[m.severity];
                  const tone = ALERT_SEVERITY_TONE[m.severity];
                  // Locale-aware rule name (defaults to server-side
                  // ruleName for synthetic / custom rules — same try/catch
                  // dance as AlertsPanel:155-172). KNOWN_DEFAULT_RULES is
                  // a module-level constant (Round-26 hoist).
                  let ruleName = m.ruleName;
                  if (KNOWN_DEFAULT_RULES.has(m.ruleId)) {
                    try {
                      ruleName = t(`alerts.rules.${m.ruleId}` as never);
                    } catch {
                      ruleName = m.ruleName;
                    }
                  }
                  // Sub-35 — locale-aware message body. Mirror the
                  // ruleName allowlist + try/catch shape so synthetic
                  // / custom rules fall back to engine-emitted English.
                  let messageBody = m.message;
                  if (m.messageKey && KNOWN_DEFAULT_RULES.has(m.ruleId)) {
                    try {
                      // Turn G: localize industry code before substitution.
                      const localizedParams = localizeAlertMessageParams(
                        m.messageParams,
                        tIndustries,
                      );
                      messageBody = t(
                        m.messageKey as never,
                        localizedParams as never,
                      );
                    } catch {
                      messageBody = m.message;
                    }
                  }
                  return (
                    <li
                      key={`${m.ruleId}-${i}`}
                      data-testid={`action-center-alert-${m.ruleId}`}
                      className={`rounded border px-3 py-2 ${tone}`}
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span aria-hidden="true" className="opacity-80">
                          {statusShape(status)}
                        </span>
                        <span className="font-mono text-[11px] font-semibold">
                          {ruleName}
                        </span>
                      </div>
                      <div className="text-sm mt-0.5">{messageBody}</div>
                      {m.affectedCompanyIds.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {!companiesLoading
                            ? m.affectedCompanyIds.map((id) => {
                                const code = idToCode.get(id);
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    onClick={() => {
                                      if (code) {
                                        selectCompany(code);
                                        setOpen(false);
                                      }
                                    }}
                                    disabled={!code}
                                    aria-label={
                                      code
                                        ? t("actionCenter.alertChipAriaLabel", {
                                            code,
                                          })
                                        : undefined
                                    }
                                    className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-gray-600 hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    data-testid={`action-center-alert-chip-${id}`}
                                  >
                                    {code ?? id.slice(0, 8) + "…"}
                                  </button>
                                );
                              })
                            : null}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {matrix === null ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="action-center-loading"
            >
              {t("actionCenter.matrixLoading")}
            </p>
          ) : items.length === 0 ? (
            <p
              className="text-sm text-emerald-600 dark:text-emerald-400"
              data-testid="action-center-empty"
            >
              {t("actionCenter.noWorkItems")}
            </p>
          ) : (
            (Object.keys(grouped) as Array<"red" | "amber">).map((sev) => {
              const list = grouped[sev];
              if (list.length === 0) return null;
              // Static t() calls so next-intl's typed-key inference can
              // also forward the {count} placeholder; dynamic key+values
              // doesn't type-narrow under `as never`.
              const sevHeader =
                sev === "red"
                  ? t("actionCenter.severityRed", { count: list.length })
                  : t("actionCenter.severityAmber", { count: list.length });
              return (
                <section
                  key={sev}
                  aria-label={t("actionCenter.severitySectionAriaLabel", {
                    severity: sev.toUpperCase(),
                  })}
                >
                  <h3
                    className={`text-xs font-mono uppercase tracking-wider mb-2 ${SEVERITY_TONE[sev].split(" ")[0]}`}
                  >
                    <span aria-hidden="true" className="mr-1 opacity-80">
                      {statusShape(sev)}
                    </span>
                    {sevHeader}
                  </h3>
                  <ul className="space-y-2">
                    {list.map((it) => (
                      <li
                        key={it.key}
                        data-testid={`action-center-row-${it.key}`}
                      >
                        <button
                          type="button"
                          onClick={() => handleJump(it)}
                          aria-label={t("actionCenter.itemAriaLabel", {
                            company: it.companyCode,
                            indicator: it.indicatorCode,
                          })}
                          title={t("actionCenter.itemReviewHint", {
                            company: it.companyCode,
                            indicator: it.indicatorCode,
                          })}
                          className={`w-full text-left rounded border px-3 py-2 transition-colors hover:bg-muted/50/40 ${SEVERITY_TONE[sev]}`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-[11px] font-semibold">
                              {it.companyCode}
                            </span>
                            <span
                              className="font-mono text-[10px] tabular-nums"
                              style={{ color: statusColor(it.status) }}
                            >
                              <span aria-hidden="true" className="mr-1 opacity-70">
                                {statusShape(it.status)}
                              </span>
                              {t("actionCenter.currentValue")}:{" "}
                              {Number.isFinite(it.value)
                                ? it.value.toFixed(2)
                                : "—"}
                              {it.unit ? ` ${it.unit}` : ""}
                            </span>
                          </div>
                          <div className="text-[10px] opacity-70 mt-0.5">
                            {it.companyName}
                            {it.industry ? ` · ${it.industry}` : ""}
                          </div>
                          <div className="text-sm mt-1">{it.indicatorLabel}</div>
                          <div className="text-[10px] font-mono opacity-60 mt-0.5">
                            {it.indicatorCode}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
