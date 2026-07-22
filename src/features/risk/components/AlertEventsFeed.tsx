"use client";

/**
 * Phase 7.E C6 v3.3 (Turn V) — paginated latest AlertEvent snapshot viewer.
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
 * Empty state explicitly does not imply that evaluation ran or that the
 * current risk state is green.
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  localizeAlertMessageParams,
  type IndustryTranslator,
} from "@/lib/risk/alert-message-i18n";
import { DEFAULT_ALERT_RULE_IDS } from "@/lib/risk/alert-rules";

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
  unknown: "bg-gray-500/10 text-gray-400 border-gray-500/40",
};

// M7 spirit: severity must convey shape, not just color, for color-blind
// readers. Glyph distinct per severity (▲ critical / ● warning / ■ info).
// Architect Turn-V Round-1 ⚠️ #2 closure.
const SEVERITY_GLYPH: Record<string, string> = {
  critical: "▲",
  warning: "●",
  info: "■",
  unknown: "◆",
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
  const t = useTranslations("alertHistory");
  const terminalT = useTranslations("terminal");
  const tIndustries = useTranslations(
    "industries",
  ) as unknown as IndustryTranslator;
  const locale = useLocale();
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

  // Architect Turn-V Round-1 ⚠️ #3 closure: early-return-if-loading guards.
  // `setLoading(true)` is async, so a double-click before the next React
  // render would fire two concurrent fetches → setEvents append duplicates
  // the row set. Reading from `loading` here is safe because the click
  // handler runs in React's event queue after the prior render committed.
  function onApply() {
    if (loading) return;
    setAppliedRuleId(ruleId);
    fetchPage(ruleId, null, false);
  }

  function onReset() {
    if (loading) return;
    setRuleId("");
    setAppliedRuleId("");
    fetchPage("", null, false);
  }

  function onLoadMore() {
    if (loading) return;
    if (!cursor) return;
    fetchPage(appliedRuleId, cursor, true);
  }

  function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "UTC",
    }).format(date);
  }

  function localizedRuleName(event: AlertEvent): string {
    if (!DEFAULT_ALERT_RULE_IDS.has(event.ruleId)) return event.ruleName;
    try {
      return terminalT(`alerts.rules.${event.ruleId}` as never);
    } catch {
      return event.ruleName;
    }
  }

  function localizedMessage(event: AlertEvent): string {
    if (!DEFAULT_ALERT_RULE_IDS.has(event.ruleId)) return event.message;
    try {
      const supportedParams = Object.fromEntries(
        Object.entries(event.messageParams).filter(
          (entry): entry is [string, string | number] =>
            typeof entry[1] === "string" || typeof entry[1] === "number",
        ),
      );
      const localizedParams = localizeAlertMessageParams(
        supportedParams,
        tIndustries,
      );
      return terminalT(event.messageKey as never, localizedParams as never);
    } catch {
      return event.message;
    }
  }

  return (
    <div className="space-y-4" data-testid="alerts-guide-feed">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply();
        }}
        className="flex items-end gap-3 rounded border border-gray-800 bg-background p-3"
        aria-label={t("filterAria")}
        data-testid="alerts-guide-filter"
      >
        <label className="flex-1">
          <span className="text-xs uppercase tracking-wider text-gray-500">
            {t("ruleId")}
          </span>
          <input
            type="text"
            value={ruleId}
            onChange={(e) => setRuleId(e.target.value)}
            placeholder={t("rulePlaceholder")}
            className="mt-1 w-full rounded border border-gray-700 bg-background px-2 py-1 text-sm font-mono"
            data-testid="alerts-guide-rule-input"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded border border-[#00D4AA] bg-[#00D4AA]/10 text-[#00D4AA] px-3 py-1.5 text-sm hover:bg-[#00D4AA]/20 disabled:opacity-50"
        >
          <span data-testid="alerts-guide-apply">{t("apply")}</span>
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={loading}
          className="rounded border border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-800 disabled:opacity-50"
        >
          <span data-testid="alerts-guide-reset">{t("reset")}</span>
        </button>
      </form>

      <p
        className="text-xs text-muted-foreground"
        data-testid="alerts-guide-filter-disclosure"
      >
        {t("filterDisclosure")}
      </p>

      <section
        className="grid gap-2 rounded border border-gray-800 bg-muted/20 p-3 text-xs text-muted-foreground md:grid-cols-2"
        data-testid="alerts-guide-reading"
      >
        <h2 className="font-semibold text-foreground md:col-span-2">
          {t("readingTitle")}
        </h2>
        <p data-testid="alerts-guide-read-severity">{t("readingSeverity")}</p>
        <p data-testid="alerts-guide-read-message">{t("readingMessage")}</p>
        <p data-testid="alerts-guide-read-pagination">{t("readingPagination")}</p>
        <p data-testid="alerts-guide-read-deeplink">{t("readingDeepLink")}</p>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded border border-[#FF4757]/40 bg-[#FF4757]/10 px-3 py-2 text-sm text-[#FF4757]"
        >
          {t("loadFailed", { error })}
        </div>
      )}

      {!error && events.length === 0 && !loading && !hasMore && (
        <div
          className="space-y-1 py-8 text-center text-sm text-gray-500"
          data-testid="alerts-guide-empty"
        >
          <p>{t("emptyTitle", { period })}</p>
          <p>{t("emptyBody")}</p>
        </div>
      )}

      {!error && events.length === 0 && !loading && hasMore && (
        <div
          className="space-y-1 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm"
          data-testid="alerts-guide-scan-continuation"
        >
          <p className="font-medium">{t("continuationTitle")}</p>
          <p className="text-muted-foreground">{t("continuationBody")}</p>
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-3" data-testid="alerts-guide-results">
          <div className="text-xs text-muted-foreground" data-testid="alerts-guide-summary">
            <p>{t("showingCount", { count: events.length })}</p>
            <p>{t("latestEvaluation", { date: formatTime(events[0].emittedAt) })}</p>
          </div>
          <ul
            className="space-y-2"
            aria-label={t("eventsAria")}
            data-testid="alerts-guide-events-list"
          >
            {events.map((ev) => {
            const severity = Object.hasOwn(SEVERITY_TONE, ev.severity)
              ? ev.severity
              : "unknown";
            const severityLabel = t(`severity.${severity}` as never);
            const tone = SEVERITY_TONE[severity];
            const glyph = SEVERITY_GLYPH[severity];
            return (
              <li
                key={ev.id}
                className="rounded border border-gray-800 p-3 text-sm"
                data-testid="alert-event-row"
                data-guide-event-id={ev.id}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase ${tone}`}
                    aria-label={t("severityAria", { severity: severityLabel })}
                  >
                    <span aria-hidden="true">{glyph}</span>
                    {severityLabel}
                  </span>
                  <time
                    dateTime={ev.emittedAt}
                    className="font-mono text-xs text-gray-500"
                  >
                    {formatTime(ev.emittedAt)} UTC
                  </time>
                </div>
                <div className="mt-1 font-mono text-[10px] text-gray-500">
                  {localizedRuleName(ev)} · {ev.ruleId}
                </div>
                <div className="mt-0.5">{localizedMessage(ev)}</div>
                {ev.affectedCompanyIds.length > 0 && (
                  <div className="mt-1 text-xs text-gray-500 font-mono">
                    {t("affectedCompanies", { count: ev.affectedCompanyIds.length })}
                  </div>
                )}
                {/* A deep link is safe only for one unambiguous company. The
                  * resolve endpoint accepts the stored DB id or a company code,
                  * then reapplies organization and subgroup scope. Navigation
                  * opens terminal context; it does not invoke an AI provider. */}
                {ev.affectedCompanyIds.length === 1 && ev.affectedIndicatorCodes.length === 1 && (
                  <div className="mt-2">
                    <a
                      href={`/budgeting/terminal?companyId=${encodeURIComponent(ev.affectedCompanyIds[0])}&indicator=${encodeURIComponent(ev.affectedIndicatorCodes[0])}&period=${encodeURIComponent(ev.period)}&from=alert&alertId=${encodeURIComponent(ev.id)}`}
                      className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-mono text-cyan-300 hover:bg-cyan-500/20"
                      title={t("openTerminalTitle")}
                      data-testid="alert-explain-link"
                    >
                      {t("openTerminal")}
                    </a>
                  </div>
                )}
              </li>
            );
            })}
          </ul>
        </div>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="block w-full rounded border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:opacity-50"
        >
          <span data-testid="alerts-guide-load-more">
            {loading ? t("loadingMore") : t("loadMore")}
          </span>
        </button>
      )}

      {loading && events.length === 0 && (
        <p className="text-center text-sm text-gray-500 py-4">{t("loading")}</p>
      )}
    </div>
  );
}
