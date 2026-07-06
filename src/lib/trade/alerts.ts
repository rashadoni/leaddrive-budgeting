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
  title: string;
  message: string;
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
  thresholds: PacingThresholds = DEFAULT_PACING_THRESHOLDS
): TradeAlertCandidate[] {
  if (r.dataQuality === "empty") return [];
  const out: TradeAlertCandidate[] = [];
  const ref = (ruleId: string) => ({ period, grainKey, ruleId });

  // 1. Month-end overrun forecast (run-rate).
  const overrun = r.forecastBudgetVariancePct;
  if (overrun != null && overrun >= thresholds.overrunPctHigh) {
    const critical = overrun >= thresholds.overrunPctCritical;
    out.push({
      ruleId: "trade_overspend_forecast",
      severity: critical ? "critical" : "warn",
      title: `Budget overrun forecast: +${overrun}%`,
      message:
        `At the current pace, month-end trade spend reaches ${fmt(r.forecastSpendMonth ?? 0)} ` +
        `against a budget of ${fmt(r.math.budgetMonth ?? 0)} ` +
        `(+${overrun}%, ${fmt(r.forecastBudgetVariance ?? 0)} over). Period ${period}, scope ${grainKey}.`,
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
    out.push({
      ruleId: "trade_spend_ahead_of_sales",
      severity: critical ? "critical" : "warn",
      title: `Spend ahead of sales by ${gap}pp`,
      message:
        `${r.spendProgressPct}% of the trade budget is spent while only ` +
        `${r.salesProgressPct}% of the month's sales plan is achieved. ` +
        `Period ${period}, scope ${grainKey}.`,
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
    out.push({
      ruleId: "trade_unused_budget",
      severity: "info",
      title: `Unused trade budget: ${r.spendProgressPct}% spent at ${Math.round(r.elapsedShare * 100)}% of month`,
      message:
        `Spend is running well behind the month's pace — potential savings or ` +
        `unexecuted campaigns. Period ${period}, scope ${grainKey}.`,
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
    select: { id: true; dedupeKey: true; severity: true; message: true };
  }): Promise<{ id: string; dedupeKey: string | null; severity: string; message: string }[]>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
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
    select: { id: true, dedupeKey: true, severity: true, message: true },
  });
  const openByKey = new Map(open.map((a) => [a.dedupeKey ?? "", a]));
  const candidateKeys = new Set(candidates.map((c) => c.dedupeKey));

  for (const c of candidates) {
    const existing = openByKey.get(c.dedupeKey);
    if (existing) {
      if (existing.severity !== c.severity || existing.message !== c.message) {
        await alerts.update({
          where: { id: existing.id },
          data: { severity: c.severity, message: c.message, title: c.title },
        });
        result.updated += 1;
      }
    } else {
      await alerts.create({
        data: {
          organizationId,
          type: "trade_pacing",
          domain: "trade",
          sourceRef: c.sourceRef,
          severity: c.severity,
          title: c.title,
          message: c.message,
          dedupeKey: c.dedupeKey,
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
