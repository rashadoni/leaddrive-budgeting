/**
 * Financial-truth-infra Phase E.1 — period snapshot helpers.
 *
 * Two operations:
 *   - `createPeriodSnapshot(prisma, orgId, period, signedBy, signoffNote)`
 *     — called when admin locks a period. Hashes IndicatorValue +
 *     BudgetLine rows scoped to that period and writes a PeriodSnapshot.
 *   - `verifyPeriodSnapshot(prisma, orgId, period)` — recomputes the
 *     hashes against current DB state, compares against the most-recent
 *     PeriodSnapshot, returns { matches: boolean, currentHashes, snapshot }.
 *     Lets the recompute pipeline (or a periodic verifier) detect when a
 *     signed period has been silently mutated.
 *
 * Hash strategy: deterministic SHA-256 over canonical JSON. Rows sorted
 * by composite key, only the relevant fields included (excludes
 * createdAt/updatedAt/audit columns). Identical inputs → identical
 * hash; one field flip → different hash.
 */

import { createHash } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export interface PeriodSnapshotAggregates {
  ivCount: number;
  budgetLineCount: number;
  revenueTotal: number;
  cogsTotal: number;
  /** revenue - cogs (cogs stored as positive number). */
  grossProfit: number;
}

export interface PeriodSnapshotResult {
  id: string;
  period: string;
  signedAt: Date;
  ivHash: string;
  budgetHash: string;
  aggregates: PeriodSnapshotAggregates;
}

interface IvForHash {
  companyId: string;
  indicatorId: string;
  value: number;
  status: string;
  period: string;
}

interface BudgetLineForHash {
  planId: string;
  companyId: string | null;
  accountId: string;
  monthIndex: number | null;
  plannedAmount: number;
  lineType: string;
}

function canonicalize<T>(items: T[], orderKeys: Array<keyof T>): string {
  const sorted = [...items].sort((a, b) => {
    for (const k of orderKeys) {
      const av = String(a[k] ?? "");
      const bv = String(b[k] ?? "");
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
  return JSON.stringify(sorted);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Read IV + BudgetLine rows for the period, hash them, return both hashes
 * and the aggregate fingerprint. Used by both createPeriodSnapshot (on
 * lock) and verifyPeriodSnapshot (drift check).
 */
export async function computePeriodHashes(
  // Phase 8 D5(b) — accept TransactionClient too so callers wrapped
  // in `withOrgScope` thread the tx through.
  prisma: PrismaClient | Prisma.TransactionClient,
  orgId: string,
  period: string,
): Promise<{
  ivHash: string;
  budgetHash: string;
  aggregates: PeriodSnapshotAggregates;
}> {
  // Period maps to year for BudgetLine matching (BudgetPlan.year). Strip
  // any "-Q[1-4]" or "-MM" suffix to find the underlying calendar year.
  const yearStr = period.split("-")[0];
  const year = Number(yearStr);

  const ivs = await prisma.indicatorValue.findMany({
    where: { organizationId: orgId, period },
    select: { companyId: true, indicatorId: true, value: true, status: true, period: true },
  });
  const ivCanon: IvForHash[] = ivs.map((iv) => ({
    companyId: iv.companyId,
    indicatorId: iv.indicatorId,
    value: iv.value,
    status: iv.status,
    period: iv.period,
  }));
  const ivHash = sha256(
    canonicalize<IvForHash>(ivCanon, ["companyId", "indicatorId", "period"]),
  );

  const lines = await prisma.budgetLine.findMany({
    where: {
      organizationId: orgId,
      plan: { is: { year } },
      // deletedAt:null (2026-05-31): enumerate plans/companies with LIVE lines.
      deletedAt: null,
    },
    select: {
      planId: true,
      companyId: true,
      accountId: true,
      monthIndex: true,
      plannedAmount: true,
      lineType: true,
    },
  });
  const blCanon: BudgetLineForHash[] = lines.map((bl) => ({
    planId: bl.planId,
    companyId: bl.companyId,
    accountId: bl.accountId,
    monthIndex: bl.monthIndex,
    plannedAmount: bl.plannedAmount,
    lineType: bl.lineType,
  }));
  const budgetHash = sha256(
    canonicalize<BudgetLineForHash>(blCanon, [
      "planId",
      "companyId",
      "accountId",
      "monthIndex",
    ]),
  );

  const revenueTotal = lines
    .filter((l) => l.lineType === "revenue")
    .reduce((a, b) => a + b.plannedAmount, 0);
  const cogsTotal = lines
    .filter((l) => l.lineType === "cogs")
    .reduce((a, b) => a + Math.abs(b.plannedAmount), 0);

  return {
    ivHash,
    budgetHash,
    aggregates: {
      ivCount: ivs.length,
      budgetLineCount: lines.length,
      revenueTotal,
      cogsTotal,
      grossProfit: revenueTotal - cogsTotal,
    },
  };
}

/**
 * Persist a PeriodSnapshot for the given period. Called by the lock
 * handler in `/api/budgeting/period-locks/route.ts` immediately after
 * adding the period to `Organization.lockedPeriods`. Idempotent — the
 * unique constraint is implicit via the (orgId, period, signedAt) index
 * but we DO allow multiple rows per period (re-sign on unlock+relock).
 */
export async function createPeriodSnapshot(
  // Stage 3 RLS — accept TransactionClient too so period-locks POST
  // threads its withOrgScope tx (computePeriodHashes already does).
  prisma: PrismaClient | Prisma.TransactionClient,
  orgId: string,
  period: string,
  signedBy: string,
  signoffNote: string | null = null,
): Promise<PeriodSnapshotResult> {
  const { ivHash, budgetHash, aggregates } = await computePeriodHashes(prisma, orgId, period);
  const row = await prisma.periodSnapshot.create({
    data: {
      organizationId: orgId,
      period,
      signedBy,
      ivHash,
      budgetHash,
      aggregates: aggregates as unknown as object,
      signoffNote,
    },
    select: { id: true, period: true, signedAt: true, ivHash: true, budgetHash: true },
  });
  return {
    id: row.id,
    period: row.period,
    signedAt: row.signedAt,
    ivHash: row.ivHash,
    budgetHash: row.budgetHash,
    aggregates,
  };
}

/**
 * Recompute current hashes + compare against the most recent snapshot
 * for this period. `matches: false` means the locked period has drifted
 * since signoff — caller should flag via audit-log (action:
 * `period_snapshot_drift` — to be added in a follow-up).
 */
export async function verifyPeriodSnapshot(
  // Phase 8 D5(b) — accept TransactionClient too so callers wrapped
  // in `withOrgScope` thread the tx through.
  prisma: PrismaClient | Prisma.TransactionClient,
  orgId: string,
  period: string,
): Promise<{
  matches: boolean;
  hasSnapshot: boolean;
  current: { ivHash: string; budgetHash: string };
  snapshot: { ivHash: string; budgetHash: string; signedAt: Date } | null;
}> {
  const snap = await prisma.periodSnapshot.findFirst({
    where: { organizationId: orgId, period },
    orderBy: { signedAt: "desc" },
    select: { ivHash: true, budgetHash: true, signedAt: true },
  });
  const current = await computePeriodHashes(prisma, orgId, period);
  if (!snap) {
    return {
      matches: false,
      hasSnapshot: false,
      current: { ivHash: current.ivHash, budgetHash: current.budgetHash },
      snapshot: null,
    };
  }
  return {
    matches: snap.ivHash === current.ivHash && snap.budgetHash === current.budgetHash,
    hasSnapshot: true,
    current: { ivHash: current.ivHash, budgetHash: current.budgetHash },
    snapshot: snap,
  };
}
