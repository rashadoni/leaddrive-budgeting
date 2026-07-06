// Phase 9.1 — Trade Spend Control Tower: spend-type dictionary helpers.
// Design: docs/TRADE_SPEND_CONTROL_TOWER_PLAN.md §4.
//
// TradeSpendType is a per-org dictionary (schema: trade_spend_types).
// These defaults seed a new org with the spend types confirmed/assumed
// for Mars Overseas (assumption A2 — validate with customer). Orgs can
// add/deactivate types at runtime without schema changes.

import type { TradeAccrualMethod } from "@prisma/client";

export interface DefaultTradeSpendType {
  key: string;
  label: string;
  accrualMethod: TradeAccrualMethod;
  sortOrder: number;
}

export const DEFAULT_TRADE_SPEND_TYPES: readonly DefaultTradeSpendType[] = [
  { key: "on_invoice_discount", label: "Faktura endirimi", accrualMethod: "on_invoice", sortOrder: 1 },
  { key: "retro_bonus", label: "Retro bonus", accrualMethod: "retro_formula", sortOrder: 2 },
  { key: "listing_fee", label: "Listing haqqı", accrualMethod: "payment_actual", sortOrder: 3 },
  { key: "promo_payment", label: "Promo ödənişi", accrualMethod: "payment_actual", sortOrder: 4 },
  { key: "free_goods", label: "Pulsuz mal", accrualMethod: "free_goods", sortOrder: 5 },
  { key: "posm", label: "POSM / Merchandising", accrualMethod: "posm_merchandising", sortOrder: 6 },
] as const;

/** Rows ready for prisma.tradeSpendType.createMany on org onboarding. */
export function buildDefaultSpendTypeRows(organizationId: string) {
  return DEFAULT_TRADE_SPEND_TYPES.map((t) => ({
    organizationId,
    key: t.key,
    label: t.label,
    accrualMethod: t.accrualMethod,
    sortOrder: t.sortOrder,
  }));
}

/**
 * Which ledger figure is the *control* number for pacing (§4 of the plan):
 * for spend that becomes economically committed before settlement
 * (on-invoice discounts, formula retro bonuses, shipped free goods) the
 * accrued figure drives budget control; payment-gated types count only
 * when actually paid/posted. Accrued and actual stay visible separately
 * in every UI — this only picks the number `controlSpendMtd` sums.
 */
export function controlKindForAccrualMethod(
  method: TradeAccrualMethod
): "accrued" | "actual" {
  switch (method) {
    case "on_invoice":
    case "retro_formula":
    case "free_goods":
      return "accrued";
    case "payment_actual":
    case "posm_merchandising":
    case "manual":
      return "actual";
  }
}
