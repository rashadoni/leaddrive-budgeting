// Phase 9.8 — Trade alert rules + inbox sync.
// Design: docs/TRADE_SPEND_CONTROL_TOWER_PLAN.md §5 step 8.
//
// evaluatePacingAlerts is pure: PacingResult in → alert candidates out.
// syncTradeAlerts upserts candidates into the Alert inbox by dedupeKey
// and auto-RESOLVES alerts whose condition cleared (resolvedAt — distinct
// from the user's acknowledgedAt). Two of the five planned rules need
// data that lands later: "unplanned spend" (9.6 ledger) and
// "discount without uplift" (9.5 sales attribution).

import type { PacingResult, PacingThresholds } from "./pacing";
import { DEFAULT_PACING_THRESHOLDS } from "./pacing";

export type TradeAlertSeverity = "info" | "warn" | "critical";

export interface TradeAlertCandidate {
  ruleId: "trade_overspend_forecast" | "trade_spend_ahead_of_sales" | "trade_unused_budget";
  severity: TradeAlertSeverity;
  /** EN fallback strings — the digest email and non-i18n consumers. */
  title: string;
  message: string;
  /** R5 — i18n: UI renders trade.alertRules.<ruleId>.{title,message}. */
  messageKey: string;
  /** Pre-formatted display strings (numbers already localized-ish). */
  messageParams: Record<string, string>;
  /** Stable identity: trade:<rule>:<period>:<grainKey>. */
  dedupeKey: string;
  sourceRef: { period: string; grainKey: string; ruleId: string };
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function key(rule: string, period: string, grainKey: string): string {
  return `trade:${rule}:${period}:${grainKey}`;
}

/**
 * All dedupeKeys this evaluation COULD produce for one (period, grain) —
 * the sync step resolves any open alert in this set that has no matching
 * candidate (its condition cleared).
 */
export function pacingAlertScopeKeys(period: string, grainKey: string): string[] {
  return [
    key("trade_overspend_forecast", period, grainKey),
    key("trade_spend_ahead_of_sales", period, grainKey),
    key("trade_unused_budget", period, grainKey),
  ];
}

export function evaluatePacingAlerts(
  period: string, // "YYYY-MM"
  grainKey: string,
  r: PacingResult,
  thresholds: PacingThresholds = DEFAULT_PACING_THRESHOLDS,
  /** Human label for messages (channel name); dedupe still keys on grainKey. */
  label: string = grainKey
): TradeAlertCandidate[] {
  if (r.dataQuality === "empty") return [];
  const out: TradeAlertCandidate[] = [];
  const ref = (ruleId: string) => ({ period, grainKey, ruleId });

  // 1. Month-end overrun forecast (run-rate).
  const overrun = r.forecastBudgetVariancePct;
  if (overrun != null && overrun >= thresholds.overrunPctHigh) {
    const critical = overrun >= thresholds.overrunPctCritical;
    const params = {
      overrunPct: String(overrun),
      forecast: fmt(r.forecastSpendMonth ?? 0),
      budget: fmt(r.math.budgetMonth ?? 0),
      over: fmt(r.forecastBudgetVariance ?? 0),
      period,
      scope: label,
    };
    out.push({
      ruleId: "trade_overspend_forecast",
      severity: critical ? "critical" : "warn",
      title: `Budget overrun forecast: +${overrun}%`,
      message:
        `At the current pace, month-end trade spend reaches ${params.forecast} ` +
        `against a budget of ${params.budget} ` +
        `(+${overrun}%, ${params.over} over). Period ${period}, scope ${label}.`,
      messageKey: "trade_overspend_forecast",
      messageParams: params,
      dedupeKey: key("trade_overspend_forecast", period, grainKey),
      sourceRef: ref("trade_overspend_forecast"),
    });
  }

  // 2. Spend running ahead of sales. Skipped while the sales feed is
  //    pending (T3, audit §1.5) — the gap would compare spend against a
  //    fake 0% sales progress and false-alarm.
  const gap = r.salesFeedPending ? null : r.paceGapPp;
  if (gap != null && gap >= thresholds.paceGapPpHigh) {
    const critical = gap >= thresholds.paceGapPpCritical;
    const params = {
      gapPp: String(gap),
      spendPct: String(r.spendProgressPct ?? 0),
      salesPct: String(r.salesProgressPct ?? 0),
      period,
      scope: label,
    };
    out.push({
      ruleId: "trade_spend_ahead_of_sales",
      severity: critical ? "critical" : "warn",
      title: `Spend ahead of sales by ${gap}pp`,
      message:
        `${params.spendPct}% of the trade budget is spent while only ` +
        `${params.salesPct}% of the month's sales plan is achieved. ` +
        `Period ${period}, scope ${label}.`,
      messageKey: "trade_spend_ahead_of_sales",
      messageParams: params,
      dedupeKey: key("trade_spend_ahead_of_sales", period, grainKey),
      sourceRef: ref("trade_spend_ahead_of_sales"),
    });
  }

  // 3. Unused budget (savings signal, informational). Fires only past
  //    60% of the month so early-month quiet doesn't spam.
  if (
    r.elapsedShare >= 0.6 &&
    r.spendProgressPct != null &&
    r.spendProgressPct < r.elapsedShare * 100 - 20
  ) {
    const params = {
      spendPct: String(r.spendProgressPct),
      elapsedPct: String(Math.round(r.elapsedShare * 100)),
      period,
      scope: label,
    };
    out.push({
      ruleId: "trade_unused_budget",
      severity: "info",
      title: `Unused trade budget: ${params.spendPct}% spent at ${params.elapsedPct}% of month`,
      message:
        `Spend is running well behind the month's pace — potential savings or ` +
        `unexecuted campaigns. Period ${period}, scope ${label}.`,
      messageKey: "trade_unused_budget",
      messageParams: params,
      dedupeKey: key("trade_unused_budget", period, grainKey),
      sourceRef: ref("trade_unused_budget"),
    });
  }

  return out;
}

// ── Inbox sync ───────────────────────────────────────────────────────────

interface AlertDelegate {
  findMany(args: {
    where: { organizationId: string; domain: string; resolvedAt: null; dedupeKey: { in: string[] } };
    select: { id: true; dedupeKey: true; severity: true; message: true; messageKey: true };
  }): Promise<
    { id: string; dedupeKey: string | null; severity: string; message: string; messageKey: string | null }[]
  >;
  /**
   * Codex review #5 — upsert on the (organizationId, dedupeKey) unique
   * instead of read-then-create: closes BOTH the concurrent-recompute
   * race (P2002 after the ledger write committed) AND the re-trigger
   * breaker — a RESOLVED row keeps its dedupeKey, so a plain create
   * would collide the next time the same condition fires.
   */
  upsert(args: {
    where: { organizationId_dedupeKey: { organizationId: string; dedupeKey: string } };
    // Concrete shapes (not Record<string, unknown>) — they must be
    // assignable to Prisma's Alert create/update inputs for the real
    // delegate to satisfy this interface.
    create: {
      organizationId: string;
      type: string;
      domain: string;
      sourceRef: { period: string; grainKey: string; ruleId: string };
      severity: string;
      title: string;
      message: string;
      messageKey: string;
      messageParams: Record<string, string>;
      dedupeKey: string;
    };
    update: {
      severity: string;
      title: string;
      message: string;
      messageKey: string;
      messageParams: Record<string, string>;
      sourceRef: { period: string; grainKey: string; ruleId: string };
      resolvedAt: null;
      acknowledgedAt: null;
      acknowledgedBy: null;
      triggeredAt: Date;
    };
  }): Promise<unknown>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  updateMany(args: {
    where: { organizationId: string; domain: string; resolvedAt: null; dedupeKey: { in: string[] } };
    data: { resolvedAt: Date };
  }): Promise<{ count: number }>;
}

export interface SyncResult {
  created: number;
  updated: number;
  resolved: number;
}

/**
 * Reconcile the Alert inbox with this evaluation round.
 * `scopeKeys` = every dedupeKey the evaluation could have produced
 * (see pacingAlertScopeKeys); open alerts in scope without a matching
 * candidate get resolvedAt stamped.
 */
export async function syncTradeAlerts(
  alerts: AlertDelegate,
  organizationId: string,
  candidates: TradeAlertCandidate[],
  scopeKeys: string[]
): Promise<SyncResult> {
  const now = new Date();
  const result: SyncResult = { created: 0, updated: 0, resolved: 0 };

  const open = await alerts.findMany({
    where: { organizationId, domain: "trade", resolvedAt: null, dedupeKey: { in: scopeKeys } },
    select: { id: true, dedupeKey: true, severity: true, message: true, messageKey: true },
  });
  const openByKey = new Map(open.map((a) => [a.dedupeKey ?? "", a]));
  const candidateKeys = new Set(candidates.map((c) => c.dedupeKey));

  for (const c of candidates) {
    const existing = openByKey.get(c.dedupeKey);
    if (existing) {
      // Third clause = R5 self-heal: pre-i18n rows gain their messageKey
      // on the next evaluation round.
      if (existing.severity !== c.severity || existing.message !== c.message || !existing.messageKey) {
        await alerts.update({
          where: { id: existing.id },
          data: {
            severity: c.severity,
            message: c.message,
            title: c.title,
            messageKey: c.messageKey,
            messageParams: c.messageParams,
          },
        });
        result.updated += 1;
      }
    } else {
      // Not open — either brand-new or a previously RESOLVED row holding
      // the same dedupeKey. Upsert re-arms the resolved row (re-open,
      // un-acknowledge, fresh trigger time) and survives concurrent
      // recomputes racing on the unique key.
      await alerts.upsert({
        where: { organizationId_dedupeKey: { organizationId, dedupeKey: c.dedupeKey } },
        create: {
          organizationId,
          type: "trade_pacing",
          domain: "trade",
          sourceRef: c.sourceRef,
          severity: c.severity,
          title: c.title,
          message: c.message,
          messageKey: c.messageKey,
          messageParams: c.messageParams,
          dedupeKey: c.dedupeKey,
        },
        update: {
          severity: c.severity,
          title: c.title,
          message: c.message,
          messageKey: c.messageKey,
          messageParams: c.messageParams,
          sourceRef: c.sourceRef,
          resolvedAt: null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          triggeredAt: now,
        },
      });
      result.created += 1;
    }
  }

  const staleKeys = scopeKeys.filter((k) => !candidateKeys.has(k) && openByKey.has(k));
  if (staleKeys.length > 0) {
    const res = await alerts.updateMany({
      where: { organizationId, domain: "trade", resolvedAt: null, dedupeKey: { in: staleKeys } },
      data: { resolvedAt: now },
    });
    result.resolved = res.count;
  }

  return result;
}
