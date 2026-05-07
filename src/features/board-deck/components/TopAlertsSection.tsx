/**
 * Phase 7.G Turn LI (Board Deck v2 Turn 4) — top 3 alerts.
 *
 * The board doesn't need the full alerts dump (Risk Terminal's
 * AlertsPanel covers that). They want "what are the 3 things I
 * should think about right now?". Critical-first selection, falling
 * back to warning if no critical, info if neither. Skip rendering
 * when zero alerts (calm green snapshot — don't manufacture risk).
 *
 * Each alert: severity dot (color-coded) + ruleName eyebrow +
 * localized message (via existing `terminal.alerts.messages.<id>`
 * keys; fallback to engine-emitted EN). Affected sub-co count
 * surfaced as a small footnote when applicable. Click-through to
 * Risk Terminal's AlertsPanel via "View all alerts" CTA at bottom.
 *
 * Pure presentational — caller passes resolved
 * `matchesBySeverity` from the snapshot. Server component (uses
 * `getTranslations`).
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  DEFAULT_ALERT_RULE_IDS,
  type AlertMatch,
  type AlertSeverity,
} from "@/lib/risk/alert-rules";
import {
  localizeAlertMessageParams,
  type IndustryTranslator,
} from "@/lib/risk/alert-message-i18n";

export interface TopAlertsSectionProps {
  matchesBySeverity: Record<AlertSeverity, AlertMatch[]>;
  /** Cap on how many to show. Default 3 — board readability. */
  limit?: number;
}

/** Severity → Tailwind classes for the per-alert band pill. */
const SEVERITY_PILL: Record<AlertSeverity, string> = {
  critical: "bg-[#FF4757]/15 text-[#FF4757] border-[#FF4757]/30",
  warning: "bg-[#FFB800]/15 text-[#FFB800] border-[#FFB800]/30",
  info: "bg-[#00D4AA]/15 text-[#00D4AA] border-[#00D4AA]/30",
};

const SEVERITY_DOT: Record<AlertSeverity, string> = {
  critical: "bg-[#FF4757]",
  warning: "bg-[#FFB800]",
  info: "bg-[#00D4AA]",
};

const SEVERITY_LABEL_KEY: Record<AlertSeverity, string> = {
  critical: "alertsPanel.severityCritical",
  warning: "alertsPanel.severityWarning",
  info: "alertsPanel.severityInfo",
};

/** Collect up to `limit` alerts, preferring more-severe first.
 *  Critical-first; warning-fallback; info-fallback. */
function selectTopAlerts(
  matchesBySeverity: Record<AlertSeverity, AlertMatch[]>,
  limit: number,
): Array<{ match: AlertMatch; severity: AlertSeverity }> {
  const out: Array<{ match: AlertMatch; severity: AlertSeverity }> = [];
  const order: AlertSeverity[] = ["critical", "warning", "info"];
  for (const sev of order) {
    for (const match of matchesBySeverity[sev]) {
      if (out.length >= limit) return out;
      out.push({ match, severity: sev });
    }
  }
  return out;
}

export async function TopAlertsSection({
  matchesBySeverity,
  limit = 3,
}: TopAlertsSectionProps) {
  const t = await getTranslations("terminal");
  const tIndustries = (await getTranslations(
    "industries",
  )) as unknown as IndustryTranslator;

  const top = selectTopAlerts(matchesBySeverity, limit);
  const totalCount =
    matchesBySeverity.critical.length +
    matchesBySeverity.warning.length +
    matchesBySeverity.info.length;

  // Calm-snapshot path — zero alerts means zero risk-theatre on the
  // board surface. Render a small "all clear" line instead of an
  // empty-state placeholder. Mirrors AlertsPanel's emptyState tone.
  if (top.length === 0) {
    return (
      <section
        aria-label={t("boardDeck.topAlerts.ariaLabel")}
        data-testid="board-deck-top-alerts"
        className="rounded-lg bg-card border border-border px-6 md:px-12 py-8 print:border-black print:break-inside-avoid"
      >
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
          {t("boardDeck.topAlerts.eyebrow")}
        </p>
        <p
          data-testid="top-alerts-empty"
          className="text-sm text-[#00D4AA]"
        >
          {t("boardDeck.topAlerts.allClear")}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label={t("boardDeck.topAlerts.ariaLabel")}
      data-testid="board-deck-top-alerts"
      className="rounded-lg bg-card border border-border px-6 md:px-12 py-8 print:border-black print:break-inside-avoid"
    >
      <div className="flex items-baseline justify-between mb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {t("boardDeck.topAlerts.eyebrow")}
        </p>
        {totalCount > top.length && (
          <p className="text-xs text-muted-foreground font-mono">
            {t("boardDeck.topAlerts.showingOf", {
              showing: top.length,
              total: totalCount,
            })}
          </p>
        )}
      </div>
      <ul className="space-y-4 list-none mb-6" data-testid="top-alerts-list">
        {top.map(({ match, severity }, idx) => {
          // Sub-35 — alert message i18n. Built-in rules render the
          // locale-aware template; custom or synthetic ruleIds fall
          // back to engine-emitted English.
          let localizedMessage = match.message;
          if (
            match.messageKey &&
            DEFAULT_ALERT_RULE_IDS.has(match.ruleId)
          ) {
            try {
              const localizedParams = localizeAlertMessageParams(
                match.messageParams,
                tIndustries,
              );
              localizedMessage = t(
                match.messageKey as never,
                localizedParams as never,
              );
            } catch {
              // fall back to engine-emitted message
            }
          }
          let localizedRuleName = match.ruleName;
          if (DEFAULT_ALERT_RULE_IDS.has(match.ruleId)) {
            try {
              localizedRuleName = t(`alerts.rules.${match.ruleId}` as never);
            } catch {
              // fall back to ruleName
            }
          }
          return (
            <li
              key={`${match.ruleId}-${idx}`}
              data-testid={`top-alert-${idx}`}
              className="flex gap-3"
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${SEVERITY_DOT[severity]}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
                    {localizedRuleName}
                  </p>
                  <span
                    data-testid={`top-alert-${idx}-band`}
                    className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${SEVERITY_PILL[severity]}`}
                  >
                    {t(SEVERITY_LABEL_KEY[severity] as never)}
                  </span>
                </div>
                <p className="text-sm md:text-base text-foreground/90 leading-relaxed mt-1.5">
                  {localizedMessage}
                </p>
                {match.affectedCompanyIds.length > 0 && (
                  <p className="text-xs text-muted-foreground/70 font-mono mt-1.5">
                    {t("boardDeck.topAlerts.affectedCount", {
                      count: match.affectedCompanyIds.length,
                    })}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Link
        href="/budgeting/terminal"
        data-testid="top-alerts-view-all"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors print:hidden"
      >
        <span>{t("boardDeck.topAlerts.viewAll")}</span>
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </section>
  );
}
