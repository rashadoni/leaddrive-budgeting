import { describe, expect, it } from "vitest";

import {
  evaluatePacingAlerts,
  pacingAlertScopeKeys,
  syncTradeAlerts,
  type TradeAlertCandidate,
} from "./alerts";
import { computePacing } from "./pacing";

const UNIFORM = [1, 1, 1, 1, 1, 1, 1] as const;

function pacing(overrides: Partial<Parameters<typeof computePacing>[0]> = {}) {
  return computePacing({
    year: 2026,
    month: 9,
    asOfDay: 20,
    salesPlanMonth: 1_000_000,
    salesActualMtd: 660_000, // on pace
    budgetMonth: 100_000,
    controlSpendMtd: 66_000, // on pace
    accruedSpendMtd: 0,
    actualSpendMtd: 0,
    weights: UNIFORM,
    ...overrides,
  });
}

describe("evaluatePacingAlerts", () => {
  it("stays quiet when everything is on pace", () => {
    expect(evaluatePacingAlerts("2026-09", "org", pacing())).toEqual([]);
  });

  it("fires overspend forecast at high, escalates to critical", () => {
    const warn = evaluatePacingAlerts("2026-09", "org", pacing({ controlSpendMtd: 74_000 }));
    expect(warn.map((a) => a.ruleId)).toContain("trade_overspend_forecast");
    expect(warn.find((a) => a.ruleId === "trade_overspend_forecast")!.severity).toBe("warn");

    const crit = evaluatePacingAlerts("2026-09", "org", pacing({ controlSpendMtd: 82_000 }));
    expect(crit.find((a) => a.ruleId === "trade_overspend_forecast")!.severity).toBe("critical");
  });

  it("fires spend-ahead-of-sales on the pace gap", () => {
    const r = pacing({ salesActualMtd: 300_000, controlSpendMtd: 66_000 }); // 66% spend vs 30% sales
    const alerts = evaluatePacingAlerts("2026-09", "org", r);
    const gapAlert = alerts.find((a) => a.ruleId === "trade_spend_ahead_of_sales");
    expect(gapAlert).toBeDefined();
    expect(gapAlert!.severity).toBe("critical"); // 36pp ≥ 25pp
    expect(gapAlert!.dedupeKey).toBe("trade:trade_spend_ahead_of_sales:2026-09:org");
  });

  it("flags unused budget only past 60% of the month", () => {
    const late = evaluatePacingAlerts("2026-09", "org", pacing({ controlSpendMtd: 20_000 }));
    expect(late.map((a) => a.ruleId)).toContain("trade_unused_budget");
    expect(late.find((a) => a.ruleId === "trade_unused_budget")!.severity).toBe("info");

    const early = evaluatePacingAlerts(
      "2026-09",
      "org",
      pacing({ asOfDay: 10, controlSpendMtd: 5_000, salesActualMtd: 330_000 })
    );
    expect(early.map((a) => a.ruleId)).not.toContain("trade_unused_budget");
  });

  it("emits nothing for empty data (no false alarms)", () => {
    const r = pacing({ salesPlanMonth: 0, budgetMonth: 0, controlSpendMtd: 0, salesActualMtd: 0 });
    expect(evaluatePacingAlerts("2026-09", "org", r)).toEqual([]);
  });
});

describe("syncTradeAlerts", () => {
  function mockDelegate(
    open: { id: string; dedupeKey: string; severity: string; message: string; messageKey?: string | null }[],
  ) {
    const calls = { created: [] as unknown[], updated: [] as unknown[], resolvedKeys: [] as string[] };
    return {
      calls,
      delegate: {
        findMany: async () => open.map((o) => ({ messageKey: null, ...o })),
        upsert: async (args: { create: Record<string, unknown> }) => {
          calls.created.push(args.create);
          return {};
        },
        update: async (args: unknown) => {
          calls.updated.push(args);
          return {};
        },
        updateMany: async (args: {
          where: { dedupeKey: { in: string[] } };
          data: { resolvedAt: Date };
        }) => {
          calls.resolvedKeys.push(...args.where.dedupeKey.in);
          return { count: args.where.dedupeKey.in.length };
        },
      },
    };
  }

  const candidate: TradeAlertCandidate = {
    ruleId: "trade_overspend_forecast",
    severity: "warn",
    title: "t",
    message: "m",
    messageKey: "trade_overspend_forecast",
    messageParams: { overrunPct: "10", period: "2026-09", scope: "org" },
    dedupeKey: "trade:trade_overspend_forecast:2026-09:org",
    sourceRef: { period: "2026-09", grainKey: "org", ruleId: "trade_overspend_forecast" },
  };
  const scope = pacingAlertScopeKeys("2026-09", "org");

  it("creates new alerts", async () => {
    const { delegate, calls } = mockDelegate([]);
    const res = await syncTradeAlerts(delegate, "org1", [candidate], scope);
    expect(res).toEqual({ created: 1, updated: 0, resolved: 0 });
    expect(calls.created).toHaveLength(1);
  });

  it("updates changed alerts instead of duplicating", async () => {
    const { delegate, calls } = mockDelegate([
      { id: "a1", dedupeKey: candidate.dedupeKey, severity: "warn", message: "old" },
    ]);
    const res = await syncTradeAlerts(delegate, "org1", [candidate], scope);
    expect(res).toEqual({ created: 0, updated: 1, resolved: 0 });
    expect(calls.updated).toHaveLength(1);
  });

  it("is a no-op when nothing changed", async () => {
    const { delegate, calls } = mockDelegate([
      { id: "a1", dedupeKey: candidate.dedupeKey, severity: "warn", message: "m", messageKey: candidate.messageKey },
    ]);
    const res = await syncTradeAlerts(delegate, "org1", [candidate], scope);
    expect(res).toEqual({ created: 0, updated: 0, resolved: 0 });
    expect(calls.created).toHaveLength(0);
    expect(calls.updated).toHaveLength(0);
  });

  it("resolves open alerts whose condition cleared", async () => {
    const staleKey = "trade:trade_spend_ahead_of_sales:2026-09:org";
    const { delegate, calls } = mockDelegate([
      { id: "a2", dedupeKey: staleKey, severity: "critical", message: "x" },
    ]);
    const res = await syncTradeAlerts(delegate, "org1", [], scope);
    expect(res.resolved).toBe(1);
    expect(calls.resolvedKeys).toEqual([staleKey]);
  });

  it("backfills messageKey on pre-i18n rows (R5 self-heal)", async () => {
    const { delegate, calls } = mockDelegate([
      { id: "a1", dedupeKey: candidate.dedupeKey, severity: "warn", message: "m", messageKey: null },
    ]);
    const res = await syncTradeAlerts(delegate, "org1", [candidate], scope);
    expect(res).toEqual({ created: 0, updated: 1, resolved: 0 });
    expect(calls.updated).toHaveLength(1);
  });
});
