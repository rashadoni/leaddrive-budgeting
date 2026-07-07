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

// ── T9: channel allocation (Codex-designed, 2026-07-07) ─────────────────
// Channel budgets live as TradeBudgetPool rows with grainKey
// "channel:<id>". While no channel-level sales plan exists,
// salesPlanAmount stays 0 and budgetPct carries the ALLOCATION % of the
// org pool (exposed to the API/UI as allocationPct). When real channel
// plans arrive (Mars answers / 9.5), salesPlanAmount fills in and pct
// reverts to its normal budget-% meaning without a schema change.

export const CHANNEL_GRAIN_PREFIX = "channel:";

export function formatChannelGrain(channelId: string): string {
  return `${CHANNEL_GRAIN_PREFIX}${channelId}`;
}

export function parseChannelGrain(grainKey: string): string | null {
  return grainKey.startsWith(CHANNEL_GRAIN_PREFIX)
    ? grainKey.slice(CHANNEL_GRAIN_PREFIX.length)
    : null;
}

export interface ChannelAllocationInput {
  channelId: string;
  allocationPct: number;
}

export interface ChannelAllocationPlan {
  channelId: string;
  grainKey: string;
  allocationPct: number;
  budgetAmount: number;
}

export interface AllocationValidationError {
  code: "duplicate_channel" | "unknown_channel" | "pct_out_of_range" | "sum_exceeds_100";
  detail: string;
}

/**
 * Validate + plan the channel allocation rows for one month.
 * Amounts derive from pct × org budget so a later org re-derive can
 * rebase channel amounts from the stored percentage.
 */
export function planChannelAllocations(
  orgBudgetAmount: number,
  allocations: readonly ChannelAllocationInput[],
  validChannelIds: ReadonlySet<string>
): { plans: ChannelAllocationPlan[]; errors: AllocationValidationError[] } {
  const errors: AllocationValidationError[] = [];
  const seen = new Set<string>();
  for (const a of allocations) {
    if (seen.has(a.channelId)) {
      errors.push({ code: "duplicate_channel", detail: a.channelId });
    }
    seen.add(a.channelId);
    if (!validChannelIds.has(a.channelId)) {
      errors.push({ code: "unknown_channel", detail: a.channelId });
    }
    if (!Number.isFinite(a.allocationPct) || a.allocationPct < 0 || a.allocationPct > 100) {
      errors.push({ code: "pct_out_of_range", detail: `${a.channelId}: ${a.allocationPct}` });
    }
  }
  const sum = allocations.reduce((s, a) => s + a.allocationPct, 0);
  if (sum > 100.01) {
    errors.push({ code: "sum_exceeds_100", detail: `sum=${Math.round(sum * 100) / 100}` });
  }
  if (errors.length > 0) return { plans: [], errors };

  return {
    plans: allocations
      .filter((a) => a.allocationPct > 0)
      .map((a) => ({
        channelId: a.channelId,
        grainKey: formatChannelGrain(a.channelId),
        allocationPct: a.allocationPct,
        budgetAmount: round2((orgBudgetAmount * a.allocationPct) / 100),
      })),
    errors: [],
  };
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
