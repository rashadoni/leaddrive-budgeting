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

function readStore(): Subscription[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage full / disabled — silent fail.
  }
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

  useEffect(() => {
    setSubs(readStore());
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-subscriptions", onOpen);
    return () =>
      window.removeEventListener("terminal:open-subscriptions", onOpen);
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

  if (!open) return null;

  const counts = {
    active: subs.filter((s) => s.status === "active").length,
    paused: subs.filter((s) => s.status === "paused").length,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("subscriptions.dialogAriaLabel")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-lg border border-gray-700 bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-[#FFB020]" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("subscriptions.title", {
                  active: counts.active,
                  paused: counts.paused,
                })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("subscriptions.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("subscriptions.closeAriaLabel")}
            className="rounded border border-gray-700 px-2 py-1 text-sm hover:bg-gray-800"
          >
            <X size={14} aria-hidden="true" />
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
              className="w-full bg-[#0A0E27] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600 focus:border-[#FFB020] focus:outline-none"
              spellCheck={false}
              maxLength={100}
              data-testid="subscriptions-label"
            />
            <div className="grid grid-cols-[1fr_1fr_80px_80px] gap-2 text-xs">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as Scope)}
                aria-label={t("subscriptions.scopeAriaLabel")}
                className="bg-[#0A0E27] border border-gray-700 rounded px-1.5 py-1 text-gray-200"
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
              <input
                type="text"
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
                disabled={scope === "any"}
                placeholder={
                  scope === "company"
                    ? t("subscriptions.scopeValueCompanyPlaceholder")
                    : scope === "indicator"
                      ? t("subscriptions.scopeValueIndicatorPlaceholder")
                      : t("subscriptions.scopeValueDisabledPlaceholder")
                }
                aria-label={t("subscriptions.scopeValueAriaLabel")}
                className="bg-[#0A0E27] border border-gray-700 rounded px-1.5 py-1 text-gray-200 placeholder-gray-700 disabled:opacity-50"
                spellCheck={false}
                data-testid="subscriptions-scope-value"
              />
              <select
                value={comparator}
                onChange={(e) => setComparator(e.target.value as Comparator)}
                aria-label={t("subscriptions.comparatorAriaLabel")}
                className="bg-[#0A0E27] border border-gray-700 rounded px-1.5 py-1 text-gray-200"
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
                className="bg-[#0A0E27] border border-gray-700 rounded px-1.5 py-1 text-gray-200 tabular-nums"
                min={0}
                max={100}
                step={1}
                data-testid="subscriptions-threshold"
              />
            </div>
            <button
              type="submit"
              disabled={!label.trim()}
              className="px-3 py-1 rounded bg-[#FFB020] text-[#050814] text-sm font-semibold disabled:bg-gray-800 disabled:text-gray-600"
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
                className="text-sm text-muted-foreground italic"
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
                        <span className="font-semibold text-sm text-gray-200 truncate">
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
  );
}
