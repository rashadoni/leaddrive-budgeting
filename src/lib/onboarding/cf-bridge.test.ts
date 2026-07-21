import { describe, expect, it } from "vitest"
import {
  classifyCashFlowCode,
  isCashFlowBridgeActivity,
  isCashFlowMovementActivity,
  selectLeafMostCashFlowBridgeCodes,
} from "./cf-bridge"

describe("cash-flow bridge classification", () => {
  it.each([
    ["CF.01.01.01", "operating", null],
    ["CF.02.02.01", "investing", null],
    ["CF.03.01.01", "financing", null],
    ["CF.04", "bridge", "fx_effect_on_cash"],
    ["CF.05.01.01", "bridge", "net_change_in_cash"],
    ["CF.06", "bridge", "opening_cash"],
    ["CF.07.99", "bridge", "closing_cash"],
  ])("classifies %s", (code, activityType, bridgeKind) => {
    expect(classifyCashFlowCode(code)).toEqual({ activityType, bridgeKind })
  })

  it("rejects non-CF and unknown CF sections", () => {
    expect(classifyCashFlowCode("PLF.01.01.01")).toBeNull()
    expect(classifyCashFlowCode("CF.08")).toBeNull()
  })

  it("keeps movement and bridge predicates disjoint", () => {
    expect(isCashFlowBridgeActivity("bridge")).toBe(true)
    expect(isCashFlowMovementActivity("bridge")).toBe(false)
    expect(isCashFlowMovementActivity("operating")).toBe(true)
    expect(isCashFlowBridgeActivity("operating")).toBe(false)
  })

  it("keeps leaf-most bridge siblings while dropping their ancestors", () => {
    expect(
      [...selectLeafMostCashFlowBridgeCodes([
        "CF.04",
        "CF.04.01",
        "CF.04.01.01",
        "CF.04.02.01",
        "CF.05",
        "CF.01.01.01",
      ])].sort(),
    ).toEqual(["CF.04.01.01", "CF.04.02.01", "CF.05"])
  })
})
