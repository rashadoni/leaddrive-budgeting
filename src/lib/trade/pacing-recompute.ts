// R1 (audit round 2) — shared pacing recompute: org grain + every
// channel grain with budget or attributed spend, snapshot upserts and
// alert-inbox sync in one call. Used by POST /api/trade/pacing AND
// fired automatically after every ledger posting/void so the dashboard
// never shows yesterday's picture ("правда на 15-е число" contract).

import type { PrismaClient } from "@prisma/client";
import { computePacing, type PacingInput } from "./pacing";
import { summarizeLedger, buildSpendCascade, type SpendCascade } from "./ledger";
import { CHANNEL_GRAIN_PREFIX, parseChannelGrain } from "./budget";
import {
  evaluatePacingAlerts,
  pacingAlertScopeKeys,
  syncTradeAlerts,
  type TradeAlertCandidate,
} from "./alerts";

export const ORG_GRAIN = "org";

export interface GrainPacing {
  result: ReturnType<typeof computePacing>;
  cascade: SpendCascade;
}

export async function buildPacingInput(
  prisma: PrismaClient,
  orgId: string,
  year: number,
  month: number,
  grainKey: string = ORG_GRAIN
): Promise<{ input: PacingInput; cascade: SpendCascade }> {
  const now = new Date();
  const isCurrentMonth = now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
  const asOfDay = isCurrentMonth
    ? now.getUTCDate()
    : new Date(Date.UTC(year, month, 0)).getUTCDate();
  const asOf = new Date(Date.UTC(year, month - 1, asOfDay, 23, 59, 59));

  const pool = await prisma.tradeBudgetPool.findUnique({
    where: { organizationId_year_month_grainKey: { organizationId: orgId, year, month, grainKey } },
    select: { salesPlanAmount: true, budgetAmount: true },
  });

  const channelId = parseChannelGrain(grainKey);
  const entries = await prisma.tradeSpendLedger.findMany({
    where: {
      organizationId: orgId,
      year,
      month,
      voidedAt: null,
      entryDate: { lte: asOf },
      ...(channelId ? { channelId } : {}),
    },
    select: {
      entryKind: true,
      amount: true,
      spendType: { select: { id: true, key: true, label: true, accrualMethod: true } },
    },
  });
  const { totals } = summarizeLedger(entries);
  const budgetMonth = pool?.budgetAmount ?? 0;

  return {
    input: {
      year,
      month,
      asOfDay,
      salesPlanMonth: pool?.salesPlanAmount ?? 0,
      // 9.5 pending: daily sales actuals land with the invoice adapter.
      salesActualMtd: 0,
      budgetMonth,
      controlSpendMtd: totals.control,
      accruedSpendMtd: totals.accrued,
      actualSpendMtd: totals.actual,
    },
    cascade: buildSpendCascade(budgetMonth, totals),
  };
}

export interface RecomputeOutcome {
  period: string;
  org: GrainPacing;
  channels: Record<string, GrainPacing>;
  alerts: { created: number; updated: number; resolved: number };
}

/** Recompute org + channel snapshots for (year, month) and sync alerts. */
export async function recomputeTradePacing(
  prisma: PrismaClient,
  orgId: string,
  year: number,
  month: number
): Promise<RecomputeOutcome> {
  const period = `${year}-${String(month).padStart(2, "0")}`;

  async function recomputeGrain(grainKey: string): Promise<GrainPacing> {
    const { input, cascade } = await buildPacingInput(prisma, orgId, year, month, grainKey);
    const result = computePacing(input);
    const asOfDate = new Date(Date.UTC(year, month - 1, input.asOfDay));
    const fields = {
      salesPlanMtd: result.salesPlanMtd,
      salesActualMtd: input.salesActualMtd,
      budgetMonth: input.budgetMonth,
      controlSpendMtd: input.controlSpendMtd,
      accruedSpendMtd: input.accruedSpendMtd,
      actualSpendMtd: input.actualSpendMtd,
      forecastSalesMonth: result.forecastSalesMonth,
      forecastSpendMonth: result.forecastSpendMonth,
      forecastBudgetVariance: result.forecastBudgetVariance,
      forecastSalesGap: result.forecastSalesGap,
      riskStatus: result.riskStatus,
      math: input as unknown as object,
    };
    await prisma.tradePacingSnapshot.upsert({
      where: {
        organizationId_asOfDate_period_grainKey: { organizationId: orgId, asOfDate, period, grainKey },
      },
      create: { organizationId: orgId, asOfDate, period, grainKey, ...fields },
      update: { ...fields, generatedAt: new Date() },
    });
    return { result, cascade };
  }

  const org = await recomputeGrain(ORG_GRAIN);
  const candidates: TradeAlertCandidate[] = evaluatePacingAlerts(period, ORG_GRAIN, org.result);
  const scopeKeys = pacingAlertScopeKeys(period, ORG_GRAIN);

  const channelPools = await prisma.tradeBudgetPool.findMany({
    where: { organizationId: orgId, year, month, grainKey: { startsWith: CHANNEL_GRAIN_PREFIX } },
    select: { grainKey: true },
  });
  const spentChannelIds = await prisma.tradeSpendLedger.findMany({
    where: { organizationId: orgId, year, month, voidedAt: null, channelId: { not: null } },
    select: { channelId: true },
    distinct: ["channelId"],
  });
  const grains = new Set<string>([
    ...channelPools.map((p) => p.grainKey),
    ...spentChannelIds.map((s) => `${CHANNEL_GRAIN_PREFIX}${s.channelId}`),
  ]);
  const channelRows = await prisma.tradeChannel.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
  });
  const channelNameById = new Map(channelRows.map((c) => [c.id, c.name]));

  const channels: Record<string, GrainPacing> = {};
  for (const grainKey of grains) {
    const r = await recomputeGrain(grainKey);
    channels[grainKey] = r;
    const label = channelNameById.get(parseChannelGrain(grainKey) ?? "") ?? grainKey;
    // Channel alerts limited to overspend (anti-noise, Codex T9 rule).
    candidates.push(
      ...evaluatePacingAlerts(period, grainKey, r.result, undefined, label).filter(
        (c) => c.ruleId === "trade_overspend_forecast"
      )
    );
    scopeKeys.push(...pacingAlertScopeKeys(period, grainKey));
  }

  const alerts = await syncTradeAlerts(prisma.alert, orgId, candidates, scopeKeys);
  return { period, org, channels, alerts };
}
