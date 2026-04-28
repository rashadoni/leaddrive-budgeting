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
 * v2 follow-ups (already 🔄'd in CARRYOVER):
 *  - Per-rule "mute for N hours" (alert acknowledgement / suppression)
 *  - Click-through to specific indicator drilldown when affectedIndicatorCodes set
 *  - Live cell highlight in HeatMap when alert hovered (cross-panel viz)
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";
import type { AlertMatch, AlertSeverity } from "@/lib/risk/alert-rules";

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

const SEVERITY_TONE: Record<AlertSeverity, string> = {
  critical: "text-[#FF4757] border-[#FF4757]/40 bg-[#FF4757]/10",
  warning: "text-[#FFB800] border-[#FFB800]/40 bg-[#FFB800]/10",
  info: "text-[#00D4AA] border-[#00D4AA]/40 bg-[#00D4AA]/10",
};

export function AlertsPanel() {
  const [open, setOpen] = useState(false);
  const matches = useTerminalStore((s) => s.alertMatches);
  const selectCompany = useTerminalStore((s) => s.selectCompany);
  // Companies map for code-rendering — taken from store-published
  // alertedCompanyCodes/setCompany pattern. AlertMatch carries
  // `affectedCompanyIds` (UUIDs) — to render `AAC-MAIN` instead of
  // raw UUID we'd need an id→code map. HeatMap already has the matrix;
  // store doesn't currently expose `companies`. Workaround: AlertsPanel
  // fetches `/api/companies` once on first open (same pattern
  // RelatedFunctionsMenu uses).
  const [idToCode, setIdToCode] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [companyFetchError, setCompanyFetchError] = useState<string | null>(
    null,
  );

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

  // Fetch companies once on first modal open to build id→code map.
  useEffect(() => {
    if (!open || idToCode.size > 0) return;
    let aborted = false;
    fetch("/api/companies")
      .then((r) => r.json())
      .then((data) => {
        if (aborted) return;
        const map = new Map<string, string>();
        const visit = (
          arr: Array<{
            id: string;
            code: string;
            children?: Array<{ id: string; code: string; children?: unknown[] }>;
          }>,
        ) => {
          for (const c of arr) {
            map.set(c.id, c.code);
            if (Array.isArray(c.children)) {
              visit(
                c.children as Array<{
                  id: string;
                  code: string;
                  children?: Array<{
                    id: string;
                    code: string;
                    children?: unknown[];
                  }>;
                }>,
              );
            }
          }
        };
        if (Array.isArray(data)) visit(data);
        else if (Array.isArray(data?.companies)) visit(data.companies);
        setIdToCode(map);
      })
      .catch((e: unknown) => {
        if (aborted) return;
        setCompanyFetchError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      aborted = true;
    };
  }, [open, idToCode.size]);

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
      aria-label="Alerts panel"
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
                Alerts ({matches?.length ?? 0})
              </h2>
              <p className="text-xs text-muted-foreground">
                Multi-indicator rule matches across the holding. Press Esc to close.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close alerts panel"
            className="rounded border border-gray-700 px-2 py-1 text-sm hover:bg-gray-800"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="px-6 py-4 space-y-4">
          {matches === null ? (
            <p className="text-sm text-muted-foreground" data-testid="alerts-loading">
              Matrix loading… alerts populate after first refresh.
            </p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-[#00D4AA]" data-testid="alerts-empty">
              ✓ No alerts triggered — all systems green.
            </p>
          ) : (
            (Object.keys(grouped) as AlertSeverity[]).map((sev) => {
              const list = grouped[sev];
              if (list.length === 0) return null;
              return (
                <section key={sev} aria-label={`${SEVERITY_LABEL[sev]} alerts`}>
                  <h3
                    className={`text-xs font-mono uppercase tracking-wider mb-2 ${SEVERITY_TONE[sev].split(" ")[0]}`}
                  >
                    {SEVERITY_LABEL[sev]} ({list.length})
                  </h3>
                  <ul className="space-y-2">
                    {list.map((m, i) => (
                      <li
                        key={`${m.ruleId}-${i}`}
                        className={`rounded border px-3 py-2 ${SEVERITY_TONE[sev]}`}
                        data-testid={`alert-row-${m.ruleId}`}
                      >
                        <div className="font-mono text-[11px] opacity-70">
                          {m.ruleName}
                        </div>
                        <div className="text-sm mt-0.5">{m.message}</div>
                        {m.affectedCompanyIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {m.affectedCompanyIds.map((id) => {
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
                                      ? `Jump to ${code}`
                                      : "Company code not loaded — try reopening"
                                  }
                                >
                                  {code ?? id.slice(0, 8) + "…"}
                                </button>
                              );
                            })}
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
              Could not load company codes — chips show ids: {companyFetchError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
