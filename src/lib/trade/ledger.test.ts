import { describe, expect, it } from "vitest";

import {
  buildSpendCascade,
  rollupCampaignSpend,
  spendEntrySchema,
  summarizeLedger,
  type LedgerEntryForSummary,
} from "./ledger";

const TYPES = {
  onInvoice: { id: "t1", key: "on_invoice_discount", label: "Faktura endirimi", accrualMethod: "on_invoice" as const },
  promo: { id: "t2", key: "promo_payment", label: "Promo ödənişi", accrualMethod: "payment_actual" as const },
};

function entry(
  kind: LedgerEntryForSummary["entryKind"],
  amount: number,
  type: LedgerEntryForSummary["spendType"] = TYPES.onInvoice
): LedgerEntryForSummary {
  return { entryKind: kind, amount, spendType: type };
}

describe("spendEntrySchema", () => {
  it("accepts a manual posting and negative corrections", () => {
    expect(
      spendEntrySchema.parse({
        entryKind: "actual",
        spendTypeId: "t2",
        entryDate: "2026-07-06",
        amount: 5000,
      }).amount
    ).toBe(5000);
    expect(
      spendEntrySchema.parse({
        entryKind: "accrued",
        spendTypeId: "t1",
        entryDate: "2026-07-06",
        amount: -1200,
      }).amount
    ).toBe(-1200);
  });

  it("rejects zero amounts and bad dates", () => {
    expect(() =>
      spendEntrySchema.parse({ entryKind: "plan", spendTypeId: "t1", entryDate: "2026-07-06", amount: 0 })
    ).toThrow();
    expect(() =>
      spendEntrySchema.parse({ entryKind: "plan", spendTypeId: "t1", entryDate: "06.07.2026", amount: 1 })
    ).toThrow();
  });
});

describe("summarizeLedger", () => {
  it("pivots entry kinds into plan/accrued/actual per type", () => {
    const s = summarizeLedger([
      entry("plan", 10_000),
      entry("accrued", 6_000),
      entry("accrued", -500), // credit correction
      entry("actual", 2_000),
    ]);
    expect(s.byType).toHaveLength(1);
    expect(s.byType[0]).toMatchObject({ plan: 10_000, accrued: 5_500, actual: 2_000 });
  });

  it("control = accrued for committed types, actual for payment-gated", () => {
    const s = summarizeLedger([
      entry("accrued", 5_500, TYPES.onInvoice),
      entry("actual", 2_000, TYPES.onInvoice),
      entry("accrued", 9_999, TYPES.promo),
      entry("actual", 3_000, TYPES.promo),
    ]);
    const onInv = s.byType.find((r) => r.key === "on_invoice_discount")!;
    const promo = s.byType.find((r) => r.key === "promo_payment")!;
    expect(onInv.control).toBe(5_500); // accrued drives control
    expect(promo.control).toBe(3_000); // only paid counts
    expect(s.totals.control).toBe(8_500);
    expect(s.totals.accrued).toBe(15_499);
  });

  it("empty ledger → zero totals", () => {
    expect(summarizeLedger([]).totals).toEqual({ plan: 0, accrued: 0, actual: 0, control: 0 });
  });
});

describe("rollupCampaignSpend (T1)", () => {
  it("groups campaign-tagged entries and computes control per method", () => {
    const rollup = rollupCampaignSpend([
      { ...entry("plan", 100_000, TYPES.promo), campaignId: "c1" },
      { ...entry("actual", 30_000, TYPES.promo), campaignId: "c1" },
      { ...entry("accrued", 20_000, TYPES.onInvoice), campaignId: "c1" },
      { ...entry("actual", 9_999, TYPES.promo), campaignId: null }, // untagged — ignored
    ]);
    expect(rollup.get("c1")).toEqual({
      committed: 100_000,
      accrued: 20_000,
      actual: 30_000,
      control: 50_000, // 20k accrued on-invoice + 30k paid promo
    });
    expect(rollup.size).toBe(1);
  });
});

describe("buildSpendCascade (T2)", () => {
  it("available = budget - max(committed, control)", () => {
    const c = buildSpendCascade(500_000, { plan: 200_000, accrued: 120_000, actual: 30_000, control: 150_000 });
    expect(c.available).toBe(300_000); // committed 200k > control 150k
    const c2 = buildSpendCascade(500_000, { plan: 100_000, accrued: 120_000, actual: 60_000, control: 180_000 });
    expect(c2.available).toBe(320_000); // control overtook commitments
  });

  it("goes negative on over-commitment (shown red in UI)", () => {
    const c = buildSpendCascade(100_000, { plan: 130_000, accrued: 0, actual: 0, control: 0 });
    expect(c.available).toBe(-30_000);
  });
});
