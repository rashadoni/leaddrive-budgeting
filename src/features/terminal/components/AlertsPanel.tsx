"use client";

/**
 * Phase C6 v2 — Alerts panel modal for Risk Terminal.
 *
 * Bloomberg-style overlay listing every match returned by the alert
 * rules engine (`evaluateAlertRules(DEFAULT_ALERT_RULES, ctx)`), grouped
 * by severity (critical → warning → info). Opens on the
 * `terminal:open-alerts` window event (CommandBar `[alerts]` strip
 * click; future hotkey-toolbar `ALERTS` button); closes on Escape OR
 * backdrop click — same modal contract as `AuditModal` / `ComparePanel`.
 *
 * Source of truth for matches is `terminalStore.alertMatches`, populated
 * by HeatMap after each matrix fetch. `null` = "matrix not loaded yet"
 * (modal shows loading state); empty array = "no rules triggered" (all
 * systems green message).
 *
 * Click an `affectedCompanyId` chip → `selectCompany(code)` (tracks LRU
 * recent) + closes modal so user lands on the offending company.
 *
 * Sub-27 cont'd Round-9 — full i18n coverage. Severity labels now
 * resolved via `t(`alertsPanel.severity${Capitalized}`)` so the modal
 * speaks RU/AZ end-to-end (was hardcoded English regardless of locale).
 *
 * v2 follow-ups (already 🔄'd in CARRYOVER):
 *  - Per-rule "mute for N hours" (alert acknowledgement / suppression)
 *  - Click-through to specific indicator drilldown when affectedIndicatorCodes set
 *  - Live cell highlight in HeatMap when alert hovered (cross-panel viz)
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";
import { useCompanies } from "../hooks/use-companies";
import { DEFAULT_ALERT_RULE_IDS } from "@/lib/risk/alert-rules";
import type { AlertMatch, AlertSeverity } from "@/lib/risk/alert-rules";
import { statusShape } from "@/lib/risk/heatmap-matrix";

const SEVERITY_KEY: Record<AlertSeverity, string> = {
  critical: "severityCritical",
  warning: "severityWarning",
  info: "severityInfo",
};

const SEVERITY_TONE: Record<AlertSeverity, string> = {
  critical: "text-[#FF4757] border-[#FF4757]/40 bg-[#FF4757]/10",
  warning: "text-[#FFB800] border-[#FFB800]/40 bg-[#FFB800]/10",
  info: "text-[#00D4AA] border-[#00D4AA]/40 bg-[#00D4AA]/10",
};

/** Tier-3 sub-29 M7 sweep — color-blind safe redundant signal for
 *  severity headers. critical→red→■ / warning→amber→▲ / info→green→●
 *  via statusShape() helper. */
const SEVERITY_SHAPE: Record<AlertSeverity, string> = {
  critical: statusShape("red"),
  warning: statusShape("amber"),
  info: statusShape("green"),
};

export function AlertsPanel() {
  const t = useTranslations("terminal");
  const [open, setOpen] = useState(false);
  const matches = useTerminalStore((s) => s.alertMatches);
  const selectCompany = useTerminalStore((s) => s.selectCompany);
  // Sub-19 architect 🔄 closure: was inline `/api/companies` fetch
  // duplicated across 4 panels. Swapped to shared `useCompanies()`
  // hook — single fetch shared via module cache; same loading-state
  // semantics (companiesFetched derived from `loading` flag).
  const { idToCode, loading: companiesLoading, error: companyFetchError } =
    useCompanies();
  const companiesFetched = !companiesLoading;

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-alerts", onOpen);
    return () => window.removeEventListener("terminal:open-alerts", onOpen);
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

  const grouped = useMemo(() => {
    const out: Record<AlertSeverity, AlertMatch[]> = {
      critical: [],
      warning: [],
      info: [],
    };
    if (matches) {
      for (const m of matches) out[m.severity].push(m);
    }
    return out;
  }, [matches]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("alertsPanel.dialogAriaLabel")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-3xl max-h-[80vh] overflow-y-auto rounded-lg border border-gray-700 bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-[#FFB800]" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("alertsPanel.title", { count: matches?.length ?? 0 })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("alertsPanel.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("alertsPanel.closeAriaLabel")}
            className="rounded border border-gray-700 px-2 py-1 text-sm hover:bg-gray-800"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="px-6 py-4 space-y-4">
          {matches === null ? (
            <p className="text-sm text-muted-foreground" data-testid="alerts-loading">
              {t("alertsPanel.matrixLoading")}
            </p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-[#00D4AA]" data-testid="alerts-empty">
              {t("alertsPanel.noAlerts")}
            </p>
          ) : (
            (Object.keys(grouped) as AlertSeverity[]).map((sev) => {
              const list = grouped[sev];
              if (list.length === 0) return null;
              const sevLabel = t(`alertsPanel.${SEVERITY_KEY[sev]}` as never);
              return (
                <section
                  key={sev}
                  aria-label={t("alertsPanel.severitySectionAriaLabel", {
                    severity: sevLabel,
                  })}
                >
                  <h3
                    className={`text-xs font-mono uppercase tracking-wider mb-2 ${SEVERITY_TONE[sev].split(" ")[0]}`}
                  >
                    <span aria-hidden="true" className="mr-1 opacity-80">
                      {SEVERITY_SHAPE[sev]}
                    </span>
                    {sevLabel} ({list.length})
                  </h3>
                  <ul className="space-y-2">
                    {list.map((m, i) => (
                      <li
                        key={`${m.ruleId}-${i}`}
                        className={`rounded border px-3 py-2 ${SEVERITY_TONE[sev]}`}
                        data-testid={`alert-row-${m.ruleId}`}
                      >
                        <div className="font-mono text-[11px] opacity-70">
                          {(() => {
                            // Sub-27 cont'd multi-lingual MVP: only built-in
                            // default rule IDs have translation entries —
                            // custom rules + synthetic test fixtures fall
                            // back to server-side `ruleName`. Sub-35 closure:
                            // allowlist now sourced from the canonical
                            // `DEFAULT_ALERT_RULE_IDS` engine export.
                            if (!DEFAULT_ALERT_RULE_IDS.has(m.ruleId)) return m.ruleName;
                            try {
                              return t(`alerts.rules.${m.ruleId}` as never);
                            } catch {
                              return m.ruleName;
                            }
                          })()}
                        </div>
                        <div className="text-sm mt-0.5">
                          {(() => {
                            // Sub-35 — alert message i18n. Built-in rules
                            // render the locale-aware template; custom or
                            // synthetic ruleIds (and test mocks lacking
                            // the key) fall back to engine-emitted English.
                            if (!m.messageKey || !DEFAULT_ALERT_RULE_IDS.has(m.ruleId)) {
                              return m.message;
                            }
                            try {
                              // `as never` casts mirror the existing
                              // dynamic-key pattern at line 192. next-intl's
                              // strict t() typing doesn't model dynamic keys.
                              return t(
                                m.messageKey as never,
                                m.messageParams as never,
                              );
                            } catch {
                              return m.message;
                            }
                          })()}
                        </div>
                        {m.affectedCompanyIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {/* Architect Round-1 sub-10 closure
                                (sub-16): until /api/companies resolves
                                idToCode is empty + companyFetchError null
                                — show a single "Loading codes…" pill
                                instead of N disabled `unknown_xxx…` pills
                                that flash for ~50-200ms on first open. */}
                            {!companiesFetched && !companyFetchError ? (
                              <span
                                className="text-[10px] text-gray-500 italic"
                                data-testid="alerts-codes-loading"
                              >
                                {t("alertsPanel.loadingCodes")}
                              </span>
                            ) : (
                              m.affectedCompanyIds.map((id) => {
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
                                    className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-gray-600 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={
                                      code
                                        ? t("alertsPanel.jumpToCompany", { code })
                                        : t("alertsPanel.companyCodeNotLoaded")
                                    }
                                  >
                                    {code ?? id.slice(0, 8) + "…"}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}

          {companyFetchError && (
            <p
              role="alert"
              className="text-xs text-[#FF4757]"
              data-testid="alerts-fetch-error"
            >
              {t("alertsPanel.couldNotLoadCodes", { error: companyFetchError })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
