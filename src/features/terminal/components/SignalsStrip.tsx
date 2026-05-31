"use client";

/**
 * Phase 3 — live price/weather signal strip.
 *
 * Fetches /api/scenarios/signals on mount and renders a thin strip of
 * data-grounded crisis suggestions ("📡 Сигналы"). Clicking a chip pre-selects
 * the suggested scenario (same dispatch pattern as the SCN command) and opens
 * the Scenario panel — the user still pulls the trigger. Renders nothing when
 * there are no signals (no layout cost) or on fetch failure (never breaks the
 * terminal). News-derived triggers are OUT (Phase 3b — data-blocked).
 */
import { useEffect, useState } from "react";
import { useTerminalStore } from "../store/terminalStore";

interface Signal {
  id: string;
  kind: "market" | "news";
  severity: "high" | "medium";
  label: string;
  detail: string;
  suggestedScenarioCode: string;
  asOf: string;
  stale: boolean;
}

const SEV_DOT: Record<string, string> = { high: "bg-red-500", medium: "bg-[#FFB800]" };

export function SignalsStrip() {
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const setActiveScenarioCode = useTerminalStore((s) => s.setActiveScenarioCode);

  useEffect(() => {
    let aborted = false;
    fetch("/api/scenarios/signals")
      .then((r) => (r.ok ? r.json() : { signals: [] }))
      .then((d: { signals?: Signal[] }) => {
        if (!aborted) setSignals(Array.isArray(d.signals) ? d.signals : []);
      })
      .catch(() => {
        if (!aborted) setSignals([]);
      });
    return () => {
      aborted = true;
    };
  }, []);

  if (!signals || signals.length === 0) return null;

  const open = (code: string) => {
    setActiveScenarioCode(code);
    window.dispatchEvent(new CustomEvent("terminal:open-scenario", { detail: { scenarioCode: code } }));
  };

  return (
    <div
      className="flex items-center gap-2 border-b border-gray-800 bg-[#0a0e1f] px-3 py-2 overflow-x-auto"
      data-testid="signals-strip"
    >
      <span className="shrink-0 text-[11px] font-mono font-semibold uppercase tracking-wider text-sky-300">
        📡 Сигналы
      </span>
      {signals.map((s) => {
        // Readability (2026-05-31): severity-colored chip (red=high / amber=medium)
        // for at-a-glance scanning + bright label/code text — the previous
        // muted-foreground code + foreground/90 label washed out on the dark strip.
        const sev =
          s.severity === "high"
            ? "border-red-500/60 bg-red-500/10 hover:border-red-400 hover:bg-red-500/20"
            : "border-amber-500/50 bg-amber-500/10 hover:border-amber-400 hover:bg-amber-500/20";
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => open(s.suggestedScenarioCode)}
            title={`${s.detail}${s.stale ? ` · устарело ${s.asOf}` : ` · ${s.asOf}`}`}
            data-testid={`signal-${s.id}`}
            className={`shrink-0 inline-flex items-center gap-2 rounded border px-2.5 py-1 text-xs transition-colors ${sev}`}
          >
            {s.kind === "news" ? (
              <span aria-hidden="true">📰</span>
            ) : (
              <span
                className={`inline-block w-2 h-2 rounded-full ${SEV_DOT[s.severity] ?? "bg-muted-foreground"}`}
              />
            )}
            <span className="text-gray-100 font-medium max-w-[360px] truncate">{s.label}</span>
            <span className="text-sky-300/90 font-mono shrink-0">→ {s.suggestedScenarioCode}</span>
            {s.stale && <span className="text-amber-400 text-[10px] shrink-0">⚠</span>}
          </button>
        );
      })}
    </div>
  );
}
