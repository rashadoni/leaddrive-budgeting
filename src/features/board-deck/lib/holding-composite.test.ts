/**
 * Phase 7.G Turn XLVIII (Board Deck v2 Turn 2) — holding-composite tests.
 *
 * Locks: weighted-mean math, null-skip semantics (skips both
 * numerator AND denominator), all-null returns null score, single-
 * sub-co edge, threshold-band assignment matching scoreToBand.
 */

import { describe, it, expect } from "vitest";
import { computeHoldingComposite } from "./holding-composite";
import type { CompositeScore } from "@/lib/risk/composite-score";

function score(s: number, band: CompositeScore["band"]): CompositeScore {
  return { score: s, band, contributingCount: 5, totalCount: 5, coverage: "full" };
}

/** 11.81 — a sub-co withheld for thin coverage. */
function unscored(contributing = 0, total = 5): CompositeScore {
  return {
    score: null,
    band: "unknown",
    contributingCount: contributing,
    totalCount: total,
    coverage: contributing === 0 ? "none" : "insufficient",
  };
}

describe("computeHoldingComposite", () => {
  it("simple unweighted mean across operational sub-cos", () => {
    const composites = new Map<string, CompositeScore>([
      ["co_1", score(60, "amber")],
      ["co_2", score(80, "green")],
      ["co_3", score(40, "amber")],
    ]);
    const result = computeHoldingComposite(composites, ["co_1", "co_2", "co_3"]);
    expect(result.score).toBe(60); // (60+80+40)/3 = 60
    expect(result.contributingCount).toBe(3);
    expect(result.totalCount).toBe(3);
    // canonical scoreToBand: ≥67 green / ≥34 amber / else red.
    // 60 falls in [34, 67) → amber.
    expect(result.band).toBe("amber");
  });

  it("rounds to nearest integer", () => {
    const composites = new Map<string, CompositeScore>([
      ["co_1", score(50, "amber")],
      ["co_2", score(51, "amber")],
      ["co_3", score(52, "amber")],
    ]);
    const result = computeHoldingComposite(composites, ["co_1", "co_2", "co_3"]);
    expect(result.score).toBe(51); // (50+51+52)/3 = 51 exact
  });

  it("rounds 0.5 toward even (Banker's? — actually JS Math.round rounds half-up)", () => {
    const composites = new Map<string, CompositeScore>([
      ["co_1", score(60, "amber")],
      ["co_2", score(61, "amber")],
    ]);
    const result = computeHoldingComposite(composites, ["co_1", "co_2"]);
    // (60+61)/2 = 60.5 → Math.round → 61 (half-up).
    expect(result.score).toBe(61);
  });

  it("skips null-score sub-cos in BOTH numerator and denominator", () => {
    // Sub-co with null score (no data this period) shouldn't drag
    // the holding mean down to 0 — it's excluded.
    const composites = new Map<string, CompositeScore>([
      ["co_1", score(80, "green")],
      ["co_2", score(70, "green")],
      ["co_3", unscored()],
    ]);
    const result = computeHoldingComposite(composites, ["co_1", "co_2", "co_3"]);
    expect(result.score).toBe(75); // (80+70)/2; co_3 excluded
    expect(result.contributingCount).toBe(2);
    expect(result.totalCount).toBe(3); // denominator candidate count is unchanged
  });

  it("returns null score when all sub-cos lack data", () => {
    const composites = new Map<string, CompositeScore>([
      ["co_1", unscored()],
      ["co_2", unscored()],
    ]);
    const result = computeHoldingComposite(composites, ["co_1", "co_2"]);
    expect(result.score).toBeNull();
    expect(result.contributingCount).toBe(0);
    expect(result.totalCount).toBe(2);
    expect(result.band).toBeNull();
  });

  it("handles missing map entries (sub-co not yet scored)", () => {
    // Operational id present but no entry in compositeByCompany.
    const composites = new Map<string, CompositeScore>([
      ["co_1", score(70, "green")],
    ]);
    const result = computeHoldingComposite(composites, ["co_1", "co_2", "co_3"]);
    expect(result.score).toBe(70);
    expect(result.contributingCount).toBe(1);
    expect(result.totalCount).toBe(3);
  });

  it("returns null + 0/0 totals when no operational sub-cos in scope", () => {
    const result = computeHoldingComposite(new Map(), []);
    expect(result.score).toBeNull();
    expect(result.contributingCount).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.band).toBeNull();
  });

  it("treats infinite / NaN scores as missing data (defensive)", () => {
    const composites = new Map<string, CompositeScore>([
      ["co_1", score(70, "green")],
      [
        "co_2",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { ...unscored(), score: NaN as any, coverage: "full" as const },
      ],
      [
        "co_3",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { ...unscored(), score: Infinity as any, coverage: "full" as const },
      ],
    ]);
    const result = computeHoldingComposite(composites, ["co_1", "co_2", "co_3"]);
    expect(result.score).toBe(70);
    expect(result.contributingCount).toBe(1);
  });

  describe("band assignment (canonical scoreToBand: ≥67 green / ≥34 amber / else red)", () => {
    it("33 → red", () => {
      const c = new Map<string, CompositeScore>([["co_1", score(33, "red")]]);
      expect(computeHoldingComposite(c, ["co_1"]).band).toBe("red");
    });
    it("34 → amber (boundary)", () => {
      const c = new Map<string, CompositeScore>([["co_1", score(34, "amber")]]);
      expect(computeHoldingComposite(c, ["co_1"]).band).toBe("amber");
    });
    it("66 → amber", () => {
      const c = new Map<string, CompositeScore>([["co_1", score(66, "amber")]]);
      expect(computeHoldingComposite(c, ["co_1"]).band).toBe("amber");
    });
    it("67 → green (boundary)", () => {
      const c = new Map<string, CompositeScore>([["co_1", score(67, "green")]]);
      expect(computeHoldingComposite(c, ["co_1"]).band).toBe("green");
    });
  });

  describe("11.81 — coverage disclosure", () => {
    it("reports the revenue share the mean actually saw", () => {
      const composites = new Map<string, CompositeScore>([
        ["big", score(60, "amber")],
        ["thin", unscored(2, 28)],
      ]);
      const result = computeHoldingComposite(
        composites,
        ["big", "thin"],
        new Map([
          ["big", 900],
          ["thin", 100],
        ]),
      );
      expect(result.score).toBe(60);
      expect(result.contributingCount).toBe(1);
      expect(result.totalCount).toBe(2);
      expect(result.revenueCoveredPct).toBe(90);
    });

    it("is 100 when no revenue basis is supplied — the mean is unweighted anyway", () => {
      const composites = new Map<string, CompositeScore>([["co_1", score(70, "green")]]);
      expect(computeHoldingComposite(composites, ["co_1"]).revenueCoveredPct).toBe(100);
    });

    it("drops a sub-co whose coverage is not full, even if a score somehow leaked in", () => {
      // Belt-and-braces: the invariant says this pair cannot occur, and the
      // filter reads `coverage` so it would still be excluded if it did.
      const composites = new Map<string, CompositeScore>([
        ["ok", score(80, "green")],
        ["leaky", { ...unscored(1, 28), score: 0 }],
      ]);
      const result = computeHoldingComposite(composites, ["ok", "leaky"]);
      expect(result.score).toBe(80);
      expect(result.contributingCount).toBe(1);
    });
  });
});
