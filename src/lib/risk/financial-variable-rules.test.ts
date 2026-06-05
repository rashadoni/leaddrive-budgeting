import { describe, it, expect } from "vitest"
import {
  FINANCIAL_VARIABLE_RULES,
  FINANCIAL_VARIABLE_KEYS,
  getFinancialVariableRule,
  resolveFinancialVariableByInput,
  validateFinancialValue,
} from "./financial-variable-rules"

describe("financial-variable registry", () => {
  it("exposes inventory and its key", () => {
    expect(FINANCIAL_VARIABLE_KEYS).toContain("inventory")
    expect(getFinancialVariableRule("inventory")?.variable).toBe("inventory")
    expect(getFinancialVariableRule("nope")).toBeUndefined()
  })

  it("resolves the bare formula variable AND the qualified input key", () => {
    // The bare "inventory" is what the health scan emits at runtime
    // (extractMissingVariable on "undefined variable: inventory") — the form
    // attaches on this. The qualified key is accepted too for robustness.
    expect(resolveFinancialVariableByInput("inventory")?.variable).toBe("inventory")
    expect(resolveFinancialVariableByInput("balanceSheetLine.inventory")?.variable).toBe(
      "inventory",
    )
    // unrelated / null → no match
    expect(resolveFinancialVariableByInput("budgetLine.cogs")).toBeUndefined()
    expect(resolveFinancialVariableByInput(null)).toBeUndefined()
  })

  it("formulaVariable + requiredInputKey stay in sync with the seed", () => {
    // FP_INVENTORY_TURNS: formula "cogs / inventory" (bare var → formulaVariable),
    // requiredInputs ["budgetLine.cogs", "balanceSheetLine.inventory"]
    // (resolver contract → requiredInputKey). If either drifts, the inline form
    // silently stops matching the gap.
    const rule = getFinancialVariableRule("inventory")!
    expect(rule.formulaVariable).toBe("inventory")
    expect(rule.requiredInputKey).toBe("balanceSheetLine.inventory")
  })
})

describe("inventory rule honours the recompute resolver contract", () => {
  // balanceSheetLineResolver filters: lineType==='asset' && subType==='current'
  // && bsIsInventoryLine(accountName) && amount > 0, read from a kind='actual'
  // plan at month=12. A drift here = a write the resolver silently ignores.
  const rule = getFinancialVariableRule("inventory")!

  it("targets a current asset on the balance sheet", () => {
    expect(rule.model).toBe("balanceSheetLine")
    expect(rule.lineType).toBe("asset")
    expect(rule.subType).toBe("current")
  })

  it("uses an account name the inventory matcher will accept", () => {
    // bsIsInventoryLine lower-cases and checks .includes('inventory') (among
    // other locale synonyms). "Inventory" ⊃ "inventory".
    expect(rule.accountName.toLowerCase()).toContain("inventory")
  })

  it("requires a positive balance (formula divides by inventory)", () => {
    expect(rule.requiresPositive).toBe(true)
  })
})

describe("validateFinancialValue", () => {
  const rule = getFinancialVariableRule("inventory")!

  it("accepts a normal positive balance with no warnings", () => {
    const r = validateFinancialValue(rule, 1_500_000)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it("rejects a negative balance (below hard min 0)", () => {
    const r = validateFinancialValue(rule, -1)
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it("rejects above the hard max", () => {
    const r = validateFinancialValue(rule, rule.max + 1)
    expect(r.ok).toBe(false)
  })

  it("rejects NaN / Infinity", () => {
    expect(validateFinancialValue(rule, NaN).ok).toBe(false)
    expect(validateFinancialValue(rule, Infinity).ok).toBe(false)
  })

  it("warns (but accepts) on a 0 value — will not unlock the indicator", () => {
    const r = validateFinancialValue(rule, 0)
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w) => /0|unlock|positive/i.test(w))).toBe(true)
  })

  it("warns (but accepts) above the soft warn ceiling", () => {
    const r = validateFinancialValue(rule, (rule.warnMax ?? 0) + 1)
    expect(r.ok).toBe(true)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})
