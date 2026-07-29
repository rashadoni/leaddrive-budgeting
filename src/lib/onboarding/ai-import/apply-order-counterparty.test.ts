/**
 * Phase 11.22 — the counterparty write order is a CORRECTNESS contract.
 *
 * Two handlers write `Counterparty(org, company, role, period)` with a
 * delete-then-insert, and the orchestrator runs a group's handlers
 * sequentially inside ONE transaction — so whichever runs last wins outright:
 *
 *   - `compliance-register` → the dedicated "Top 10 customers" REGISTER,
 *     the authoritative source;
 *   - `sales-products` → a customer split DERIVED from a product-sales sheet.
 *
 * `sales-products` used to be 2.8, i.e. it ran LAST and silently destroyed the
 * register's rows: the less authoritative source overwriting the authoritative
 * one, with no warning on either path.
 *
 * Derived must never outrank source. This test exists so a future renumber
 * cannot quietly re-break it.
 */
import { describe, it, expect } from "vitest"
import { APPLY_ORDER_FOR_TEST } from "./multi-file-orchestrator"

describe("APPLY_ORDER — counterparty writers", () => {
  it("runs the derived product-sales split BEFORE the authoritative register", () => {
    expect(APPLY_ORDER_FOR_TEST["sales-products"]).toBeLessThan(
      APPLY_ORDER_FOR_TEST["compliance-register"],
    )
  })

  it("still applies both after main-financial, which seeds companies and the CoA", () => {
    expect(APPLY_ORDER_FOR_TEST["sales-products"]).toBeGreaterThan(
      APPLY_ORDER_FOR_TEST["main-financial"],
    )
    expect(APPLY_ORDER_FOR_TEST["compliance-register"]).toBeGreaterThan(
      APPLY_ORDER_FOR_TEST["main-financial"],
    )
  })

  it("keeps company-setup first — everything else resolves companies by code", () => {
    const others = Object.entries(APPLY_ORDER_FOR_TEST)
      .filter(([k]) => k !== "company-setup" && k !== "unknown")
      .map(([, v]) => v)
    expect(Math.min(...others)).toBeGreaterThan(
      APPLY_ORDER_FOR_TEST["company-setup"],
    )
  })
})
