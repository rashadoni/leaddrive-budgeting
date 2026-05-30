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
      className="flex items-center gap-2 border-b border-border/60 bg-[#0a0e1f] px-3 py-1.5 overflow-x-auto"
      data-testid="signals-strip"
    >
      <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-sky-300/80">📡 Сигналы</span>
      {signals.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => open(s.suggestedScenarioCode)}
          title={`${s.detail}${s.stale ? ` · устарело ${s.asOf}` : ` · ${s.asOf}`}`}
          data-testid={`signal-${s.id}`}
          className="shrink-0 inline-flex items-center gap-1.5 rounded border border-border bg-background/60 px-2 py-0.5 text-[11px] hover:border-sky-500/50 hover:bg-sky-500/10"
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${SEV_DOT[s.severity] ?? "bg-muted-foreground"}`} />
          <span className="text-foreground/90">{s.label}</span>
          <span className="text-muted-foreground">→ {s.suggestedScenarioCode}</span>
          {s.stale && <span className="text-amber-500 text-[9px]">⚠</span>}
        </button>
      ))}
    </div>
  );
}
