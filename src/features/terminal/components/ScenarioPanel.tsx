"use client";

/**
 * Phase 7.N — Scenario runner modal (live What-if).
 *
 * v2 replaces the v1 "queued" stub with:
 *  1. GET /api/scenarios/[id]/simulate  — real post-hoc indicator delta
 *  2. Delta table: shows which indicators change color (baseline → scenario)
 *  3. "Применить к HeatMap" — stores delta in terminalStore; HeatMap
 *     overlays scenario colors on changed cells instantly (no reload).
 *  4. Scenario badge on HeatMap with "×" to return to baseline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { resolveScenarioLabel } from "../lib/resolve-scenario-label";
import { Beaker, X, TrendingDown, TrendingUp, Minus, Plus, Pencil, Trash2, Flame, Zap } from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";
import { currentBakuYear } from "@/lib/risk/periods";
import { orderCascade } from "../lib/cascade-order";
import { CRISIS_CATALOG, type CrisisCategory } from "@/lib/risk/crisis-catalog";
import { ScenarioFormModal, type ScenarioFormValues } from "./ScenarioFormModal";

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface IndicatorDelta {
  companyId: string;
  companyCode: string;
  companyName: string;
  code: string;
  baselineStatus: string;
  scenarioStatus: string;
  baselineValue: number;
  scenarioValue: number;
  changed: boolean;
  note?: string;
}

interface SimulationResult {
  scenarioCode: string;
  scenarioId: string;
  scenarioNameRu: string;
  scenarioNameEn: string;
  period: string;
  deltas: IndicatorDelta[];
  changed: number;
  unchanged: number;
  worsened: number;
  improved: number;
  deltaMap: Record<string, string>;
}

type SimState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; result: SimulationResult }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  green: "text-emerald-500",
  amber: "text-[#FFB800]",
  red: "text-red-500",
  unknown: "text-gray-400",
};

const STATUS_BG: Record<string, string> = {
  green: "bg-emerald-500/15 border-emerald-500/30",
  amber: "bg-[#FFB800]/15 border-[#FFB800]/30",
  red: "bg-red-500/15 border-red-500/30",
  unknown: "bg-white/[0.03] border-white/10",
};

const STATUS_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-[#FFB800]",
  red: "bg-red-500",
  unknown: "bg-white/5-foreground",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.unknown}`}
    />
  );
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1000
    ? v.toLocaleString("ru-RU", { maximumFractionDigits: 0 })
    : v.toFixed(2);
}

// ─── Crisis Brief (B2 drivers mode) helpers ────────────────────────────────────

type AiLang = "en" | "ru" | "az";

/** Composite-score band colour (matches CompanyTree/HeatMap thresholds). */
function bandColor(score: number | null): string {
  if (score == null) return "text-gray-400";
  if (score >= 67) return "text-emerald-500";
  if (score >= 34) return "text-[#FFB800]";
  return "text-red-500";
}

/** Tween a number from its previous value to `target` (cubic ease-out). */
function useCountTween(target: number | null, durationMs = 900): number | null {
  const [v, setV] = useState<number | null>(target);
  const fromRef = useRef<number | null>(target);
  useEffect(() => {
    if (target == null) {
      setV(null);
      return;
    }
    const from = fromRef.current ?? target;
    let raf = 0;
    let start = 0;
    const step = (t: number) => {
      if (start === 0) start = t;
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return v;
}

/** Holding composite swing: baseline (struck-through) → animated scenario score
 *  with a colour shift + ▼/▲ delta badge. The demo's headline number. */
function HoldingScoreSwing({ base, scen }: { base: number | null; scen: number | null }) {
  const t = useTranslations("terminal");
  const shown = useCountTween(scen);
  const drop = base != null && scen != null ? scen - base : null;
  return (
    <div className="flex items-baseline gap-3" data-testid="holding-score-swing">
      <span className="text-xs text-gray-400">{t("scenarioPanel.holdingComposite")}</span>
      <span className="text-base text-gray-400 line-through tabular-nums">{base ?? "—"}</span>
      <span className={`text-4xl font-bold tabular-nums transition-colors duration-500 ${bandColor(shown)}`}>
        {shown ?? "—"}
      </span>
      {drop != null && drop !== 0 && (
        <span className={`text-sm font-semibold ${drop < 0 ? "text-red-500" : "text-emerald-500"}`}>
          {drop < 0 ? "▼" : "▲"} {Math.abs(drop)}
        </span>
      )}
    </div>
  );
}

/** Reveal the narrative sentence-by-sentence (tag-safe — never splits markup). */
function NarrativeStream({ text }: { text: string }) {
  const lines = useMemo(() => text.split(/(?<=[.!?])\s+/).filter(Boolean), [text]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (lines.length === 0) return;
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      setShown(i);
      if (i >= lines.length) window.clearInterval(id);
    }, 420);
    return () => window.clearInterval(id);
  }, [lines]);
  return <p className="text-sm leading-relaxed whitespace-pre-line">{lines.slice(0, shown).join(" ")}</p>;
}

type BriefState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

// Scenario-code → crisis category (for the grouped selector). Scenarios not in
// the catalog (legacy multiplier scenarios) fall into the "Other" group.
const CATEGORY_BY_CODE = new Map<string, CrisisCategory>(CRISIS_CATALOG.map((s) => [s.code, s.category]));
const CATEGORY_ORDER: CrisisCategory[] = ["fx_macro", "commodity", "climate_agro", "geopolitics", "customers"];

// Active-parameters chip — surfaces the saved shock value(s) under the title so
// the user always sees the REAL target being simulated (the static name may say
// "$140" while the saved target is something else they edited). Mirrors the
// label maps in ScenarioFormModal; keys live under `scenarioForm.*`.
const SHOCK_METRIC_META: Record<string, { labelKey: string; unit: string }> = {
  AZN_USD: { labelKey: "metricAznUsd", unit: "AZN/USD" },
  BRENT_USD_BBL: { labelKey: "metricBrent", unit: "$/bbl" },
  FAO_SUGAR_INDEX: { labelKey: "metricFaoSugar", unit: "index" },
};
const SHOCK_LEVER_LABEL_KEY: Record<string, string> = {
  revenueShock: "leverRevenue",
  priceShock: "leverPrice",
  inputCostShock: "leverInputCost",
  fxShock: "leverFx",
  yieldShock: "leverYield",
};

/** Derive a flat list of active shock parameters from a scenario's overrides. */
export function readActiveShock(overrides: unknown):
  | { target: { metric: string; value: number } | null; levers: { key: string; pct: number }[]; costRigidity: number | null }
  | null {
  const shock = (overrides as { shock?: Record<string, unknown> } | null)?.shock;
  if (!shock || typeof shock !== "object") return null;
  const tgt = shock.target as { metric?: unknown; value?: unknown } | undefined;
  const target =
    tgt && typeof tgt.metric === "string" && typeof tgt.value === "number"
      ? { metric: tgt.metric, value: tgt.value }
      : null;
  const levers = Object.keys(SHOCK_LEVER_LABEL_KEY)
    .filter((k) => typeof shock[k] === "number")
    .map((k) => ({ key: k, pct: Number(((shock[k] as number) * 100).toFixed(2)) }));
  const costRigidity = typeof shock.costRigidity === "number" ? shock.costRigidity : null;
  if (!target && levers.length === 0 && costRigidity === null) return null;
  return { target, levers, costRigidity };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScenarioPanel() {
  const locale = useLocale();
  const t = useTranslations("terminal");
  const [open, setOpen] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [simState, setSimState] = useState<SimState>({ kind: "idle" });

  // CRUD form state
  const [formScenario, setFormScenario] = useState<ScenarioFormValues | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const activeScenarioCode = useTerminalStore((s) => s.activeScenarioCode);
  const setScenarioDelta = useTerminalStore((s) => s.setScenarioDelta);
  const clearScenarioDelta = useTerminalStore((s) => s.clearScenarioDelta);
  const activeScenarioLabel = useTerminalStore((s) => s.activeScenarioLabel);
  const scenarioBrief = useTerminalStore((s) => s.scenarioBrief);
  const setScenarioBrief = useTerminalStore((s) => s.setScenarioBrief);

  // Crisis Brief (B2 drivers mode) local state
  const [aiLang, setAiLang] = useState<AiLang>("ru");
  const [briefState, setBriefState] = useState<BriefState>({ kind: "idle" });
  const [cascadeNonce, setCascadeNonce] = useState(0);
  // Sequence-B run phases: while 'running' the panel collapses to a small
  // non-blocking pill so the HeatMap cascade is VISIBLE; the brief shows only
  // once the cascade completes ('done').
  const [cascadePhase, setCascadePhase] = useState<"none" | "running" | "done">("none");
  // Narrative loads separately (after the fast sim) so the cascade fires
  // immediately; this tracks its background fetch for the brief's narrative area.
  const [narrativeState, setNarrativeState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const fullDeltaMapRef = useRef<Record<string, string>>({});

  const period = useMemo(() => currentBakuYear(), []);

  // Open/close on global event
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-scenario", onOpen);
    return () => window.removeEventListener("terminal:open-scenario", onOpen);
  }, []);

  // Escape to close
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

  // Fetch scenario list on first open
  useEffect(() => {
    if (!open || scenarios !== null) return;
    let aborted = false;
    fetch("/api/scenarios")
      .then((r) => {
        if (!r.ok) throw new Error(`/api/scenarios ${r.status}`);
        return r.json();
      })
      .then((data: Scenario[]) => {
        if (!aborted) setScenarios(Array.isArray(data) ? data : []);
      })
      .catch((e: unknown) => {
        if (!aborted)
          setFetchError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      aborted = true;
    };
  }, [open, scenarios]);

  // Auto-select when SCN <code> GO fires
  const lastSyncedCode = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      lastSyncedCode.current = null;
      return;
    }
    if (!scenarios || !activeScenarioCode) return;
    if (lastSyncedCode.current === activeScenarioCode) return;
    const match = scenarios.find((s) => s.code === activeScenarioCode);
    if (match) {
      setSelectedId(match.id);
      setSimState({ kind: "idle" });
      lastSyncedCode.current = activeScenarioCode;
    }
  }, [open, scenarios, activeScenarioCode]);

  const selectedScenario = useMemo(
    () => scenarios?.find((s) => s.id === selectedId) ?? null,
    [scenarios, selectedId],
  );

  // Localized scenario description: catalog scenarios carry a translated copy
  // under terminal.scenarioDesc.<code>; user-created scenarios (no such key)
  // fall back to the single English `description` field stored in the DB.
  const selectedScenarioDesc = useMemo(() => {
    if (!selectedScenario) return null;
    const key = `scenarioDesc.${selectedScenario.code}`;
    return t.has(key as never) ? t(key as never) : selectedScenario.description ?? null;
  }, [selectedScenario, t]);

  // Group scenarios by crisis category for the selector (closes the flat-list
  // "только два параметра?" complaint). Catalog scenarios land in their
  // category; legacy multiplier scenarios fall into the "Other" group.
  const groupedScenarios = useMemo(() => {
    if (!scenarios) return null;
    const groups = new Map<string, Scenario[]>();
    for (const s of scenarios) {
      const key = (CATEGORY_BY_CODE.get(s.code) as string | undefined) ?? "__other__";
      const list = groups.get(key);
      if (list) list.push(s);
      else groups.set(key, [s]);
    }
    const ordered: Array<{ key: string; items: Scenario[] }> = [];
    for (const cat of CATEGORY_ORDER) {
      const items = groups.get(cat);
      if (items && items.length) ordered.push({ key: cat, items });
    }
    const other = groups.get("__other__");
    if (other && other.length) ordered.push({ key: "__other__", items: other });
    return ordered;
  }, [scenarios]);

  // ── Run simulation ──────────────────────────────────────────────────────────
  const handleSimulate = useCallback(async () => {
    if (!selectedScenario || simState.kind === "loading") return;
    setSimState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/scenarios/${selectedScenario.id}/simulate?period=${period}`,
      );
      if (res.status === 422) {
        setSimState({ kind: "unsupported" });
        return;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`simulate ${res.status}: ${body}`);
      }
      const result = (await res.json()) as SimulationResult;
      setSimState({ kind: "done", result });
    } catch (e: unknown) {
      setSimState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [selectedScenario, simState.kind, period]);

  // ── Apply delta to HeatMap ──────────────────────────────────────────────────
  const handleApplyToHeatMap = useCallback(() => {
    if (simState.kind !== "done") return;
    const { result } = simState;
    const map = new Map<string, string>(Object.entries(result.deltaMap));
    const label =
      locale === "ru"
        ? result.scenarioNameRu
        : result.scenarioNameEn;
    setScenarioDelta(map, label);
    setOpen(false);
  }, [simState, locale, setScenarioDelta]);

  // ── Drivers mode (Crisis Brief, B2) ─────────────────────────────────────────
  const runDrivers = useCallback(async () => {
    if (!selectedScenario || briefState.kind === "loading") return;
    const scenarioId = selectedScenario.id;
    setBriefState({ kind: "loading" });
    setCascadePhase("none");
    setNarrativeState("idle");
    clearScenarioDelta(); // clear any prior overlay + brief
    try {
      // FAST path: `narrative=0` skips the slow AI call so the cascade fires now.
      const res = await fetch(
        `/api/scenarios/${scenarioId}/simulate?mode=drivers&period=${period}&narrative=0`,
      );
      if (res.status === 422) {
        setBriefState({ kind: "unsupported" });
        return;
      }
      if (!res.ok) throw new Error(`simulate ${res.status}`);
      const data = await res.json();
      fullDeltaMapRef.current = (data.deltaMap ?? {}) as Record<string, string>;
      const brief = {
        scenarioCode: data.scenarioCode,
        holdingBaselineScore: data.holdingBaselineScore ?? null,
        holdingScenarioScore: data.holdingScenarioScore ?? null,
        financialHoldingBaselineScore: data.financialHoldingBaselineScore ?? null,
        financialHoldingScenarioScore: data.financialHoldingScenarioScore ?? null,
        byCompany: data.byCompany ?? [],
        narrative: null as string | null,
        mitigations: [] as string[],
        cascadeOrder: orderCascade(data.deltas ?? []),
        feedAnchors: data.feedAnchors ?? [],
      };
      setScenarioBrief(brief);
      setBriefState({ kind: "done" });
      // Sequence B: collapse to the pill + play the cascade on the visible map;
      // the brief reveals when the cascade effect flips cascadePhase → 'done'.
      setCascadePhase("running");
      setCascadeNonce((n) => n + 1);

      // Background: fetch the narrative from the already-computed summary and
      // fill it into the brief when it arrives (cascade + swing don't wait).
      setNarrativeState("loading");
      void fetch(`/api/scenarios/${scenarioId}/narrative`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language: aiLang,
          holdingBaselineScore: data.holdingBaselineScore ?? null,
          holdingScenarioScore: data.holdingScenarioScore ?? null,
          worstHit: data.worstHit ?? [],
          changed: data.changed ?? 0,
          worsened: data.worsened ?? 0,
          improved: data.improved ?? 0,
          assumptionNote: data.assumptionNote ?? null,
        }),
      })
        .then((r) => (r.ok ? r.json() : { narrative: null, mitigations: [], narrativeError: `narrative ${r.status}` }))
        .then((nd: { narrative?: string | null; mitigations?: string[] }) => {
          setScenarioBrief({ ...brief, narrative: nd.narrative ?? null, mitigations: nd.mitigations ?? [] });
          setNarrativeState(nd.narrative ? "done" : "error");
        })
        .catch(() => setNarrativeState("error"));
    } catch (e: unknown) {
      setBriefState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [selectedScenario, briefState.kind, period, aiLang, clearScenarioDelta, setScenarioBrief]);

  // Staggered worst-first cascade — reveal the overlay deltaMap incrementally so
  // the HeatMap visibly "reacts". One run per cascadeNonce; cleans up its timer.
  useEffect(() => {
    if (cascadeNonce === 0) return;
    const brief = scenarioBrief;
    if (!brief) return;
    const order = brief.cascadeOrder;
    // Nothing flips → skip straight to the brief.
    if (order.length === 0) {
      setCascadePhase("done");
      return;
    }
    const full = fullDeltaMapRef.current;
    // Cascade is now front-and-centre (map visible) — make it deliberate:
    // ~1–2s total, but never a sub-second flash for a few-cell scenario.
    const perCell = Math.min(260, Math.max(60, Math.round(1900 / order.length)));
    let i = 0;
    let timer = 0;
    setScenarioDelta(new Map(), brief.scenarioCode);
    const tick = () => {
      i++;
      const partial = new Map<string, string>();
      for (let k = 0; k < i && k < order.length; k++) {
        const key = order[k];
        if (full[key]) partial.set(key, full[key]);
      }
      setScenarioDelta(partial, brief.scenarioCode);
      if (i < order.length) timer = window.setTimeout(tick, perCell);
      else setCascadePhase("done"); // cascade finished → reveal the brief
    };
    timer = window.setTimeout(tick, perCell);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cascadeNonce]);

  // ── CRUD helpers ─────────────────────────────────────────────────────────────
  const openCreateForm = useCallback(() => {
    setFormScenario(undefined);
    setFormOpen(true);
  }, []);

  const openEditForm = useCallback((s: Scenario) => {
    setFormScenario({
      id: s.id,
      code: s.code,
      nameEn: s.nameEn,
      nameRu: s.nameRu ?? "",
      description: s.description ?? "",
      overrides: JSON.stringify(s.overrides, null, 2),
    });
    setFormOpen(true);
  }, []);

  const handleFormSaved = useCallback(
    (saved: { id: string; code: string; nameEn: string }) => {
      // Refresh the scenario list so edits are reflected immediately.
      setScenarios(null);
      // Re-select the saved scenario so the panel stays focused.
      setSelectedId(saved.id);
      setSimState({ kind: "idle" });
    },
    [],
  );

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm(t("scenarioPanel.deleteConfirm"))) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/scenarios/${id}`, { method: "DELETE" });
      if (res.ok) {
        setScenarios((prev) => prev?.filter((s) => s.id !== id) ?? null);
        if (selectedId === id) {
          setSelectedId(null);
          setSimState({ kind: "idle" });
        }
      }
    } finally {
      setDeletingId(null);
    }
  }, [selectedId, t]);

  if (!open) return null;

  const changedDeltas =
    simState.kind === "done"
      ? simState.result.deltas.filter((d) => d.changed)
      : [];

  // Drivers mode is available when the selected scenario carries a `shock` block.
  const selectedHasShock = !!(selectedScenario?.overrides as { shock?: unknown } | null)?.shock;
  // Worst-hit companies (largest composite drop) for the brief panel.
  const worstHitCompanies =
    scenarioBrief?.byCompany
      .filter((b) => b.baselineScore != null && b.scenarioScore != null && b.scenarioScore < b.baselineScore)
      .sort((a, b) => a.scenarioScore! - a.baselineScore! - (b.scenarioScore! - b.baselineScore!))
      .slice(0, 4) ?? [];

  return (
  <>
    {cascadePhase === "running" ? (
      // Sequence B — non-blocking pill; the HeatMap cascade plays in full view.
      <div
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border border-red-500/50 bg-[#0a0e1f]/95 px-5 py-2.5 text-sm font-semibold text-red-300 shadow-2xl"
        data-testid="crisis-cascading"
      >
        <Flame size={15} className="animate-pulse" aria-hidden="true" />
        {t("scenarioPanel.cascadeRunning")}
      </div>
    ) : (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("scenarioPanel.dialogAria")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-5xl max-h-[88vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0A0E27] text-gray-200 shadow-2xl shadow-black/60 ring-1 ring-white/5">
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-gradient-to-b from-[#0E1430] to-[#0A0E27] px-6 py-3.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#FFB800]/30 bg-[#FFB800]/10">
              <Beaker size={16} className="text-[#FFB800]" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-gray-50">
                {t("scenarioPanel.title")}
              </h2>
              <p className="text-[11px] text-gray-500">
                {t("scenarioPanel.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeScenarioLabel && (
              <button
                type="button"
                onClick={() => { clearScenarioDelta(); setCascadePhase("none"); setBriefState({ kind: "idle" }); setNarrativeState("idle"); }}
                className="rounded border border-red-500/30 bg-red-500/10 text-red-400 px-2 py-1 text-xs hover:bg-red-500/20"
              >
                {t("scenarioPanel.reset", { label: activeScenarioLabel })}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("scenarioPanel.close")}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[264px_1fr] gap-5 px-6 py-5">
          {/* Scenario list */}
          <aside className="md:border-r md:border-white/10 md:pr-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-mono uppercase tracking-wider text-gray-400">
                {t("scenarioPanel.scenariosCount", { count: scenarios?.length ?? 0 })}
              </h3>
              <button
                type="button"
                onClick={openCreateForm}
                aria-label={t("scenarioPanel.createAria")}
                data-testid="scenario-create-button"
                className="flex items-center gap-0.5 rounded border border-[#FFB800]/40 bg-[#FFB800]/8 text-[#FFB800] px-1.5 py-0.5 text-[10px] hover:bg-[#FFB800]/20"
              >
                <Plus size={10} aria-hidden="true" />
                {t("scenarioPanel.new")}
              </button>
            </div>
            {scenarios === null && !fetchError && (
              <p className="text-sm text-gray-400" data-testid="scenarios-loading">{t("scenarioPanel.loading")}</p>
            )}
            {fetchError && (
              <p className="text-xs text-red-500 mt-2" data-testid="scenarios-fetch-error">{fetchError}</p>
            )}
            {scenarios !== null && scenarios.length === 0 && (
              <p className="text-sm text-gray-400" data-testid="scenarios-empty">{t("scenarioPanel.empty")}</p>
            )}
            {groupedScenarios && groupedScenarios.length > 0 && (
              <div className="space-y-3">
                {groupedScenarios.map((group) => (
                  <div key={group.key}>
                    <h4 className="text-[10px] font-mono uppercase tracking-wider text-gray-400/70 mb-1 px-0.5">
                      {t(`scenarioPanel.category.${group.key}` as never)}
                    </h4>
                    <ul className="space-y-1">
                      {group.items.map((s) => {
                        const isSelected = s.id === selectedId;
                        return (
                          <li key={s.id} className="group relative">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedId(s.id);
                                setSimState({ kind: "idle" });
                                setBriefState({ kind: "idle" });
                                setCascadePhase("none");
                                setNarrativeState("idle");
                              }}
                              className={`w-full text-left pl-3 pr-14 py-2 rounded-md border text-xs font-mono transition-all ${
                                isSelected
                                  ? "border-[#FFB800]/50 bg-[#FFB800]/[0.12] text-[#FFB800] shadow-[inset_3px_0_0_0_#FFB800]"
                                  : "border-white/10 bg-white/[0.02] text-gray-300 hover:border-white/25 hover:bg-white/[0.06]"
                              }`}
                              data-testid={`scenario-row-${s.code}`}
                            >
                              <div className="font-semibold tracking-tight">{s.code}</div>
                              <div className={`text-[10px] mt-0.5 line-clamp-2 ${isSelected ? "text-[#FFB800]/70" : "text-gray-500"}`}>
                                {resolveScenarioLabel(s, locale)}
                              </div>
                            </button>
                            {/* Edit / delete icons — shown on hover */}
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openEditForm(s); }}
                                aria-label={t("scenarioPanel.editAria", { code: s.code })}
                                data-testid={`scenario-edit-${s.code}`}
                                className="rounded p-1 hover:bg-white/10 text-gray-400 hover:text-gray-100"
                              >
                                <Pencil size={10} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void handleDelete(s.id); }}
                                disabled={deletingId === s.id}
                                aria-label={t("scenarioPanel.deleteAria", { code: s.code })}
                                data-testid={`scenario-delete-${s.code}`}
                                className="rounded p-1 hover:bg-red-500/10 text-gray-400 hover:text-red-400 disabled:opacity-40"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </aside>

          {/* Detail + simulation */}
          <section>
            {selectedScenario === null ? (
              <p className="text-sm text-gray-400">
                {scenarios && scenarios.length > 0
                  ? t("scenarioPanel.selectLeft")
                  : t("scenarioPanel.noneAvailable")}
              </p>
            ) : (
              <div className="space-y-4">
                {/* Scenario header */}
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-gray-50">
                    {resolveScenarioLabel(selectedScenario, locale)}
                  </h3>
                  <p className="mt-1 inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-gray-400 font-mono">
                    {t("scenarioPanel.codePeriod", { code: selectedScenario.code, period })}
                  </p>
                  {(() => {
                    const active = readActiveShock(selectedScenario.overrides);
                    if (!active) return null;
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="active-shock-params">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
                          {t("scenarioPanel.activeParams")}
                        </span>
                        {active.target && (
                          <span className="inline-flex items-baseline gap-1 rounded-md border border-[#FFB800]/40 bg-[#FFB800]/10 px-2 py-0.5 text-xs text-gray-200">
                            {SHOCK_METRIC_META[active.target.metric]
                              ? t(`scenarioForm.${SHOCK_METRIC_META[active.target.metric].labelKey}` as never)
                              : active.target.metric}
                            <span className="text-gray-500">→</span>
                            <b className="tabular-nums text-[#FFB800]" data-testid="active-shock-target">{active.target.value}</b>
                            <span className="text-[10px] text-gray-500">{SHOCK_METRIC_META[active.target.metric]?.unit ?? ""}</span>
                          </span>
                        )}
                        {active.levers.map((lev) => (
                          <span key={lev.key} className="inline-flex items-baseline gap-1 rounded-md border border-[#FFB800]/40 bg-[#FFB800]/10 px-2 py-0.5 text-xs text-gray-200">
                            {t(`scenarioForm.${SHOCK_LEVER_LABEL_KEY[lev.key]}` as never)}
                            <b className={`tabular-nums ${lev.pct < 0 ? "text-[#FF6B7A]" : "text-[#00D4AA]"}`}>
                              {lev.pct > 0 ? "+" : ""}{lev.pct}%
                            </b>
                          </span>
                        ))}
                        {active.costRigidity !== null && (
                          <span className="inline-flex items-baseline gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-xs text-gray-300">
                            {t("scenarioForm.costRigidityLabel")}
                            <b className="tabular-nums text-gray-100">{active.costRigidity}</b>
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {selectedScenarioDesc && (
                  <p className="rounded-md border-l-2 border-[#FFB800]/40 bg-white/[0.02] py-2 pl-3 pr-2 text-sm leading-relaxed text-gray-300">
                    {selectedScenarioDesc}
                  </p>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  {selectedHasShock && (
                    <button
                      type="button"
                      onClick={() => void runDrivers()}
                      disabled={briefState.kind === "loading"}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#FF4757] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-[#FF4757]/25 transition-all hover:bg-[#ff5b69] hover:shadow-[#FF4757]/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                      data-testid="scenario-run-crisis"
                    >
                      <Flame size={14} aria-hidden="true" className={briefState.kind === "loading" ? "animate-pulse" : ""} />
                      {briefState.kind === "loading" ? t("scenarioPanel.simulatingCrisis") : t("scenarioPanel.runCrisis")}
                    </button>
                  )}
                  {selectedHasShock && (
                    <div className="inline-flex items-center gap-1.5 text-xs" role="group" aria-label={t("scenarioPanel.aiLangAria")}>
                      <span className="text-gray-500">AI</span>
                      <div className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.03] p-0.5">
                        {(["ru", "en", "az"] as AiLang[]).map((lng) => (
                          <button
                            key={lng}
                            type="button"
                            onClick={() => setAiLang(lng)}
                            className={`rounded px-2 py-0.5 uppercase font-medium transition-colors ${
                              aiLang === lng
                                ? "bg-[#FFB800]/20 text-[#FFB800]"
                                : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                            }`}
                            data-testid={`scenario-ai-lang-${lng}`}
                          >
                            {lng}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleSimulate}
                    disabled={simState.kind === "loading"}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="scenario-simulate-button"
                  >
                    <Zap size={13} aria-hidden="true" className="text-[#FFB800]" />
                    {simState.kind === "loading" ? t("scenarioPanel.simulating") : t("scenarioPanel.quickCalc")}
                  </button>

                  {simState.kind === "done" && (
                    <button
                      type="button"
                      onClick={handleApplyToHeatMap}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#00D4AA]/50 bg-[#00D4AA]/10 px-4 py-2 text-sm font-medium text-[#00D4AA] transition-colors hover:bg-[#00D4AA]/20"
                      data-testid="scenario-apply-heatmap"
                    >
                      {t("scenarioPanel.applyHeatMap")}
                    </button>
                  )}
                </div>

                {/* ── Crisis Brief (drivers mode) ── */}
                {briefState.kind === "unsupported" && (
                  <p className="text-sm text-amber-500">
                    {t.rich("scenarioPanel.unsupportedShock", { code: (c) => <code>{c}</code> })}
                  </p>
                )}
                {briefState.kind === "error" && (
                  <p className="text-sm text-red-500" data-testid="scenario-crisis-error">
                    {t("scenarioPanel.crisisError", { message: briefState.message })}
                  </p>
                )}
                {scenarioBrief && scenarioBrief.scenarioCode === selectedScenario.code && briefState.kind === "done" && (
                  <div
                    className="space-y-4 rounded-lg border border-red-500/20 bg-red-500/[0.03] p-4"
                    data-testid="crisis-brief-panel"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <HoldingScoreSwing
                          base={scenarioBrief.holdingBaselineScore}
                          scen={scenarioBrief.holdingScenarioScore}
                        />
                        {scenarioBrief.financialHoldingScenarioScore != null && (
                          <div className="flex items-baseline gap-3" data-testid="financial-stress-swing">
                            <span className="text-xs text-gray-400">{t("scenarioPanel.financialHealth")}</span>
                            <span className="text-sm text-gray-400 line-through tabular-nums">
                              {scenarioBrief.financialHoldingBaselineScore ?? "—"}
                            </span>
                            <span
                              className={`text-2xl font-bold tabular-nums ${bandColor(scenarioBrief.financialHoldingScenarioScore)}`}
                            >
                              {scenarioBrief.financialHoldingScenarioScore}
                            </span>
                            {scenarioBrief.financialHoldingBaselineScore != null && (
                              <span className="text-xs font-semibold text-red-500">
                                ▼{" "}
                                {Math.abs(
                                  scenarioBrief.financialHoldingScenarioScore -
                                    scenarioBrief.financialHoldingBaselineScore,
                                )}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => { clearScenarioDelta(); setCascadePhase("none"); setBriefState({ kind: "idle" }); setNarrativeState("idle"); }}
                        className="rounded border border-white/10 px-3 py-1 text-xs text-gray-400 hover:bg-white/5 shrink-0"
                        data-testid="crisis-revert"
                      >
                        {t("scenarioPanel.baseScenario")}
                      </button>
                    </div>

                    {/* Live-feed anchors (Phase 2) — "from the real current level" */}
                    {scenarioBrief.feedAnchors.length > 0 && (
                      <div className="flex flex-wrap gap-2" data-testid="crisis-feed-anchors">
                        {scenarioBrief.feedAnchors.map((a) => (
                          <span
                            key={a.label}
                            className="inline-flex items-baseline gap-1.5 rounded border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-xs"
                            title={`${t("scenarioPanel.sourceTitle", { asOf: a.asOf })}${a.stale ? t("scenarioPanel.staleSuffix") : ""}`}
                          >
                            <span className="text-sky-300/90">📊 {a.label}</span>
                            <span className="text-gray-400 tabular-nums">{a.currentValue}</span>
                            <span className="text-gray-400">→</span>
                            <span className="font-semibold tabular-nums">{a.scenarioValue}</span>
                            <span className="text-[10px] text-gray-400">{a.unit}</span>
                            <span className={`text-[10px] ${a.stale ? "text-amber-500" : "text-emerald-500/70"}`}>
                              {a.stale ? `⚠ ${a.asOf}` : `✓ ${a.asOf}`}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Worst-hit companies */}
                    {worstHitCompanies.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {worstHitCompanies.map((c) => (
                          <span
                            key={c.companyId}
                            className="inline-flex items-baseline gap-1.5 rounded border border-red-500/25 bg-red-500/10 px-2 py-1 text-xs"
                          >
                            <span className="font-mono text-gray-400">{c.companyCode}</span>
                            <span className="text-gray-400 line-through tabular-nums">{c.baselineScore}</span>
                            <span className={`font-semibold tabular-nums ${bandColor(c.scenarioScore)}`}>
                              {c.scenarioScore}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* AI narrative + mitigations */}
                    {scenarioBrief.narrative ? (
                      <div className="space-y-3">
                        <NarrativeStream text={scenarioBrief.narrative} />
                        {scenarioBrief.mitigations.length > 0 && (
                          <div>
                            <h4 className="text-xs font-mono uppercase tracking-wider text-gray-400 mb-1.5">
                              {t("scenarioPanel.measures")}
                            </h4>
                            <ul className="space-y-1">
                              {scenarioBrief.mitigations.map((m, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm">
                                  <span className="text-[#FFB800] mt-0.5">→</span>
                                  <span>{m}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : narrativeState === "loading" ? (
                      <p className="text-sm text-sky-300/80 italic animate-pulse" data-testid="crisis-narrative-loading">
                        {t("scenarioPanel.briefGenerating")}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 italic" data-testid="crisis-narrative-unavailable">
                        {t("scenarioPanel.narrativeUnavailable")}
                      </p>
                    )}
                  </div>
                )}

                {/* Simulation results */}
                {simState.kind === "unsupported" && (
                  <p className="text-sm text-amber-500">
                    {t("scenarioPanel.unsupportedSim")}
                  </p>
                )}
                {simState.kind === "error" && (
                  <p className="text-sm text-red-500" data-testid="scenario-apply-error">
                    {t("scenarioPanel.error", { message: simState.message })}
                  </p>
                )}

                {simState.kind === "done" && (
                  <div className="space-y-3">
                    {/* Summary chips */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded border border-white/10 bg-white/5">
                        {t.rich("scenarioPanel.checked", { count: simState.result.deltas.length + simState.result.unchanged, strong: (c) => <strong>{c}</strong> })}
                      </span>
                      <span className="px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-400">
                        <TrendingDown size={10} className="inline mr-1" />
                        {t.rich("scenarioPanel.worsened", { count: simState.result.worsened, strong: (c) => <strong>{c}</strong> })}
                      </span>
                      {simState.result.improved > 0 && (
                        <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                          <TrendingUp size={10} className="inline mr-1" />
                          {t.rich("scenarioPanel.improved", { count: simState.result.improved, strong: (c) => <strong>{c}</strong> })}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded border border-white/10 bg-white/[0.03] text-gray-400">
                        <Minus size={10} className="inline mr-1" />
                        {t.rich("scenarioPanel.unchangedCount", { count: simState.result.unchanged, strong: (c) => <strong>{c}</strong> })}
                      </span>
                    </div>

                    {/* Delta table */}
                    {changedDeltas.length === 0 ? (
                      <p className="text-sm text-gray-400">
                        {t("scenarioPanel.noColorChange")}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-white/10 text-gray-400">
                              <th className="text-left py-1.5 pr-3 font-medium">{t("scenarioPanel.colCompany")}</th>
                              <th className="text-left py-1.5 pr-3 font-medium">{t("scenarioPanel.colIndicator")}</th>
                              <th className="text-left py-1.5 pr-3 font-medium">{t("scenarioPanel.colBaseline")}</th>
                              <th className="text-left py-1.5 pr-3 font-medium">{t("scenarioPanel.colScenario")}</th>
                              <th className="text-right py-1.5 pr-3 font-medium">{t("scenarioPanel.colValueWas")}</th>
                              <th className="text-right py-1.5 font-medium">{t("scenarioPanel.colValueNow")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {changedDeltas.map((d, i) => {
                              const worsened =
                                (d.scenarioStatus === "red" && d.baselineStatus !== "red") ||
                                (d.scenarioStatus === "amber" && d.baselineStatus === "green");
                              return (
                                <tr
                                  key={i}
                                  className={`border-b border-white/[0.06] ${
                                    worsened
                                      ? "bg-red-500/5"
                                      : "bg-emerald-500/5"
                                  }`}
                                >
                                  <td className="py-1.5 pr-3 font-mono text-[10px] text-gray-400">
                                    {d.companyCode}
                                  </td>
                                  <td className="py-1.5 pr-3 font-mono text-[10px]">
                                    {d.code}
                                    {d.note && (
                                      <div className="text-gray-400 opacity-70 text-[9px]">
                                        {d.note}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <span
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${STATUS_BG[d.baselineStatus] ?? STATUS_BG.unknown}`}
                                    >
                                      <StatusDot status={d.baselineStatus} />
                                      <span className={STATUS_COLOR[d.baselineStatus] ?? ""}>
                                        {d.baselineStatus}
                                      </span>
                                    </span>
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <span
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${STATUS_BG[d.scenarioStatus] ?? STATUS_BG.unknown}`}
                                    >
                                      <StatusDot status={d.scenarioStatus} />
                                      <span className={STATUS_COLOR[d.scenarioStatus] ?? ""}>
                                        {d.scenarioStatus}
                                      </span>
                                      {worsened ? (
                                        <TrendingDown size={9} className="ml-0.5 text-red-400" />
                                      ) : (
                                        <TrendingUp size={9} className="ml-0.5 text-emerald-400" />
                                      )}
                                    </span>
                                  </td>
                                  <td className="py-1.5 pr-3 text-right font-mono text-gray-400">
                                    {fmt(d.baselineValue)}
                                  </td>
                                  <td className="py-1.5 text-right font-mono">
                                    <span className={worsened ? "text-red-400" : "text-emerald-400"}>
                                      {fmt(d.scenarioValue)}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
    )}

    {/* Create / edit form — rendered above the panel (z-[60]) */}
    {formOpen && (
      <ScenarioFormModal
        initial={formScenario}
        onClose={() => setFormOpen(false)}
        onSaved={handleFormSaved}
      />
    )}
  </>
  );
}
