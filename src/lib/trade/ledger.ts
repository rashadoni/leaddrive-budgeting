// Phase 9.6 — spend ledger helpers (pure).
// Design: docs/TRADE_SPEND_CONTROL_TOWER_PLAN.md §4/§5 step 6.
//
// The ledger is append-only; the UI pivots entryKind into the three
// Plan / Accrued / Actual figures. The CONTROL figure (what pacing
// sums against the budget) picks accrued or actual per spend type via
// controlKindForAccrualMethod — never blindly accrued+actual.

import { z } from "zod";
import type { TradeAccrualMethod, TradeSpendEntryKind } from "@prisma/client";
import { controlKindForAccrualMethod } from "./spend-types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd");

export const spendEntrySchema = z.object({
  entryKind: z.enum(["plan", "accrued", "actual"]),
  spendTypeId: z.string().min(1),
  campaignId: z.string().min(1).optional(),
  entryDate: isoDate,
  // Negative = credit/correction posting; zero is meaningless.
  amount: z
    .number()
    .refine((n) => n !== 0, "amount must be non-zero")
    .refine((n) => Math.abs(n) <= 1e12, "amount out of range"),
  note: z.string().max(300).optional(),
});

export type SpendEntryInput = z.infer<typeof spendEntrySchema>;

export interface LedgerEntryForSummary {
  entryKind: TradeSpendEntryKind;
  amount: number;
  spendType: { id: string; key: string; label: string; accrualMethod: TradeAccrualMethod };
}

export interface SpendTypeSummary {
  spendTypeId: string;
  key: string;
  label: string;
  accrualMethod: TradeAccrualMethod;
  plan: number;
  accrued: number;
  actual: number;
  /** accrued or actual, per the type's control kind. */
  control: number;
}

export interface LedgerSummary {
  byType: SpendTypeSummary[];
  totals: { plan: number; accrued: number; actual: number; control: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeLedger(entries: readonly LedgerEntryForSummary[]): LedgerSummary {
  const byId = new Map<string, SpendTypeSummary>();
  for (const e of entries) {
    let row = byId.get(e.spendType.id);
    if (!row) {
      row = {
        spendTypeId: e.spendType.id,
        key: e.spendType.key,
        label: e.spendType.label,
        accrualMethod: e.spendType.accrualMethod,
        plan: 0,
        accrued: 0,
        actual: 0,
        control: 0,
      };
      byId.set(e.spendType.id, row);
    }
    row[e.entryKind] = round2(row[e.entryKind] + e.amount);
  }
  const totals = { plan: 0, accrued: 0, actual: 0, control: 0 };
  for (const row of byId.values()) {
    row.control =
      controlKindForAccrualMethod(row.accrualMethod) === "accrued" ? row.accrued : row.actual;
    totals.plan = round2(totals.plan + row.plan);
    totals.accrued = round2(totals.accrued + row.accrued);
    totals.actual = round2(totals.actual + row.actual);
    totals.control = round2(totals.control + row.control);
  }
  return {
    byType: [...byId.values()].sort((a, b) => a.label.localeCompare(b.label)),
    totals,
  };
}
