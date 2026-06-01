/**
 * Phase 8 (2026-05-29) — Panel 3 resolved-variable unit formatting.
 *
 * Regression lock for the live-found bug: Panel 3 showed "LEGAL_CASES_ACTIVE
 * = 29 ₼" and "AUDIT_CLOSED_PCT = 51 ₼" — manat for a case-count and a
 * percentage. Root cause: `hintForKey` regexes were case-sensitive-lowercase,
 * so UPPERCASE indicator codes matched nothing and defaulted to "money" (₼);
 * and the resolved-vars block never used the indicator's real `unit`.
 */
import { describe, it, expect } from "vitest";
import { hintForKey, unitToHint, formatAggValue } from "./AggregateBlock";

describe("hintForKey — resolved-variable name heuristic", () => {
  it("is case-insensitive (UPPERCASE indicator codes resolve)", () => {
    expect(hintForKey("AUDIT_CLOSED_PCT")).toBe("percent");
    expect(hintForKey("audit_closed_pct")).toBe("percent");
  });
  it("classifies common raw-input keys", () => {
    expect(hintForKey("line_count")).toBe("count");
    expect(hintForKey("revenue")).toBe("money");
    expect(hintForKey("fx_usd_azn")).toBe("ratio");
    expect(hintForKey("customer_share")).toBe("ratio");
  });
});

describe("unitToHint — maps stored IndicatorDefinition.unit → format hint", () => {
  it("maps real units and never invents currency for non-money units", () => {
    expect(unitToHint("%")).toBe("percent"); // AUDIT_CLOSED_PCT, TOP_CUSTOMER_SHARE
    expect(unitToHint("cases")).toBe("count"); // LEGAL_CASES_ACTIVE
    expect(unitToHint("count")).toBe("count"); // AUDIT_MAJOR_OPEN
    expect(unitToHint("index")).toBe("ratio"); // CUSTOMER_HHI — NOT money
    expect(unitToHint("AZN")).toBe("money");
    expect(unitToHint("₼")).toBe("money");
    expect(unitToHint(null)).toBe("ratio");
    expect(unitToHint("")).toBe("ratio");
  });
});

describe("formatAggValue — non-money units carry no ₼ (the Panel 3 bug)", () => {
  it("count / percent / ratio never emit the manat symbol", () => {
    expect(formatAggValue(29, "count")).toBe("29");
    const pct = formatAggValue(51, "percent");
    expect(pct).toContain("%");
    expect(pct).not.toContain("₼");
    expect(formatAggValue(0.42, "ratio")).not.toContain("₼");
    // money still renders ₼.
    expect(formatAggValue(1000, "money")).toContain("₼");
  });

  it("rounds large 'ratio' magnitudes (coerced money inputs) — no kopeck tail", () => {
    // A %-margin indicator coerces its money inputs (cogs/revenue/…) to "ratio";
    // those used to show "438874.36". Now they round + group, with no ₼.
    const cogs = formatAggValue(438874.36, "ratio");
    expect(cogs).not.toMatch(/\.\d/); // no decimal tail
    expect(cogs.replace(/\D/g, "")).toBe("438874"); // rounded digits
    expect(formatAggValue(-21493.93, "ratio").replace(/[^\d]/g, "")).toBe("21494"); // rounds
    expect(formatAggValue(0, "ratio")).toBe("0"); // not "0.00"
    // true small ratios keep two decimals.
    expect(formatAggValue(0.42, "ratio")).toBe("0.42");
  });
});
