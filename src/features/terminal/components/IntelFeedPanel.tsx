"use client";

/**
 * Phase 7.G Turn XLV (Phase D.4) — IntelFeedPanel modal for Risk Terminal.
 *
 * AI Web Crawler results feed. Opens on `terminal:open-intel` event
 * fired by CommandBar's `INT GO` dispatch. Closes on Escape OR
 * backdrop click — same modal contract as `AuditModal` / `AlertsPanel`.
 *
 * On open:
 *  1. Fetch `GET /api/intel` (default 50 items, ordered by fetchedAt desc).
 *  2. Render items: title + summary + sourceLabel + relevance badge
 *     (≥0.7 green / 0.4–0.7 amber / <0.4 grey) + industry/company tag
 *     pills + Pin button (POST /api/intel/[id]/pin) + Dismiss button
 *     (DELETE /api/intel/[id]/dismiss).
 *  3. Refresh button at top (admin-only) — POST /api/intel/refresh
 *     triggers a fresh crawl, then re-fetches GET /api/intel.
 *
 * Empty/loading/error states surface inline; pin/dismiss optimistic-
 * style update the local item array on 200 response.
 *
 * D.5 follow-ups (NOT in this turn):
 *  - i18n (RU/AZ output language pass-through to LLM prompt)
 *  - cursor pagination UI ("Load more")
 *  - keyboard shortcuts to navigate items
 *  - WebSocket / SSE live update on new IntelItem
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Globe, Pin, X, RefreshCw, Loader2 } from "lucide-react";
import type { IntelItemDTO } from "@/lib/intel/types";

interface IntelFetchResponse {
  items: IntelItemDTO[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface RefreshResponse {
  itemsFetched: number;
  itemsCreated: number;
  itemsSkipped: number;
  errors: string[];
  durationMs: number;
}

/** Relevance score → CSS tone class. Mirrors HeatMap status palette
 *  (green/amber/grey) for visual consistency across the terminal. */
function relevanceTone(score: number): { label: string; cls: string } {
  if (score >= 0.7) {
    return {
      label: "high",
      cls: "text-[#00D4AA] border-[#00D4AA]/40 bg-[#00D4AA]/10",
    };
  }
  if (score >= 0.4) {
    return {
      label: "med",
      cls: "text-[#FFB800] border-[#FFB800]/40 bg-[#FFB800]/10",
    };
  }
  return {
    label: "low",
    cls: "text-gray-400 border-gray-700 bg-gray-800/50",
  };
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

export function IntelFeedPanel() {
  const t = useTranslations("terminal");
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "viewer";
  const isAdmin = role === "admin";

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<IntelItemDTO[]>([]);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  // Open on event.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-intel", onOpen);
    return () => window.removeEventListener("terminal:open-intel", onOpen);
  }, []);

  // Escape closes.
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

  const fetchItems = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/intel?limit=50", { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Fetch failed (${res.status})`);
      }
      const data: IntelFetchResponse = await res.json();
      setItems(data.items);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch when opened.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    void fetchItems(ctrl.signal);
    return () => ctrl.abort();
  }, [open, fetchItems]);

  const handleRefresh = useCallback(async () => {
    if (!isAdmin || refreshing) return;
    setRefreshing(true);
    setRefreshNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/intel/refresh", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Refresh failed (${res.status})`);
      }
      const data: RefreshResponse = await res.json();
      const noticeParts = [
        `${data.itemsCreated} new`,
        `${data.itemsSkipped} skipped`,
        `${data.itemsFetched} hits in ${data.durationMs}ms`,
      ];
      if (data.errors.length > 0) noticeParts.push(`⚠ ${data.errors.length} errors`);
      setRefreshNotice(noticeParts.join(" · "));
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [isAdmin, refreshing, fetchItems]);

  const handlePin = useCallback(
    async (item: IntelItemDTO) => {
      const target = !item.isPinned;
      // Optimistic toggle so the UI reacts instantly; revert on error.
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, isPinned: target } : i)),
      );
      try {
        const res = await fetch(`/api/intel/${item.id}/pin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: target }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Pin failed (${res.status})`);
        }
      } catch (err) {
        // Revert + surface error.
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, isPinned: !target } : i,
          ),
        );
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const handleDismiss = useCallback(async (item: IntelItemDTO) => {
    // Remove from local list immediately; the GET handler will exclude
    // it on next fetch by default (`includeDismissed=false`).
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      const res = await fetch(`/api/intel/${item.id}/dismiss`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Dismiss failed (${res.status})`);
      }
    } catch (err) {
      // Revert by re-inserting; preserves order via fetchedAt sort on
      // next refresh, but for this turn put it back at the same index.
      setItems((prev) => {
        if (prev.some((i) => i.id === item.id)) return prev;
        return [item, ...prev];
      });
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Pinned items float to the top within the list.
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return b.fetchedAt.localeCompare(a.fetchedAt);
    });
  }, [items]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("intelFeedPanel.dialogAriaLabel")}
      data-testid="intel-feed-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-3xl max-h-[80vh] overflow-y-auto rounded-lg border border-gray-700 bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-[#00D4AA]" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("intelFeedPanel.title")}{" "}
                <span className="text-xs text-muted-foreground font-mono">
                  ({items.length})
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("intelFeedPanel.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-label={t("intelFeedPanel.refreshAriaLabel")}
                data-testid="intel-refresh-button"
                className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-xs hover:bg-gray-800 disabled:opacity-50"
              >
                {refreshing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                <span>
                  {refreshing
                    ? t("intelFeedPanel.refreshingLabel")
                    : t("intelFeedPanel.refreshLabel")}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("intelFeedPanel.closeAriaLabel")}
              className="rounded border border-gray-700 px-2 py-1 text-sm hover:bg-gray-800"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        {refreshNotice !== null && (
          <div
            data-testid="intel-refresh-notice"
            className="border-b border-gray-800 bg-[#00D4AA]/5 px-6 py-2 text-xs font-mono text-[#00D4AA]"
          >
            {refreshNotice}
          </div>
        )}

        {error !== null && (
          <div
            role="alert"
            data-testid="intel-error"
            className="border-b border-gray-800 bg-[#FF4757]/10 px-6 py-2 text-xs text-[#FF4757]"
          >
            {error}
          </div>
        )}

        <div className="px-6 py-4 space-y-3">
          {loading && items.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="intel-loading"
            >
              {t("intelFeedPanel.loading")}
            </p>
          ) : !loading && sortedItems.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="intel-empty"
            >
              {isAdmin
                ? t("intelFeedPanel.emptyAdmin")
                : t("intelFeedPanel.emptyViewer")}
            </p>
          ) : (
            sortedItems.map((item) => {
              const tone = relevanceTone(item.relevanceScore);
              return (
                <article
                  key={item.id}
                  data-testid={`intel-item-${item.id}`}
                  className={`rounded border px-3 py-2 ${
                    item.isPinned
                      ? "border-[#00D4AA]/40 bg-[#00D4AA]/5"
                      : "border-gray-800 bg-gray-900/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:underline break-words"
                      >
                        {item.title}
                      </a>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {item.summary}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-mono">
                        <span className="text-muted-foreground">
                          {item.sourceLabel}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 ${tone.cls}`}
                          aria-label={`Relevance ${tone.label} ${item.relevanceScore.toFixed(2)}`}
                        >
                          {tone.label} · {item.relevanceScore.toFixed(2)}
                        </span>
                        <span className="text-muted-foreground">
                          {formatRelative(
                            item.publishedAt ?? item.fetchedAt,
                          )}
                        </span>
                        {item.industryTags.map((t) => (
                          <span
                            key={`ind-${t}`}
                            className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300"
                          >
                            {t}
                          </span>
                        ))}
                        {item.companyTags.map((c) => (
                          <span
                            key={`co-${c}`}
                            className="rounded bg-blue-900/40 px-1.5 py-0.5 text-blue-300"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handlePin(item)}
                        aria-label={
                          item.isPinned
                            ? t("intelFeedPanel.unpinAriaLabel")
                            : t("intelFeedPanel.pinAriaLabel")
                        }
                        aria-pressed={item.isPinned}
                        data-testid={`intel-pin-${item.id}`}
                        className={`rounded border px-1.5 py-1 hover:bg-gray-800 ${
                          item.isPinned
                            ? "border-[#00D4AA]/60 text-[#00D4AA]"
                            : "border-gray-700 text-gray-400"
                        }`}
                      >
                        <Pin size={12} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismiss(item)}
                        aria-label={t("intelFeedPanel.dismissAriaLabel")}
                        data-testid={`intel-dismiss-${item.id}`}
                        className="rounded border border-gray-700 px-1.5 py-1 text-gray-400 hover:bg-gray-800"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
