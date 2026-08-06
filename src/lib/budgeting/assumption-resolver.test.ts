import { describe, it, expect } from "vitest";
import {
  resolveAssumption,
  resolveAssumptions,
  assumptionValue,
  ambiguousKeys,
  type AssumptionRowLike,
} from "./assumption-resolver";

/** Terse row builder — only the fields a given case actually exercises. */
function row(over: Partial<AssumptionRowLike> & { id: string; key: string; value: number }): AssumptionRowLike {
  return { companyId: null, sortOrder: 0, unit: null, createdAt: new Date("2026-01-01T00:00:00Z"), ...over };
}

const SUGAR = "cmp_sugar";
const LOGISTICS = "cmp_logistics";

describe("resolveAssumption — two-tier precedence", () => {
  it("company override wins over the plan default for the same key", () => {
    const rows = [
      row({ id: "a", key: "import_share", value: 0.3 }),
      row({ id: "b", key: "import_share", value: 0.7, companyId: SUGAR }),
    ];
    const got = resolveAssumption(rows, "import_share", SUGAR);
    expect(got?.value).toBe(0.7);
    expect(got?.tier).toBe("company");
    expect(got?.source.id).toBe("b");
  });

  it("a company with no override falls back to the plan default", () => {
    const rows = [
      row({ id: "a", key: "import_share", value: 0.3 }),
      row({ id: "b", key: "import_share", value: 0.7, companyId: SUGAR }),
    ];
    const got = resolveAssumption(rows, "import_share", LOGISTICS);
    expect(got?.value).toBe(0.3);
    expect(got?.tier).toBe("plan");
  });

  it("another company's override never leaks into this company's resolution", () => {
    // The whole point of the tier: a sugar-specific import share must not
    // become the logistics arm's, which is the failure the hardcoded 0.3 was.
    const rows = [row({ id: "b", key: "import_share", value: 0.7, companyId: SUGAR })];
    expect(resolveAssumption(rows, "import_share", LOGISTICS)).toBeNull();
  });

  it("companyId=null asks for the default explicitly and ignores every override", () => {
    const rows = [
      row({ id: "a", key: "inflation", value: 0.06 }),
      row({ id: "b", key: "inflation", value: 0.19, companyId: SUGAR }),
    ];
    const got = resolveAssumption(rows, "inflation", null);
    expect(got?.value).toBe(0.06);
    expect(got?.tier).toBe("plan");
  });

  it("companyId=null with ONLY overrides present resolves to null, not to an arbitrary company", () => {
    const rows = [row({ id: "b", key: "inflation", value: 0.19, companyId: SUGAR })];
    expect(resolveAssumption(rows, "inflation", null)).toBeNull();
  });

  it("missing key returns null — never a substituted constant", () => {
    const rows = [row({ id: "a", key: "inflation", value: 0.06 })];
    expect(resolveAssumption(rows, "import_share", SUGAR)).toBeNull();
    expect(assumptionValue(rows, "import_share", SUGAR)).toBeNull();
  });

  it("carries the unit through from the winning row, not the shadowed one", () => {
    const rows = [
      row({ id: "a", key: "fx_usd", value: 1.7, unit: "AZN" }),
      row({ id: "b", key: "fx_usd", value: 170, unit: "qəpik", companyId: SUGAR }),
    ];
    expect(resolveAssumption(rows, "fx_usd", SUGAR)?.unit).toBe("qəpik");
  });

  it("a zero value resolves as a value, not as absent", () => {
    // 0% imported share is a real, meaningful statement about a domestic
    // business — it must not read as "unstated" and fall through to a default.
    const rows = [row({ id: "a", key: "import_share", value: 0 })];
    expect(assumptionValue(rows, "import_share", LOGISTICS)).toBe(0);
  });
});

describe("resolveAssumption — duplicates are total and deterministic", () => {
  it("lowest sortOrder wins among duplicate rows at the same tier", () => {
    const rows = [
      row({ id: "a", key: "inflation", value: 0.06, sortOrder: 5 }),
      row({ id: "b", key: "inflation", value: 0.09, sortOrder: 1 }),
    ];
    const got = resolveAssumption(rows, "inflation", null);
    expect(got?.value).toBe(0.09);
    expect(got?.ambiguous).toBe(true);
  });

  it("equal sortOrder falls to the oldest createdAt", () => {
    const rows = [
      row({ id: "a", key: "inflation", value: 0.06, createdAt: new Date("2026-03-01T00:00:00Z") }),
      row({ id: "b", key: "inflation", value: 0.09, createdAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    expect(resolveAssumption(rows, "inflation", null)?.value).toBe(0.09);
  });

  it("a row with no createdAt sorts after one that has it", () => {
    const rows = [
      row({ id: "a", key: "inflation", value: 0.06, createdAt: null }),
      row({ id: "b", key: "inflation", value: 0.09 }),
    ];
    expect(resolveAssumption(rows, "inflation", null)?.value).toBe(0.09);
  });

  it("an unparseable createdAt does not make the comparator return NaN", () => {
    // A NaN comparator makes Array.sort implementation-defined — the same
    // scenario would then produce different board figures on different runs.
    const rows = [
      row({ id: "b", key: "inflation", value: 0.09, createdAt: "not-a-date" }),
      row({ id: "a", key: "inflation", value: 0.06, createdAt: "also-not-a-date" }),
    ];
    const first = resolveAssumption(rows, "inflation", null)?.source.id;
    const second = resolveAssumption([...rows].reverse(), "inflation", null)?.source.id;
    expect(first).toBe(second);
    expect(first).toBe("a"); // id is the final tie-break
  });

  it("input order does not change the winner", () => {
    const rows = [
      row({ id: "z", key: "inflation", value: 0.06, sortOrder: 2 }),
      row({ id: "a", key: "inflation", value: 0.09, sortOrder: 2 }),
    ];
    expect(resolveAssumption(rows, "inflation", null)?.source.id).toBe("a");
    expect(resolveAssumption([...rows].reverse(), "inflation", null)?.source.id).toBe("a");
  });

  it("does not mutate the caller's array", () => {
    const rows = [
      row({ id: "z", key: "inflation", value: 0.06, sortOrder: 9 }),
      row({ id: "a", key: "inflation", value: 0.09, sortOrder: 1 }),
    ];
    const before = rows.map((r) => r.id);
    resolveAssumption(rows, "inflation", null);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("an override shadowing a default is layering, NOT ambiguity", () => {
    const rows = [
      row({ id: "a", key: "import_share", value: 0.3 }),
      row({ id: "b", key: "import_share", value: 0.7, companyId: SUGAR }),
    ];
    expect(resolveAssumption(rows, "import_share", SUGAR)?.ambiguous).toBe(false);
  });

  it("two overrides for the SAME company are ambiguous", () => {
    const rows = [
      row({ id: "a", key: "import_share", value: 0.7, companyId: SUGAR, sortOrder: 1 }),
      row({ id: "b", key: "import_share", value: 0.5, companyId: SUGAR, sortOrder: 2 }),
    ];
    expect(resolveAssumption(rows, "import_share", SUGAR)?.ambiguous).toBe(true);
  });
});

describe("resolveAssumptions / ambiguousKeys", () => {
  it("resolves every key at once with per-key tiering", () => {
    const rows = [
      row({ id: "a", key: "inflation", value: 0.06 }),
      row({ id: "b", key: "import_share", value: 0.3 }),
      row({ id: "c", key: "import_share", value: 0.7, companyId: SUGAR }),
    ];
    const got = resolveAssumptions(rows, SUGAR);
    expect(got.get("inflation")?.value).toBe(0.06);
    expect(got.get("inflation")?.tier).toBe("plan");
    expect(got.get("import_share")?.value).toBe(0.7);
    expect(got.get("import_share")?.tier).toBe("company");
  });

  it("omits a key that has only another company's override", () => {
    const rows = [row({ id: "c", key: "import_share", value: 0.7, companyId: SUGAR })];
    expect(resolveAssumptions(rows, LOGISTICS).has("import_share")).toBe(false);
  });

  it("agrees with resolveAssumption key by key", () => {
    const rows = [
      row({ id: "a", key: "inflation", value: 0.06 }),
      row({ id: "b", key: "import_share", value: 0.3 }),
      row({ id: "c", key: "import_share", value: 0.7, companyId: SUGAR }),
      row({ id: "d", key: "fx_usd", value: 1.7, sortOrder: 3 }),
    ];
    for (const key of ["inflation", "import_share", "fx_usd", "absent"]) {
      expect(resolveAssumptions(rows, SUGAR).get(key) ?? null).toEqual(
        resolveAssumption(rows, key, SUGAR),
      );
    }
  });

  it("empty input yields an empty map and no keys", () => {
    expect(resolveAssumptions([], SUGAR).size).toBe(0);
    expect(ambiguousKeys([], SUGAR)).toEqual([]);
  });

  it("ambiguousKeys lists only genuinely colliding keys, sorted", () => {
    const rows = [
      row({ id: "a", key: "inflation", value: 0.06 }),
      row({ id: "b", key: "inflation", value: 0.09 }),
      row({ id: "c", key: "fx_usd", value: 1.7 }),
      row({ id: "d", key: "fx_usd", value: 1.8 }),
      row({ id: "e", key: "tax_rate", value: 0.2 }),
    ];
    expect(ambiguousKeys(rows, null)).toEqual(["fx_usd", "inflation"]);
  });
});
