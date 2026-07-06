import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRADE_SPEND_TYPES,
  buildDefaultSpendTypeRows,
  controlKindForAccrualMethod,
} from "./spend-types";

describe("DEFAULT_TRADE_SPEND_TYPES", () => {
  it("has unique keys and sortOrders", () => {
    const keys = DEFAULT_TRADE_SPEND_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    const orders = DEFAULT_TRADE_SPEND_TYPES.map((t) => t.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("covers every default the A2 assumption names", () => {
    const keys = DEFAULT_TRADE_SPEND_TYPES.map((t) => t.key);
    expect(keys).toEqual([
      "on_invoice_discount",
      "retro_bonus",
      "listing_fee",
      "promo_payment",
      "free_goods",
      "posm",
    ]);
  });
});

describe("buildDefaultSpendTypeRows", () => {
  it("stamps every row with the org id and createMany-compatible fields", () => {
    const rows = buildDefaultSpendTypeRows("org_1");
    expect(rows).toHaveLength(DEFAULT_TRADE_SPEND_TYPES.length);
    for (const row of rows) {
      expect(row.organizationId).toBe("org_1");
      expect(Object.keys(row).sort()).toEqual(
        ["accrualMethod", "key", "label", "organizationId", "sortOrder"].sort()
      );
    }
  });
});

describe("controlKindForAccrualMethod", () => {
  it("uses accrued for committed-before-settlement methods", () => {
    expect(controlKindForAccrualMethod("on_invoice")).toBe("accrued");
    expect(controlKindForAccrualMethod("retro_formula")).toBe("accrued");
    expect(controlKindForAccrualMethod("free_goods")).toBe("accrued");
  });

  it("uses actual for payment-gated methods", () => {
    expect(controlKindForAccrualMethod("payment_actual")).toBe("actual");
    expect(controlKindForAccrualMethod("posm_merchandising")).toBe("actual");
    expect(controlKindForAccrualMethod("manual")).toBe("actual");
  });
});
