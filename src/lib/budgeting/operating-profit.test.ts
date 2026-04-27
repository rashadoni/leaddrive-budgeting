import { describe, it, expect } from "vitest";
import { computeOperatingProfit } from "./operating-profit";

describe("computeOperatingProfit (Turn 38 — Workspace bottom-row math)", () => {
  it("typical positive: rev=240M − cogs=188M − opex=40M → 12M", () => {
    expect(computeOperatingProfit(240_000_000, 188_000_000, 40_000_000)).toBe(12_000_000);
  });

  it("revenue=0 → negative result equal to −(cogs + opex)", () => {
    expect(computeOperatingProfit(0, 100_000, 50_000)).toBe(-150_000);
  });

  it("cogs > revenue (gross loss): rev=50 − cogs=80 − opex=20 → -50", () => {
    expect(computeOperatingProfit(50, 80, 20)).toBe(-50);
  });

  it("all zero → 0", () => {
    expect(computeOperatingProfit(0, 0, 0)).toBe(0);
  });
});
