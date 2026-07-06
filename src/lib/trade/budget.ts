// Phase 9.3 — trade budget derivation helpers (pure).
// Design: docs/TRADE_SPEND_CONTROL_TOWER_PLAN.md §5 step 3.
//
// ASSUMPTION A3 (pending Mars Overseas confirmation): trade budget =
// budgetPct % of the monthly sales plan; default 5% sits inside the
// beverage-industry 3-10% norm and is editable per pool. Manual
// budgetAmount overrides survive re-derivation.

export const DEFAULT_BUDGET_PCT = 5;

export interface ExistingPool {
  month: number;
  budgetPct: number;
  budgetAmount: number;
  isManualAmount: boolean;
}

export interface PoolUpsert {
  month: number;
  salesPlanAmount: number;
  budgetPct: number;
  budgetAmount: number;
  /** what re-derive did: fresh row, refreshed sales base, or kept manual override. */
  action: "create" | "update" | "keep_manual";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Plan the 12 monthly pool upserts for a year.
 * - months with no sales plan AND no existing pool are skipped;
 * - per-pool budgetPct set earlier by the user survives re-derivation;
 * - manual budgetAmount overrides are never recomputed (action=keep_manual).
 */
export function planPoolUpserts(
  salesByMonth: ReadonlyMap<number, number>,
  existing: readonly ExistingPool[],
  defaultPct: number = DEFAULT_BUDGET_PCT
): PoolUpsert[] {
  const byMonth = new Map(existing.map((p) => [p.month, p]));
  const out: PoolUpsert[] = [];
  for (let month = 1; month <= 12; month++) {
    const sales = round2(salesByMonth.get(month) ?? 0);
    const prior = byMonth.get(month);
    if (sales === 0 && !prior) continue;
    const pct = prior?.budgetPct ?? defaultPct;
    if (prior?.isManualAmount) {
      out.push({
        month,
        salesPlanAmount: sales,
        budgetPct: pct,
        budgetAmount: prior.budgetAmount,
        action: "keep_manual",
      });
    } else {
      out.push({
        month,
        salesPlanAmount: sales,
        budgetPct: pct,
        budgetAmount: round2((sales * pct) / 100),
        action: prior ? "update" : "create",
      });
    }
  }
  return out;
}

/** Recompute a pool after a PATCH: pct change recalculates the amount; amount change flips manual. */
export function applyPoolPatch(
  pool: { salesPlanAmount: number; budgetPct: number; budgetAmount: number; isManualAmount: boolean },
  patch: { budgetPct?: number; budgetAmount?: number }
): { budgetPct: number; budgetAmount: number; isManualAmount: boolean } {
  if (patch.budgetAmount !== undefined) {
    return {
      budgetPct: pool.budgetPct,
      budgetAmount: round2(patch.budgetAmount),
      isManualAmount: true,
    };
  }
  if (patch.budgetPct !== undefined) {
    return {
      budgetPct: patch.budgetPct,
      budgetAmount: round2((pool.salesPlanAmount * patch.budgetPct) / 100),
      isManualAmount: false,
    };
  }
  return {
    budgetPct: pool.budgetPct,
    budgetAmount: pool.budgetAmount,
    isManualAmount: pool.isManualAmount,
  };
}
