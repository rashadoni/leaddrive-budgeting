import { describe, it, expect } from "vitest";
import {
  parseAssumptionInput,
  parseAssumptionPatch,
  referencedCompanyIds,
} from "./assumption-input";

const BASE = { category: "fx", key: "import_share", label: "Imported input share", value: 0.7 };

describe("parseAssumptionInput — allow-list", () => {
  it("drops every field a client must not write", () => {
    const got = parseAssumptionInput({
      ...BASE,
      id: "attacker-chosen",
      organizationId: "org_other",
      planId: "p_other",
      createdAt: "1999-01-01T00:00:00Z",
      updatedAt: "1999-01-01T00:00:00Z",
      deletedAt: "1999-01-01T00:00:00Z",
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(Object.keys(got.value).sort()).toEqual([
      "category", "companyId", "key", "label", "notes", "period", "sortOrder", "unit", "value",
    ]);
  });

  it("rejects a non-object body", () => {
    expect(parseAssumptionInput(null).ok).toBe(false);
    expect(parseAssumptionInput("x").ok).toBe(false);
    expect(parseAssumptionInput([BASE]).ok).toBe(false);
  });

  it("requires a key", () => {
    expect(parseAssumptionInput({ ...BASE, key: "   " }).ok).toBe(false);
    expect(parseAssumptionInput({ ...BASE, key: undefined }).ok).toBe(false);
  });

  it("falls back to key for a missing label, and 'other' for a missing category", () => {
    const got = parseAssumptionInput({ key: "fx_usd", value: 1.7 });
    expect(got.ok && got.value.label).toBe("fx_usd");
    expect(got.ok && got.value.category).toBe("other");
  });

  it("accepts a numeric string — forms submit strings", () => {
    const got = parseAssumptionInput({ ...BASE, value: "0.7" });
    expect(got.ok && got.value.value).toBe(0.7);
  });

  it("refuses NaN and Infinity rather than storing an unreadable driver", () => {
    expect(parseAssumptionInput({ ...BASE, value: "0.o7" }).ok).toBe(false);
    expect(parseAssumptionInput({ ...BASE, value: Number.NaN }).ok).toBe(false);
    expect(parseAssumptionInput({ ...BASE, value: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it("does NOT default a missing value to zero", () => {
    // Defaulting here would turn a typo into a silent 0 — the exact class of
    // error the tab exists to surface.
    expect(parseAssumptionInput({ category: "fx", key: "import_share" }).ok).toBe(false);
  });

  it("keeps an explicit zero", () => {
    const got = parseAssumptionInput({ ...BASE, value: 0 });
    expect(got.ok && got.value.value).toBe(0);
  });

  it("accepts a negative value", () => {
    const got = parseAssumptionInput({ ...BASE, value: -0.15 });
    expect(got.ok && got.value.value).toBe(-0.15);
  });

  it("normalizes blank optional text to null", () => {
    const got = parseAssumptionInput({ ...BASE, unit: "  ", notes: "", companyId: "   " });
    expect(got.ok && got.value.unit).toBeNull();
    expect(got.ok && got.value.notes).toBeNull();
    expect(got.ok && got.value.companyId).toBeNull();
  });

  it("trims surrounding whitespace on text fields", () => {
    const got = parseAssumptionInput({ ...BASE, key: "  fx_usd  ", unit: " AZN " });
    expect(got.ok && got.value.key).toBe("fx_usd");
    expect(got.ok && got.value.unit).toBe("AZN");
  });

  it("constrains period to the closed set", () => {
    expect(parseAssumptionInput({ ...BASE, period: "annual" }).ok).toBe(true);
    expect(parseAssumptionInput({ ...BASE, period: "fortnightly" }).ok).toBe(false);
    expect(parseAssumptionInput({ ...BASE, period: null }).ok).toBe(true);
  });

  it("truncates a fractional sortOrder instead of rejecting it", () => {
    const got = parseAssumptionInput({ ...BASE, sortOrder: 3.9 });
    expect(got.ok && got.value.sortOrder).toBe(3);
  });

  it("defaults sortOrder to 0 when absent or null", () => {
    const absent = parseAssumptionInput(BASE);
    expect(absent.ok && absent.value.sortOrder).toBe(0);
    const explicitNull = parseAssumptionInput({ ...BASE, sortOrder: null });
    expect(explicitNull.ok && explicitNull.value.sortOrder).toBe(0);
  });

  it("enforces length caps", () => {
    expect(parseAssumptionInput({ ...BASE, key: "k".repeat(201) }).ok).toBe(false);
    expect(parseAssumptionInput({ ...BASE, notes: "n".repeat(2001) }).ok).toBe(false);
    expect(parseAssumptionInput({ ...BASE, notes: "n".repeat(2000) }).ok).toBe(true);
  });
});

describe("parseAssumptionPatch — partial semantics", () => {
  it("absent means leave alone", () => {
    const got = parseAssumptionPatch({ value: 0.8 });
    expect(got.ok && Object.keys(got.value)).toEqual(["value"]);
  });

  it("companyId:null is an expressible edit, not an omission", () => {
    // This is how the UI demotes a company override back to a plan default.
    const got = parseAssumptionPatch({ companyId: null });
    expect(got.ok).toBe(true);
    expect(got.ok && "companyId" in got.value).toBe(true);
    expect(got.ok && got.value.companyId).toBeNull();
  });

  it("rejects an empty patch", () => {
    expect(parseAssumptionPatch({}).ok).toBe(false);
    expect(parseAssumptionPatch({ id: "x", organizationId: "y" }).ok).toBe(false);
  });

  it("rejects clearing a required text field", () => {
    expect(parseAssumptionPatch({ key: "" }).ok).toBe(false);
    expect(parseAssumptionPatch({ label: "  " }).ok).toBe(false);
    expect(parseAssumptionPatch({ category: "" }).ok).toBe(false);
  });

  it("applies the same value and period rules as create", () => {
    expect(parseAssumptionPatch({ value: "abc" }).ok).toBe(false);
    expect(parseAssumptionPatch({ value: 0 }).ok).toBe(true);
    expect(parseAssumptionPatch({ period: "weekly" }).ok).toBe(false);
    expect(parseAssumptionPatch({ period: "per_unit" }).ok).toBe(true);
  });

  it("clears an optional field with null", () => {
    const got = parseAssumptionPatch({ unit: null, notes: null });
    expect(got.ok && got.value.unit).toBeNull();
    expect(got.ok && got.value.notes).toBeNull();
  });
});

describe("referencedCompanyIds", () => {
  it("dedupes and skips plan-level rows", () => {
    expect(
      referencedCompanyIds([
        { companyId: "a" },
        { companyId: null },
        { companyId: "a" },
        { companyId: "b" },
      ]).sort(),
    ).toEqual(["a", "b"]);
  });

  it("returns empty when every row is plan-level — the caller then skips the query", () => {
    expect(referencedCompanyIds([{ companyId: null }, { companyId: null }])).toEqual([]);
  });
});
