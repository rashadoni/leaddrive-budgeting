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
import { useLocale } from "next-intl";
import { resolveScenarioLabel } from "../lib/resolve-scenario-label";
import { Beaker, X, TrendingDown, TrendingUp, Minus, Plus, Pencil, Trash2, Flame } from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";
import { currentBakuYear } from "@/lib/risk/periods";
import { orderCascade } from "../lib/cascade-order";
import { CRISIS_CATALOG, CRISIS_CATEGORY_LABEL_RU, type CrisisCategory } from "@/lib/risk/crisis-catalog";
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
  unknown: "text-muted-foreground",
};

const STATUS_BG: Record<string, string> = {
  green: "bg-emerald-500/15 border-emerald-500/30",
  amber: "bg-[#FFB800]/15 border-[#FFB800]/30",
  red: "bg-red-500/15 border-red-500/30",
  unknown: "bg-muted/20 border-border",
};

const STATUS_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-[#FFB800]",
  red: "bg-red-500",
  unknown: "bg-muted-foreground",
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
  if (score == null) return "text-muted-foreground";
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
  const shown = useCountTween(scen);
  const drop = base != null && scen != null ? scen - base : null;
  return (
    <div className="flex items-baseline gap-3" data-testid="holding-score-swing">
      <span className="text-xs text-muted-foreground">Композит холдинга</span>
      <span className="text-base text-muted-foreground line-through tabular-nums">{base ?? "—"}</span>
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
const OTHER_GROUP_LABEL = "🧪 Другие (множитель)";

// ─── Component ────────────────────────────────────────────────────────────────

export function ScenarioPanel() {
  const locale = useLocale();
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
    const ordered: Array<{ key: string; label: string; items: Scenario[] }> = [];
    for (const cat of CATEGORY_ORDER) {
      const items = groups.get(cat);
      if (items && items.length) ordered.push({ key: cat, label: CRISIS_CATEGORY_LABEL_RU[cat], items });
    }
    const other = groups.get("__other__");
    if (other && other.length) ordered.push({ key: "__other__", label: OTHER_GROUP_LABEL, items: other });
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
    setBriefState({ kind: "loading" });
    clearScenarioDelta(); // clear any prior overlay + brief
    try {
      const res = await fetch(
        `/api/scenarios/${selectedScenario.id}/simulate?mode=drivers&period=${period}&lang=${aiLang}`,
      );
      if (res.status === 422) {
        setBriefState({ kind: "unsupported" });
        return;
      }
      if (!res.ok) throw new Error(`simulate ${res.status}`);
      const data = await res.json();
      fullDeltaMapRef.current = (data.deltaMap ?? {}) as Record<string, string>;
      setScenarioBrief({
        scenarioCode: data.scenarioCode,
        holdingBaselineScore: data.holdingBaselineScore ?? null,
        holdingScenarioScore: data.holdingScenarioScore ?? null,
        financialHoldingBaselineScore: data.financialHoldingBaselineScore ?? null,
        financialHoldingScenarioScore: data.financialHoldingScenarioScore ?? null,
        byCompany: data.byCompany ?? [],
        narrative: data.narrative ?? null,
        mitigations: data.mitigations ?? [],
        cascadeOrder: orderCascade(data.deltas ?? []),
        feedAnchors: data.feedAnchors ?? [],
      });
      setBriefState({ kind: "done" });
      setCascadeNonce((n) => n + 1);
    } catch (e: unknown) {
      setBriefState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [selectedScenario, briefState.kind, period, aiLang, clearScenarioDelta, setScenarioBrief]);

  // Staggered worst-first cascade — reveal the overlay deltaMap incrementally so
  // the HeatMap visibly "reacts". One run per cascadeNonce; cleans up its timer.
  useEffect(() => {
    if (cascadeNonce === 0) return;
    const brief = scenarioBrief;
    if (!brief || brief.cascadeOrder.length === 0) return;
    const order = brief.cascadeOrder;
    const full = fullDeltaMapRef.current;
    const perCell = Math.min(120, Math.max(35, Math.round(1800 / order.length)));
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
    if (!confirm("Удалить этот сценарий? Он будет скрыт, но данные сохранятся.")) return;
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
  }, [selectedId]);

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Сценарный анализ"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-5xl max-h-[88vh] overflow-y-auto rounded-lg border border-input bg-background shadow-2xl">
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <Beaker size={16} className="text-[#FFB800]" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Сценарный анализ (What-if)
              </h2>
              <p className="text-xs text-muted-foreground">
                Живое моделирование — выбери сценарий → Смоделировать → Применить к HeatMap
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeScenarioLabel && (
              <button
                type="button"
                onClick={() => clearScenarioDelta()}
                className="rounded border border-red-500/30 bg-red-500/10 text-red-400 px-2 py-1 text-xs hover:bg-red-500/20"
              >
                Сбросить: {activeScenarioLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Закрыть"
              className="rounded border border-input px-2 py-1 text-sm hover:bg-muted/50"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 px-6 py-4">
          {/* Scenario list */}
          <aside>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Сценарии ({scenarios?.length ?? 0})
              </h3>
              <button
                type="button"
                onClick={openCreateForm}
                aria-label="Создать сценарий"
                data-testid="scenario-create-button"
                className="flex items-center gap-0.5 rounded border border-[#FFB800]/40 bg-[#FFB800]/8 text-[#FFB800] px-1.5 py-0.5 text-[10px] hover:bg-[#FFB800]/20"
              >
                <Plus size={10} aria-hidden="true" />
                Новый
              </button>
            </div>
            {scenarios === null && !fetchError && (
              <p className="text-sm text-muted-foreground" data-testid="scenarios-loading">Загрузка…</p>
            )}
            {fetchError && (
              <p className="text-xs text-red-500 mt-2" data-testid="scenarios-fetch-error">{fetchError}</p>
            )}
            {scenarios !== null && scenarios.length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="scenarios-empty">Сценарии не найдены</p>
            )}
            {groupedScenarios && groupedScenarios.length > 0 && (
              <div className="space-y-3">
                {groupedScenarios.map((group) => (
                  <div key={group.key}>
                    <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1 px-0.5">
                      {group.label}
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
                              }}
                              className={`w-full text-left px-2 py-1.5 pr-14 rounded border text-xs font-mono transition-colors ${
                                isSelected
                                  ? "border-[#FFB800] bg-[#FFB800]/10 text-[#FFB800]"
                                  : "border-input hover:bg-muted/50 text-muted-foreground"
                              }`}
                              data-testid={`scenario-row-${s.code}`}
                            >
                              <div className="font-semibold">{s.code}</div>
                              <div className="opacity-70 text-[10px] mt-0.5 line-clamp-2">
                                {resolveScenarioLabel(s, locale)}
                              </div>
                            </button>
                            {/* Edit / delete icons — shown on hover */}
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openEditForm(s); }}
                                aria-label={`Редактировать ${s.code}`}
                                data-testid={`scenario-edit-${s.code}`}
                                className="rounded p-1 hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                              >
                                <Pencil size={10} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void handleDelete(s.id); }}
                                disabled={deletingId === s.id}
                                aria-label={`Удалить ${s.code}`}
                                data-testid={`scenario-delete-${s.code}`}
                                className="rounded p-1 hover:bg-red-500/10 text-muted-foreground hover:text-red-400 disabled:opacity-40"
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
              <p className="text-sm text-muted-foreground">
                {scenarios && scenarios.length > 0
                  ? "Выбери сценарий слева"
                  : "Нет доступных сценариев"}
              </p>
            ) : (
              <div className="space-y-4">
                {/* Scenario header */}
                <div>
                  <h3 className="text-base font-semibold">
                    {resolveScenarioLabel(selectedScenario, locale)}
                  </h3>
                  <p className="text-xs text-muted-foreground font-mono">
                    {selectedScenario.code} · период: {period}
                  </p>
                </div>
                {selectedScenario.description && (
                  <p className="text-sm text-muted-foreground">
                    {selectedScenario.description}
                  </p>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {selectedHasShock && (
                    <button
                      type="button"
                      onClick={() => void runDrivers()}
                      disabled={briefState.kind === "loading"}
                      className="inline-flex items-center gap-1.5 rounded border border-red-500/50 bg-red-500/15 text-red-300 px-4 py-1.5 text-sm font-semibold hover:bg-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="scenario-run-crisis"
                    >
                      <Flame size={14} aria-hidden="true" />
                      {briefState.kind === "loading" ? "Моделирование кризиса…" : "Запустить кризис"}
                    </button>
                  )}
                  {selectedHasShock && (
                    <div className="inline-flex items-center gap-1 text-xs" role="group" aria-label="Язык AI-нарратива">
                      <span className="text-muted-foreground">AI:</span>
                      {(["ru", "en", "az"] as AiLang[]).map((lng) => (
                        <button
                          key={lng}
                          type="button"
                          onClick={() => setAiLang(lng)}
                          className={`rounded px-1.5 py-0.5 uppercase ${
                            aiLang === lng
                              ? "bg-[#FFB800]/20 text-[#FFB800] border border-[#FFB800]/40"
                              : "border border-input text-muted-foreground hover:bg-muted/50"
                          }`}
                          data-testid={`scenario-ai-lang-${lng}`}
                        >
                          {lng}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleSimulate}
                    disabled={simState.kind === "loading"}
                    className="rounded border border-input bg-muted/20 text-muted-foreground px-3 py-1.5 text-xs hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="scenario-simulate-button"
                  >
                    {simState.kind === "loading" ? "Моделирование…" : "⚡ Быстрый расчёт"}
                  </button>

                  {simState.kind === "done" && (
                    <button
                      type="button"
                      onClick={handleApplyToHeatMap}
                      className="rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 px-4 py-1.5 text-sm font-medium hover:bg-emerald-500/20"
                      data-testid="scenario-apply-heatmap"
                    >
                      ✓ Применить к HeatMap
                    </button>
                  )}
                </div>

                {/* ── Crisis Brief (drivers mode) ── */}
                {briefState.kind === "unsupported" && (
                  <p className="text-sm text-amber-500">
                    ⚠ У этого сценария нет блока <code>shock</code> — запусти «Быстрый расчёт» (старый множитель).
                  </p>
                )}
                {briefState.kind === "error" && (
                  <p className="text-sm text-red-500" data-testid="scenario-crisis-error">
                    Ошибка моделирования: {briefState.message}
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
                            <span className="text-xs text-muted-foreground">Финансовое здоровье</span>
                            <span className="text-sm text-muted-foreground line-through tabular-nums">
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
                        onClick={() => clearScenarioDelta()}
                        className="rounded border border-input px-3 py-1 text-xs text-muted-foreground hover:bg-muted/50 shrink-0"
                        data-testid="crisis-revert"
                      >
                        ← Базовый сценарий
                      </button>
                    </div>

                    {/* Live-feed anchors (Phase 2) — "from the real current level" */}
                    {scenarioBrief.feedAnchors.length > 0 && (
                      <div className="flex flex-wrap gap-2" data-testid="crisis-feed-anchors">
                        {scenarioBrief.feedAnchors.map((a) => (
                          <span
                            key={a.label}
                            className="inline-flex items-baseline gap-1.5 rounded border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-xs"
                            title={`Источник: ${a.asOf}${a.stale ? " (устарело)" : ""}`}
                          >
                            <span className="text-sky-300/90">📊 {a.label}</span>
                            <span className="text-muted-foreground tabular-nums">{a.currentValue}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-semibold tabular-nums">{a.scenarioValue}</span>
                            <span className="text-[10px] text-muted-foreground">{a.unit}</span>
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
                            <span className="font-mono text-muted-foreground">{c.companyCode}</span>
                            <span className="text-muted-foreground line-through tabular-nums">{c.baselineScore}</span>
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
                            <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                              Меры
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
                    ) : (
                      <p className="text-xs text-muted-foreground italic" data-testid="crisis-narrative-unavailable">
                        AI-нарратив недоступен — см. изменения индикаторов ниже.
                      </p>
                    )}
                  </div>
                )}

                {/* Simulation results */}
                {simState.kind === "unsupported" && (
                  <p className="text-sm text-amber-500">
                    ⚠ Этот сценарий не поддерживает симуляцию (нет поля adjustments).
                    Обновите сценарий командой seed-scenarios.
                  </p>
                )}
                {simState.kind === "error" && (
                  <p className="text-sm text-red-500" data-testid="scenario-apply-error">
                    Ошибка: {simState.message}
                  </p>
                )}

                {simState.kind === "done" && (
                  <div className="space-y-3">
                    {/* Summary chips */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded border border-border bg-muted/30">
                        Проверено: <strong>{simState.result.deltas.length + simState.result.unchanged}</strong> индикаторов
                      </span>
                      <span className="px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-400">
                        <TrendingDown size={10} className="inline mr-1" />
                        Ухудшились: <strong>{simState.result.worsened}</strong>
                      </span>
                      {simState.result.improved > 0 && (
                        <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                          <TrendingUp size={10} className="inline mr-1" />
                          Улучшились: <strong>{simState.result.improved}</strong>
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded border border-border bg-muted/20 text-muted-foreground">
                        <Minus size={10} className="inline mr-1" />
                        Без изменений: <strong>{simState.result.unchanged}</strong>
                      </span>
                    </div>

                    {/* Delta table */}
                    {changedDeltas.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Ни один индикатор не меняет цвет при этом сценарии.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground">
                              <th className="text-left py-1.5 pr-3 font-medium">Компания</th>
                              <th className="text-left py-1.5 pr-3 font-medium">Индикатор</th>
                              <th className="text-left py-1.5 pr-3 font-medium">Базовый</th>
                              <th className="text-left py-1.5 pr-3 font-medium">Сценарий</th>
                              <th className="text-right py-1.5 pr-3 font-medium">Значение было</th>
                              <th className="text-right py-1.5 font-medium">Значение стало</th>
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
                                  className={`border-b border-border/40 ${
                                    worsened
                                      ? "bg-red-500/5"
                                      : "bg-emerald-500/5"
                                  }`}
                                >
                                  <td className="py-1.5 pr-3 font-mono text-[10px] text-muted-foreground">
                                    {d.companyCode}
                                  </td>
                                  <td className="py-1.5 pr-3 font-mono text-[10px]">
                                    {d.code}
                                    {d.note && (
                                      <div className="text-muted-foreground opacity-70 text-[9px]">
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
                                  <td className="py-1.5 pr-3 text-right font-mono text-muted-foreground">
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
