// Codex review #4 — when the ORG pool's budgetAmount changes (derive or
// manual patch), channel-grain pools must be rebased from their stored
// allocation % and their TradePlanDaily rows regenerated; otherwise
// channel pacing and the unallocated figure silently go stale.

import type { Prisma, PrismaClient } from "@prisma/client";
import { CHANNEL_GRAIN_PREFIX } from "./budget";
import { spreadMonthlyPlan } from "./pacing";

type Tx = PrismaClient | Prisma.TransactionClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rebase every channel pool of (year, month) to `orgBudgetAmount` × stored %. */
export async function rebaseChannelPools(
  tx: Tx,
  organizationId: string,
  year: number,
  month: number,
  orgBudgetAmount: number
): Promise<number> {
  const channelPools = await tx.tradeBudgetPool.findMany({
    where: { organizationId, year, month, grainKey: { startsWith: CHANNEL_GRAIN_PREFIX } },
    select: { grainKey: true, budgetPct: true },
  });
  for (const p of channelPools) {
    const amount = round2((orgBudgetAmount * p.budgetPct) / 100);
    await tx.tradeBudgetPool.update({
      where: {
        organizationId_year_month_grainKey: { organizationId, year, month, grainKey: p.grainKey },
      },
      data: { budgetAmount: amount },
    });
    await tx.tradePlanDaily.deleteMany({
      where: { organizationId, year, month, grainKey: p.grainKey },
    });
    const spread = spreadMonthlyPlan(year, month, amount);
    await tx.tradePlanDaily.createMany({
      data: spread.map((d) => ({
        organizationId,
        date: new Date(Date.UTC(year, month - 1, d.day)),
        year,
        month,
        grainKey: p.grainKey,
        plannedSalesAmount: 0,
        plannedTradeBudgetAmount: d.amount,
        workingDayWeight: d.weight,
      })),
    });
  }
  return channelPools.length;
}
