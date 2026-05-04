"use client";

/**
 * Phase 7.E C6 v3.3 (Turn V) — paginated AlertEvent replay viewer.
 *
 * Consumes `GET /api/indicators/alerts/events?period=X[&ruleId=Y]`
 * (Turn IV v3.2 read API). Period is required; the parent page reads
 * it from URL searchParams. Infinite scroll via "Load more" button +
 * `nextCursor` (composite `(emittedAt, id)` keyset).
 *
 * Deliberately simpler than `AuditFeed` (370 LOC):
 *   - One filter (ruleId) instead of five
 *   - No abort-controller single-flight (still <250 LOC; user double-
 *     click on "Load more" is a v3.4 concern; busy-state disable
 *     mitigates the typical case)
 *   - Severity color coding mirrors AlertsPanel terminal palette
 *
 * Empty state (no events for period): centered "No alerts on record"
 * message — distinct from the page-level "period missing" gate which
 * is enforced server-side.
 */

import { useCallback, useEffect, useState } from "react";

interface AlertEvent {
  id: string;
  period: string;
  ruleId: string;
  ruleName: string;
  severity: string;
  message: string;
  messageKey: string;
  messageParams: Record<string, unknown>;
  affectedCompanyIds: string[];
  affectedIndicatorCodes: string[];
  emittedAt: string;
}

interface FetchResponse {
  events: AlertEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-[#FF4757]/15 text-[#FF4757] border-[#FF4757]/40",
  warning: "bg-[#FFB800]/15 text-[#FFB800] border-[#FFB800]/40",
  info: "bg-[#00B4D8]/15 text-[#00B4D8] border-[#00B4D8]/40",
};

function buildSearchParams(
  period: string,
  ruleId: string,
  cursor: string | null,
): string {
  const sp = new URLSearchParams();
  sp.set("period", period);
  if (ruleId) sp.set("ruleId", ruleId);
  if (cursor) sp.set("cursor", cursor);
  sp.set("limit", String(PAGE_SIZE));
  return sp.toString();
}

export function AlertEventsFeed({ period }: { period: string }) {
  const [ruleId, setRuleId] = useState<string>("");
  const [appliedRuleId, setAppliedRuleId] = useState<string>("");
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (ruleIdForFetch: string, cursorForFetch: string | null, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const qs = buildSearchParams(period, ruleIdForFetch, cursorForFetch);
        const res = await fetch(`/api/indicators/alerts/events?${qs}`, {
          method: "GET",
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as FetchResponse;
        setEvents((prev) => (append ? [...prev, ...data.events] : data.events));
        setCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fetch failed");
      } finally {
        setLoading(false);
      }
    },
    [period],
  );

  useEffect(() => {
    setAppliedRuleId(ruleId);
    fetchPage(ruleId, null, false);
    // Initial mount + period change → re-fetch fresh page. ruleId
    // intentionally NOT in deps — Apply button drives that fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  function onApply() {
    setAppliedRuleId(ruleId);
    fetchPage(ruleId, null, false);
  }

  function onReset() {
    setRuleId("");
    setAppliedRuleId("");
    fetchPage("", null, false);
  }

  function onLoadMore() {
    if (!cursor) return;
    fetchPage(appliedRuleId, cursor, true);
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply();
        }}
        className="flex items-end gap-3 rounded border border-gray-800 bg-background p-3"
        aria-label="Filter alert events"
      >
        <label className="flex-1">
          <span className="text-xs uppercase tracking-wider text-gray-500">
            Rule ID
          </span>
          <input
            type="text"
            value={ruleId}
            onChange={(e) => setRuleId(e.target.value)}
            placeholder="e.g. RULE_CRITICAL_INDICATOR"
            className="mt-1 w-full rounded border border-gray-700 bg-background px-2 py-1 text-sm font-mono"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded border border-[#00D4AA] bg-[#00D4AA]/10 text-[#00D4AA] px-3 py-1.5 text-sm hover:bg-[#00D4AA]/20 disabled:opacity-50"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={loading}
          className="rounded border border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-800 disabled:opacity-50"
        >
          Reset
        </button>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded border border-[#FF4757]/40 bg-[#FF4757]/10 px-3 py-2 text-sm text-[#FF4757]"
        >
          {error}
        </div>
      )}

      {!error && events.length === 0 && !loading && (
        <p className="text-center text-sm text-gray-500 py-8">
          No alerts on record for period <span className="font-mono">{period}</span>
          {appliedRuleId ? <> · rule <span className="font-mono">{appliedRuleId}</span></> : null}.
        </p>
      )}

      {events.length > 0 && (
        <ul className="space-y-2" aria-label="Alert events">
          {events.map((ev) => {
            const tone = SEVERITY_TONE[ev.severity] ?? SEVERITY_TONE.info;
            return (
              <li
                key={ev.id}
                className="rounded border border-gray-800 p-3 text-sm"
                data-testid="alert-event-row"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase ${tone}`}
                  >
                    {ev.severity}
                  </span>
                  <time
                    dateTime={ev.emittedAt}
                    className="font-mono text-xs text-gray-500"
                  >
                    {ev.emittedAt.replace("T", " ").slice(0, 19)}Z
                  </time>
                </div>
                <div className="mt-1 font-mono text-[10px] text-gray-500">
                  {ev.ruleId}
                </div>
                <div className="mt-0.5">{ev.message}</div>
                {ev.affectedCompanyIds.length > 0 && (
                  <div className="mt-1 text-xs text-gray-500 font-mono">
                    affected: {ev.affectedCompanyIds.length} co
                    {ev.affectedCompanyIds.length === 1 ? "" : "s"}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="block w-full rounded border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}

      {loading && events.length === 0 && (
        <p className="text-center text-sm text-gray-500 py-4">Loading…</p>
      )}
    </div>
  );
}
