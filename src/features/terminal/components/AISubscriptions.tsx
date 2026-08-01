"use client";

/**
 * Tier-3 sub-30 — AISubscriptions ("notify me when X" manager).
 *
 * Bloomberg-style alert subscription per user: "notify me when AAC-MAIN
 * composite drops below 50" / "notify me when any sub-co IND_NET_MARGIN
 * goes red". v1 lets users define + manage their own subscriptions; the
 * matrix-fetch pipeline evaluates each subscription against the current
 * snapshot and surfaces firing matches as in-app notifications.
 *
 * v1 scope:
 *   - In-memory + localStorage persistence (key: `terminal-subscriptions-v1`)
 *   - Subscription shape:
 *       { id, label, scope: "company" | "indicator" | "any",
 *         scopeValue: string | null, metric: "composite" | "indicator-status",
 *         comparator: "<" | "<=" | ">" | ">=" | "==", threshold: number | null,
 *         indicatorCode: string | null, status: "active" | "paused",
 *         lastFiredAt: number | null }
 *   - Modal-pattern delivery (same as AlertsPanel / ActionCenterPanel)
 *   - Opens on `terminal:open-subscriptions` event (CommandBar `SUB GO`)
 *   - Form to create new subscription + list of existing
 *   - Pause / resume / delete actions
 *   - Status icon (active = ●, paused = ◇) — color-blind safe via
 *     statusShape() (M7 lock)
 *
 * v2 (post-demo, 🔄'd in CARRYOVER):
 *   - Backend persistence (Subscription Prisma model + REST endpoints)
 *   - Email / SMS / Slack notification channels (v1 in-app only)
 *   - Cron-driven re-evaluation (BullMQ)
 *   - Rich condition language (AND/OR composition, sector scope, etc.)
 *   - Snooze for N hours
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Bell, X, Trash2, Pause, Play } from "lucide-react";
import { statusShape } from "@/lib/risk/heatmap-matrix";
import { useMatrix, type MatrixResponse } from "../hooks/use-matrix";
import { useCompanies, buildRiskTagsByCompanyId } from "../hooks/use-companies";
import { useExpertViewport } from "../hooks/use-expert-viewport";
import {
  computeCompositeByCompany,
  MIN_SCORING_CELLS,
  type CompositeScore,
} from "@/lib/risk/composite-score";

type Scope = "company" | "indicator" | "any";
type Metric = "composite" | "indicator-status";
type Comparator = "<" | "<=" | ">" | ">=" | "==";
type SubStatus = "active" | "paused";

interface Subscription {
  id: string;
  label: string;
  scope: Scope;
  /** Company code (when scope=company), indicator code (when scope=indicator),
   *  or null (when scope=any). */
  scopeValue: string | null;
  metric: Metric;
  comparator: Comparator;
  /** Threshold for composite scope (0-100) OR null for indicator-status
   *  metric (status comparison uses indicatorCode + comparator on
   *  red/amber/green/unknown literally). */
  threshold: number | null;
  indicatorCode: string | null;
  status: SubStatus;
  lastFiredAt: number | null;
}

const STORAGE_KEY = "terminal-subscriptions-v1";

/**
 * Architect Round-24 Stage 3 — versioned localStorage envelope.
 * v=1 prevents silent-discard of legitimate rows when v2 adds new
 * fields. Read path: accept both legacy bare-array shape AND the
 * `{ v: 1, data: [...] }` envelope. Write path: always envelope.
 */
const STORAGE_VERSION = 1;

interface StorageEnvelope<T> {
  v: number;
  data: T;
}

function isEnvelope(x: unknown): x is StorageEnvelope<unknown> {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as StorageEnvelope<unknown>).v === "number" &&
    "data" in (x as StorageEnvelope<unknown>)
  );
}

function readStore(): Subscription[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Accept legacy bare-array shape (v=0 implicit) OR v=1 envelope.
    const data: unknown = isEnvelope(parsed) ? parsed.data : parsed;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (s): s is Subscription =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Subscription).id === "string" &&
        typeof (s as Subscription).label === "string" &&
        ((s as Subscription).status === "active" ||
          (s as Subscription).status === "paused"),
    );
  } catch {
    return [];
  }
}

function writeStore(list: Subscription[]): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: StorageEnvelope<Subscription[]> = {
      v: STORAGE_VERSION,
      data: list,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // localStorage full / disabled — silent fail.
  }
}

/**
 * Architect Round-24 Stage 3 — pure subscription matcher. Returns true
 * iff the subscription's condition is currently satisfied by the
 * supplied matrix + composites snapshot.
 *
 * v1 contract: only `metric === 'composite'` is evaluated. Indicator-
 * status metric (e.g. "fire when AAC IND_NET_MARGIN goes red") is
 * defined in the type but unimplemented — tracked as 🔄 for v2.
 *
 * Exported for unit testing — pure, side-effect-free.
 */
export function evaluateSubscription(
  sub: Subscription,
  composites: ReadonlyMap<string, CompositeScore>,
  matrix: MatrixResponse,
): boolean {
  if (sub.status !== "active") return false;
  if (sub.metric !== "composite") return false;
  if (sub.threshold === null || !Number.isFinite(sub.threshold)) return false;
  const compare = (score: number): boolean => {
    switch (sub.comparator) {
      case "<":
        return score < sub.threshold!;
      case "<=":
        return score <= sub.threshold!;
      case ">":
        return score > sub.threshold!;
      case ">=":
        return score >= sub.threshold!;
      case "==":
        return score === sub.threshold!;
    }
  };
  if (sub.scope === "any") {
    for (const c of composites.values()) {
      if (c.score !== null && compare(c.score)) return true;
    }
    return false;
  }
  if (sub.scope === "company" && sub.scopeValue) {
    const co = matrix.companies.find((c) => c.code === sub.scopeValue);
    if (!co) return false;
    const composite = composites.get(co.id);
    if (!composite || composite.score === null) return false;
    return compare(composite.score);
  }
  // scope=indicator: composite metric doesn't apply per-indicator; v2.
  return false;
}

/**
 * Debounce window between consecutive `lastFiredAt` updates for the
 * same subscription. 1 hour balances "give the CFO a useful signal
 * when conditions persist" vs "don't spam the same firing on every
 * matrix re-fetch within the same session".
 */
const FIRE_DEBOUNCE_MS = 60 * 60 * 1000;

/** Plain-language one-liner of a subscription's condition, for the toast. */
function conditionText(s: Subscription): string {
  const scopeStr = s.scope === "any" ? "any" : `${s.scope}:${s.scopeValue ?? "?"}`;
  return `${scopeStr} · composite ${s.comparator} ${s.threshold ?? "?"}`;
}

export function AISubscriptions() {
  const t = useTranslations("terminal");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [subs, setSubs] = useState<Subscription[]>([]);
  /** Form state for the new-subscription draft. */
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<Scope>("any");
  const [scopeValue, setScopeValue] = useState("");
  const [comparator, setComparator] = useState<Comparator>("<");
  const [threshold, setThreshold] = useState("50");
  // v1.5 (2026-06-01) — active in-terminal notification: a transient toast
  // stack + a persistent unseen-count bell pill, both shown even when the
  // panel is closed (this component stays mounted via PanelGrid).
  const [toasts, setToasts] = useState<{ id: string; label: string; condition: string }[]>([]);
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    setSubs(readStore());
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-subscriptions", onOpen);
    return () =>
      window.removeEventListener("terminal:open-subscriptions", onOpen);
  }, []);

  /**
   * Architect Round-24 Stage 3 — matcher engine. Subscribes to live
   * matrix changes via useMatrix() and evaluates each active sub on
   * every matrix-fetch resolve. Updates `lastFiredAt` for matches,
   * debounced by FIRE_DEBOUNCE_MS to avoid spam-firing on cell-click
   * navigation that re-emits matrix state. The matcher runs throughout
   * desktop Expert sessions. On the mobile fallback it stays cold until the
   * subscription overlay is explicitly opened, because Expert is unavailable.
   *
   * Match-firing path is purely localStorage-side-effect; UI surface
   * is the `lastFiredAt` badge in the list rendered when modal opens.
   * v2 will fan-out to in-app toast / email / Slack — this is the
   * v1 plumbing those v2 channels will subscribe to.
   */
  const supportsExpert = useExpertViewport();
  const dataEnabled = supportsExpert || open;
  const { matrix } = useMatrix(undefined, false, { enabled: dataEnabled });
  // Phase 7.N — riskTags from the shared `/api/companies` source so the
  // subscription matcher evaluates against the SAME penalized composite the
  // HeatMap / CompanyTree show (e.g. "fire when EDEN composite < 90" must use
  // the penalized 88, not the raw 100). The matrix payload carries no riskTags.
  const { companies: companyTree } = useCompanies({ enabled: dataEnabled });
  const composites = useMemo(() => {
    if (!matrix) return new Map<string, CompositeScore>();
    const riskTagsByCompanyId = companyTree
      ? buildRiskTagsByCompanyId(companyTree)
      : undefined;
    // 11.71 — the "SAME composite the HeatMap shows" claim above holds because
    // `matrix.cells` carry the `scoring` flag from the API and
    // `computeCompositeScore` enforces it (constants + the informational
    // legal/compliance indicators the owner directed out of the financial
    // score). A user rule «fire when EDEN composite < 90» must not fire on a
    // number no screen renders — which is what happened while the exclusion was
    // a caller-side filter this component never called.
    return computeCompositeByCompany(
      matrix.cells,
      matrix.companies.map((c) => c.id),
      riskTagsByCompanyId,
    );
  }, [matrix, companyTree]);

  useEffect(() => {
    if (!matrix || subs.length === 0) return;
    const now = Date.now();
    let changed = false;
    const updated = subs.map((sub) => {
      if (sub.status !== "active") return sub;
      const fires = evaluateSubscription(sub, composites, matrix);
      if (!fires) return sub;
      // Debounce: skip if last fire was less than FIRE_DEBOUNCE_MS ago.
      if (sub.lastFiredAt && now - sub.lastFiredAt < FIRE_DEBOUNCE_MS) {
        return sub;
      }
      changed = true;
      return { ...sub, lastFiredAt: now };
    });
    if (changed) {
      setSubs(updated);
      writeStore(updated);
      // v1.5 — surface the firing actively: toast(s) + bump the bell count.
      const firedNow = updated.filter((u, i) => u.lastFiredAt !== subs[i].lastFiredAt);
      if (firedNow.length > 0) {
        setUnseenCount((c) => c + firedNow.length);
        const fresh = firedNow.map((s, k) => ({
          id: `${s.id}-${now}-${k}`,
          label: s.label,
          condition: conditionText(s),
        }));
        setToasts((prev) => [...fresh, ...prev].slice(0, 4));
        fresh.forEach((tt) =>
          window.setTimeout(
            () => setToasts((prev) => prev.filter((p) => p.id !== tt.id)),
            7000,
          ),
        );
      }
    }
    // subs intentionally omitted from deps — using setSubs(updated)
    // would cause re-evaluation loop. We re-evaluate only when matrix
    // / composites change (the inputs to the rule), not when we update
    // lastFiredAt (the output).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, composites]);

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

  const persist = useCallback((next: Subscription[]) => {
    setSubs(next);
    writeStore(next);
  }, []);

  const handleCreate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const labelTrim = label.trim();
      const parsedThreshold = Number(threshold);
      if (!labelTrim || !Number.isFinite(parsedThreshold)) return;
      const next: Subscription = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: labelTrim,
        scope,
        scopeValue: scope === "any" ? null : scopeValue.trim() || null,
        metric: "composite",
        comparator,
        threshold: parsedThreshold,
        indicatorCode: null,
        status: "active",
        lastFiredAt: null,
      };
      persist([...subs, next]);
      // Reset form
      setLabel("");
      setScopeValue("");
    },
    [label, scope, scopeValue, comparator, threshold, subs, persist],
  );

  const handleToggle = useCallback(
    (id: string) => {
      persist(
        subs.map((s) =>
          s.id === id
            ? { ...s, status: s.status === "active" ? "paused" : "active" }
            : s,
        ),
      );
    },
    [subs, persist],
  );

  const handleDelete = useCallback(
    (id: string) => {
      persist(subs.filter((s) => s.id !== id));
    },
    [subs, persist],
  );

  /** Color + shape for a subscription's status. Active = green ●; paused
   *  = unknown ◇. Color-blind safe via statusShape(). */
  const subStatusGlyph = useCallback((status: SubStatus) => {
    return status === "active" ? statusShape("green") : statusShape("unknown");
  }, []);

  const subStatusColor = useCallback((status: SubStatus) => {
    return status === "active" ? "#00D4AA" : "#6B7280";
  }, []);

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "short",
      }),
    [locale],
  );

  const counts = {
    active: subs.filter((s) => s.status === "active").length,
    paused: subs.filter((s) => s.status === "paused").length,
  };

  return (
    <>
    {open && (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("subscriptions.dialogAriaLabel")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0A0E27] text-gray-200 shadow-2xl shadow-black/60 ring-1 ring-white/5">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-gradient-to-b from-[#0E1430] to-[#0A0E27] px-6 py-3.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#FFB800]/30 bg-[#FFB800]/10">
              <Bell size={15} className="text-[#FFB800]" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-gray-50">
                {t("subscriptions.title", {
                  active: counts.active,
                  paused: counts.paused,
                })}
              </h2>
              <p className="text-[11px] text-gray-500">
                {t("subscriptions.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("subscriptions.closeAriaLabel")}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        <div className="px-6 py-4 space-y-4">
          {/* Create form */}
          <form
            onSubmit={handleCreate}
            className="rounded border border-gray-800 px-3 py-2 space-y-2"
            data-testid="subscriptions-create-form"
          >
            <div className="text-[9px] uppercase tracking-wider text-gray-500">
              {t("subscriptions.createTitle")}
            </div>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("subscriptions.labelPlaceholder")}
              aria-label={t("subscriptions.labelAriaLabel")}
              className="w-full bg-[#0A0E27] border border-white/15 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600 focus:border-[#FFB800] focus:outline-none"
              spellCheck={false}
              maxLength={100}
              data-testid="subscriptions-label"
            />
            <div className="grid grid-cols-[1fr_1fr_80px_80px] gap-2 text-xs">
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as Scope);
                  setScopeValue(""); // reset picker when the scope kind changes
                }}
                aria-label={t("subscriptions.scopeAriaLabel")}
                className="bg-[#0A0E27] border border-white/15 rounded px-1.5 py-1 text-gray-200"
                data-testid="subscriptions-scope"
              >
                <option value="any">{t("subscriptions.scopeAny")}</option>
                <option value="company">
                  {t("subscriptions.scopeCompany")}
                </option>
                <option value="indicator">
                  {t("subscriptions.scopeIndicator")}
                </option>
              </select>
              <select
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
                disabled={scope === "any"}
                aria-label={t("subscriptions.scopeValueAriaLabel")}
                className="bg-[#0A0E27] border border-white/15 rounded px-1.5 py-1 text-gray-200 disabled:opacity-50 truncate"
                data-testid="subscriptions-scope-value"
              >
                <option value="">
                  {scope === "any"
                    ? t("subscriptions.scopeValueDisabledPlaceholder")
                    : scope === "company"
                      ? t("subscriptions.scopeValueCompanySelect")
                      : t("subscriptions.scopeValueIndicatorSelect")}
                </option>
                {scope === "company" &&
                  (matrix?.companies ?? []).map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.code}
                      {c.name ? ` · ${c.name}` : ""}
                    </option>
                  ))}
                {scope === "indicator" &&
                  (matrix?.indicators ?? []).map((ind) => (
                    <option key={ind.id} value={ind.code}>
                      {ind.code}
                    </option>
                  ))}
              </select>
              <select
                value={comparator}
                onChange={(e) => setComparator(e.target.value as Comparator)}
                aria-label={t("subscriptions.comparatorAriaLabel")}
                className="bg-[#0A0E27] border border-white/15 rounded px-1.5 py-1 text-gray-200"
                data-testid="subscriptions-comparator"
              >
                <option value="<">&lt;</option>
                <option value="<=">≤</option>
                <option value=">">&gt;</option>
                <option value=">=">≥</option>
                <option value="==">=</option>
              </select>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                aria-label={t("subscriptions.thresholdAriaLabel")}
                className="bg-[#0A0E27] border border-white/15 rounded px-1.5 py-1 text-gray-200 tabular-nums"
                min={0}
                max={100}
                step={1}
                data-testid="subscriptions-threshold"
              />
            </div>
            {/* 11.81 — `evaluateSubscription` already skipped null composites,
                so a rule «notify when X composite < 50» has always been silent
                for a company with no score. The coverage floor makes that far
                more common (145 null pairs instead of 61), so the silence is
                stated in the editor rather than discovered in production. A
                coverage-collapse detector — "was ≥4, now <4" — belongs with
                the drift watchdog and is not built here. */}
            <p
              className="text-[10px] text-gray-500 leading-snug"
              data-testid="subscriptions-coverage-note"
            >
              {t("composite.subscriptionCoverageNote", { min: MIN_SCORING_CELLS })}
            </p>
            <button
              type="submit"
              disabled={!label.trim()}
              className="px-3 py-1 rounded bg-[#FFB800] text-[#050814] text-sm font-semibold disabled:bg-gray-800 disabled:text-gray-600"
              data-testid="subscriptions-create-submit"
            >
              {t("subscriptions.createSubmit")}
            </button>
          </form>

          {/* List */}
          <section aria-label={t("subscriptions.listAriaLabel")}>
            <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-2">
              {t("subscriptions.listTitle")} · {subs.length}
            </div>
            {subs.length === 0 ? (
              <p
                className="text-sm text-gray-400 italic"
                data-testid="subscriptions-empty"
              >
                {t("subscriptions.empty")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {subs.map((s) => {
                  const color = subStatusColor(s.status);
                  const glyph = subStatusGlyph(s.status);
                  return (
                    <li
                      key={s.id}
                      data-testid={`subscriptions-row-${s.id}`}
                      className="flex items-center justify-between gap-2 rounded border border-gray-800 px-3 py-1.5"
                    >
                      <div className="flex items-baseline gap-2 min-w-0 flex-1">
                        <span
                          aria-hidden="true"
                          className="text-[10px] shrink-0"
                          style={{ color }}
                        >
                          {glyph}
                        </span>
                        <span
                          className="font-semibold text-sm text-gray-200 truncate"
                          title={s.label}
                        >
                          {s.label}
                        </span>
                        <span className="font-mono text-[10px] text-gray-500 truncate">
                          {s.scope === "any"
                            ? t("subscriptions.scopeAny")
                            : `${s.scope}:${s.scopeValue ?? "?"}`}
                          {" · "}
                          {s.metric === "composite"
                            ? "composite"
                            : "ind-status"}
                          {" "}
                          {s.comparator} {s.threshold ?? "?"}
                        </span>
                        {s.lastFiredAt && (
                          <span
                            className="text-[9px] text-[#FF4757] shrink-0"
                            title={t("subscriptions.lastFiredTitle")}
                          >
                            {t("subscriptions.lastFiredLabel")}{" "}
                            {fmt.format(new Date(s.lastFiredAt))}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggle(s.id)}
                          aria-label={
                            s.status === "active"
                              ? t("subscriptions.pauseAriaLabel", {
                                  label: s.label,
                                })
                              : t("subscriptions.resumeAriaLabel", {
                                  label: s.label,
                                })
                          }
                          title={
                            s.status === "active"
                              ? t("subscriptions.pauseTitle")
                              : t("subscriptions.resumeTitle")
                          }
                          className="text-gray-500 hover:text-gray-200 px-1 py-0.5 rounded"
                          data-testid={`subscriptions-toggle-${s.id}`}
                        >
                          {s.status === "active" ? (
                            <Pause size={12} aria-hidden="true" />
                          ) : (
                            <Play size={12} aria-hidden="true" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(s.id)}
                          aria-label={t("subscriptions.deleteAriaLabel", {
                            label: s.label,
                          })}
                          title={t("subscriptions.deleteTitle")}
                          className="text-gray-500 hover:text-[#FF4757] px-1 py-0.5 rounded"
                          data-testid={`subscriptions-delete-${s.id}`}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
    )}

    {/* v1.5 — active notification surface. Renders even when the panel is
        closed (component stays mounted via PanelGrid). Toasts auto-dismiss
        after 7s; the bell pill persists the unseen count until opened. */}
    {toasts.length > 0 && (
      <div
        className="fixed bottom-6 right-6 z-[70] flex w-72 flex-col gap-2"
        data-testid="subscription-toasts"
      >
        {toasts.map((tt) => (
          <button
            key={tt.id}
            type="button"
            onClick={() => {
              setOpen(true);
              setUnseenCount(0);
              setToasts([]);
            }}
            className="flex items-start gap-2.5 rounded-lg border border-[#FF4757]/40 bg-[#0A0E27] px-3 py-2.5 text-left shadow-2xl shadow-black/50 ring-1 ring-white/5 transition-colors hover:border-[#FF4757]/70"
          >
            <Bell size={15} className="mt-0.5 shrink-0 animate-pulse text-[#FF4757]" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-gray-100">{tt.label}</span>
              <span className="block truncate text-[11px] text-gray-400">
                {t("subscriptions.firedToast")} · <span className="font-mono">{tt.condition}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    )}
    {toasts.length === 0 && unseenCount > 0 && (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setUnseenCount(0);
        }}
        aria-label={t("subscriptions.bellAriaLabel", { count: unseenCount })}
        className="fixed bottom-6 right-6 z-[70] inline-flex items-center gap-1.5 rounded-full border border-[#FF4757]/50 bg-[#0A0E27] px-3 py-2 text-sm font-semibold text-[#FF4757] shadow-2xl shadow-black/50 transition-colors hover:bg-[#FF4757]/10"
        data-testid="subscription-bell"
      >
        <Bell size={15} className="animate-pulse" aria-hidden="true" />
        {unseenCount}
      </button>
    )}
    </>
  );
}
