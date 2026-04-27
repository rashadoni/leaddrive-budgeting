import { describe, it, expect } from "vitest";
import { isDaCode, DA_CODE_PREFIXES } from "./da-codes";

describe("isDaCode (D&A code recognition)", () => {
  it("matches 703-11* (D&A in COGS)", () => {
    expect(isDaCode("703-11")).toBe(true);
    expect(isDaCode("703-11-01")).toBe(true);
    expect(isDaCode("703-11-04")).toBe(true);
  });

  it("matches 721-11* (D&A in OpEx)", () => {
    expect(isDaCode("721-11")).toBe(true);
    expect(isDaCode("721-11-001")).toBe(true);
    expect(isDaCode("721-11-99")).toBe(true);
  });

  it("does NOT match 721-02 (personnel) or 721-03 (utilities)", () => {
    expect(isDaCode("721-02")).toBe(false);
    expect(isDaCode("721-03-01")).toBe(false);
  });

  it("does NOT match below-EBITDA codes (731/761/771)", () => {
    expect(isDaCode("731-01-01")).toBe(false);
    expect(isDaCode("761-01")).toBe(false);
    expect(isDaCode("771-01-02")).toBe(false);
  });

  it("does NOT match 703-01 (COGS without D&A)", () => {
    expect(isDaCode("703-01")).toBe(false);
    expect(isDaCode("703-99")).toBe(false);
  });

  it("exposes the prefix list for diagnostics", () => {
    expect([...DA_CODE_PREFIXES]).toEqual(["703-11", "721-11"]);
  });
});
