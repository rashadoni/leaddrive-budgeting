"use client";

/**
 * Phase C4 v1 — Scenario runner modal for Risk Terminal.
 *
 * Bloomberg-style overlay listing every scenario in the org's catalog
 * (`Scenario` Prisma model — keyed by `code`, carries an `overrides`
 * JSON blob describing the what-if shifts). Opens on the
 * `terminal:open-scenario` window event (CommandBar `SCN <code> GO`
 * dispatch) OR when the user manually mounts the modal via future
 * hotkey-toolbar `SCENARIOS` button.
 *
 * v1 scope (Phase C4 — visible inspector):
 *  - Lists scenarios (GET /api/scenarios; tenant-scoped server-side).
 *  - Pre-selects the scenario whose `code` matches `activeScenarioCode`
 *    in the store when the SCN dispatch event fires.
 *  - Shows the selected scenario's `overrides` JSON in human-readable
 *    pre-formatted form (no spreadsheet-style editor in v1).
 *  - "Apply" button POSTs to /api/scenarios with `{scenarioId, period}`
 *    — the route returns 202 (queued) per the existing stub; we surface
 *    the queued response so users see the system accepted the request
 *    even though Phase 6 BullMQ scheduler hasn't shipped the worker.
 *
 * v2 follow-ups (already 🔄'd in CARRYOVER as part of plan §C4):
 *  - Live HeatMap recompute under scenario overrides (needs Phase 6
 *    BullMQ + worker + IndicatorValue overlay layer in matrix endpoint).
 *  - Scenario CRUD UI (create/edit/disable from terminal — currently
 *    seed-only).
 *  - Side-by-side baseline vs scenario indicator delta view.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Beaker, X } from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";

interface Scenario {
  id: string;
  code: string;
  nameEn: string;
  nameAz?: string | null;
  nameRu?: string | null;
  description?: string | null;
  overrides: unknown;
  isActive: boolean;
}

type ApplyState =
  | { kind: "idle" }
  | { kind: "applying" }
  | { kind: "queued"; message: string; scenarioCode: string }
  | { kind: "error"; message: string };

export function ScenarioPanel() {
  const [open, setOpen] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applyState, setApplyState] = useState<ApplyState>({ kind: "idle" });
  const activeScenarioCode = useTerminalStore((s) => s.activeScenarioCode);

  // Default period for apply — matches the existing `defaultPeriodString()`
  // used by the recompute pipeline. v2 can switch to user-selectable
  // period / company scope; v1 ships the same default the rest of the
  // terminal uses.
  const period = useMemo(
    () => String(new Date().getUTCFullYear()),
    [],
  );

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-scenario", onOpen);
    return () => window.removeEventListener("terminal:open-scenario", onOpen);
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

  // Fetch scenarios on first open.
  useEffect(() => {
    if (!open || scenarios !== null) return;
    let aborted = false;
    fetch("/api/scenarios")
      .then((r) => {
        if (!r.ok) throw new Error(`/api/scenarios ${r.status}`);
        return r.json();
      })
      .then((data: Scenario[]) => {
        if (aborted) return;
        setScenarios(Array.isArray(data) ? data : []);
      })
      .catch((e: unknown) => {
        if (aborted) return;
        setFetchError(e instanceof Error ? e.message : String(e));
        setScenarios([]); // unblock UI from loading state
      });
    return () => {
      aborted = true;
    };
  }, [open, scenarios]);

  // When scenarios list lands AND the SCN dispatch pinned a code, auto-
  // select that scenario by code → id.
  useEffect(() => {
    if (!scenarios || !activeScenarioCode) return;
    const match = scenarios.find((s) => s.code === activeScenarioCode);
    if (match) setSelectedId(match.id);
  }, [scenarios, activeScenarioCode]);

  const selectedScenario = useMemo(
    () => scenarios?.find((s) => s.id === selectedId) ?? null,
    [scenarios, selectedId],
  );

  const handleApply = useCallback(async () => {
    if (!selectedScenario || applyState.kind === "applying") return;
    setApplyState({ kind: "applying" });
    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: selectedScenario.id, period }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`POST /api/scenarios ${res.status}: ${body}`);
      }
      const json = (await res.json()) as {
        message?: string;
        scenarioCode?: string;
      };
      setApplyState({
        kind: "queued",
        message: json.message ?? "Queued",
        scenarioCode: json.scenarioCode ?? selectedScenario.code,
      });
    } catch (e: unknown) {
      setApplyState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [selectedScenario, applyState.kind, period]);

  if (!open) return null;

  const formattedOverrides = selectedScenario
    ? JSON.stringify(selectedScenario.overrides, null, 2)
    : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scenario runner"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-lg border border-gray-700 bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <Beaker size={16} className="text-[#FFB800]" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Scenario Runner
              </h2>
              <p className="text-xs text-muted-foreground">
                What-if overrides on the org&apos;s indicator pipeline. Press Esc to close.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close scenario panel"
            className="rounded border border-gray-700 px-2 py-1 text-sm hover:bg-gray-800"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 px-6 py-4">
          <aside aria-label="Scenario list">
            <h3 className="text-xs font-mono uppercase tracking-wider text-gray-500 mb-2">
              Available ({scenarios?.length ?? 0})
            </h3>
            {scenarios === null ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="scenarios-loading"
              >
                Loading…
              </p>
            ) : scenarios.length === 0 ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="scenarios-empty"
              >
                No scenarios seeded for this org.
              </p>
            ) : (
              <ul className="space-y-1">
                {scenarios.map((s) => {
                  const isSelected = s.id === selectedId;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(s.id);
                          setApplyState({ kind: "idle" });
                        }}
                        className={`w-full text-left px-2 py-1.5 rounded border text-xs font-mono ${
                          isSelected
                            ? "border-[#FFB800] bg-[#FFB800]/10 text-[#FFB800]"
                            : "border-gray-700 hover:bg-gray-800 text-gray-300"
                        }`}
                        data-testid={`scenario-row-${s.code}`}
                      >
                        <div className="font-semibold">{s.code}</div>
                        <div className="opacity-70 text-[10px] mt-0.5 line-clamp-1">
                          {s.nameEn}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {fetchError && (
              <p
                role="alert"
                className="text-xs text-[#FF4757] mt-2"
                data-testid="scenarios-fetch-error"
              >
                {fetchError}
              </p>
            )}
          </aside>

          <section aria-label="Scenario detail">
            {selectedScenario === null ? (
              <p className="text-sm text-muted-foreground">
                {scenarios && scenarios.length > 0
                  ? "Select a scenario from the list to inspect overrides."
                  : "No scenario selected."}
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <h3 className="text-base font-semibold">
                    {selectedScenario.nameEn}
                  </h3>
                  <p className="text-xs text-gray-500 font-mono">
                    {selectedScenario.code}
                  </p>
                </div>
                {selectedScenario.description && (
                  <p className="text-sm text-gray-300">
                    {selectedScenario.description}
                  </p>
                )}
                <div>
                  <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                    Overrides
                  </h4>
                  <pre
                    className="text-xs font-mono bg-black/30 border border-gray-800 rounded p-3 overflow-x-auto"
                    data-testid="scenario-overrides"
                  >
                    {formattedOverrides}
                  </pre>
                </div>
                <div className="flex items-center gap-3 pt-2 border-t border-gray-800">
                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={applyState.kind === "applying"}
                    className="rounded border border-[#FFB800] bg-[#FFB800]/10 text-[#FFB800] px-3 py-1.5 text-sm hover:bg-[#FFB800]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="scenario-apply-button"
                  >
                    {applyState.kind === "applying" ? "Applying…" : "Apply"}
                  </button>
                  <span className="text-xs text-gray-500">
                    Period: <span className="font-mono">{period}</span>
                  </span>
                </div>
                {applyState.kind === "queued" && (
                  <p
                    className="text-sm text-[#00D4AA]"
                    data-testid="scenario-applied"
                  >
                    ✓ {applyState.scenarioCode}: {applyState.message}.
                    {" "}Live recompute lands with Phase 6 BullMQ worker; v1
                    surfaces the queue acknowledgement only.
                  </p>
                )}
                {applyState.kind === "error" && (
                  <p
                    role="alert"
                    className="text-sm text-[#FF4757]"
                    data-testid="scenario-apply-error"
                  >
                    Apply failed: {applyState.message}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
