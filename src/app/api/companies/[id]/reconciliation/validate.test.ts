/**
 * Phase 7.H Feature 5 — Zod validator unit tests for client-reconciliation
 * endpoints. Locked at compile time, covered at runtime.
 */

import { describe, it, expect } from "vitest"
import {
  CreateReconciliationSchema,
  ListReconciliationQuerySchema,
  DeleteReconciliationQuerySchema,
} from "./validate"

describe("CreateReconciliationSchema", () => {
  it("accepts a minimal valid body and defaults currency to AZN", () => {
    const r = CreateReconciliationSchema.safeParse({
      period: "2026-Q2",
      indicatorKey: "EBITDA",
      value: 1500000,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.currency).toBe("AZN")
  })

  it("accepts negative EBITDA (loss case)", () => {
    const r = CreateReconciliationSchema.safeParse({
      period: "2026",
      indicatorKey: "EBITDA",
      value: -250000,
      currency: "USD",
    })
    expect(r.success).toBe(true)
  })

  it("accepts a YYYY-MM period (monthly)", () => {
    const r = CreateReconciliationSchema.safeParse({
      period: "2026-04",
      indicatorKey: "EBITDA",
      value: 850000,
    })
    expect(r.success).toBe(true)
  })

  it("rejects an invalid month component (YYYY-13)", () => {
    const r = CreateReconciliationSchema.safeParse({
      period: "2026-13",
      indicatorKey: "EBITDA",
      value: 1000,
    })
    expect(r.success).toBe(false)
  })

  it("rejects a non-Q quarter (YYYY-Q5)", () => {
    const r = CreateReconciliationSchema.safeParse({
      period: "2026-Q5",
      indicatorKey: "EBITDA",
      value: 1000,
    })
    expect(r.success).toBe(false)
  })

  it("rejects unknown indicatorKey", () => {
    const r = CreateReconciliationSchema.safeParse({
      period: "2026",
      indicatorKey: "NET_MARGIN",
      value: 1000,
    })
    expect(r.success).toBe(false)
  })

  it("rejects non-finite value (Infinity / NaN)", () => {
    expect(
      CreateReconciliationSchema.safeParse({
        period: "2026",
        indicatorKey: "EBITDA",
        value: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false)
    expect(
      CreateReconciliationSchema.safeParse({
        period: "2026",
        indicatorKey: "EBITDA",
        value: Number.NaN,
      }).success,
    ).toBe(false)
  })

  it("rejects currency that isn't three uppercase letters", () => {
    expect(
      CreateReconciliationSchema.safeParse({
        period: "2026",
        indicatorKey: "EBITDA",
        value: 1000,
        currency: "azn",
      }).success,
    ).toBe(false)
    expect(
      CreateReconciliationSchema.safeParse({
        period: "2026",
        indicatorKey: "EBITDA",
        value: 1000,
        currency: "AZNN",
      }).success,
    ).toBe(false)
  })

  it("rejects note longer than 500 chars", () => {
    const r = CreateReconciliationSchema.safeParse({
      period: "2026",
      indicatorKey: "EBITDA",
      value: 1000,
      note: "x".repeat(501),
    })
    expect(r.success).toBe(false)
  })

  it("accepts note exactly 500 chars", () => {
    const r = CreateReconciliationSchema.safeParse({
      period: "2026",
      indicatorKey: "EBITDA",
      value: 1000,
      note: "x".repeat(500),
    })
    expect(r.success).toBe(true)
  })
})

describe("ListReconciliationQuerySchema", () => {
  it("accepts empty query (returns everything for the company)", () => {
    const r = ListReconciliationQuerySchema.safeParse({})
    expect(r.success).toBe(true)
  })

  it("accepts both filters together", () => {
    const r = ListReconciliationQuerySchema.safeParse({
      period: "2026-Q2",
      indicatorKey: "EBITDA",
    })
    expect(r.success).toBe(true)
  })

  it("rejects invalid period filter", () => {
    const r = ListReconciliationQuerySchema.safeParse({ period: "bad" })
    expect(r.success).toBe(false)
  })
})

describe("DeleteReconciliationQuerySchema", () => {
  it("accepts reconciliationId", () => {
    const r = DeleteReconciliationQuerySchema.safeParse({ reconciliationId: "abc123" })
    expect(r.success).toBe(true)
  })

  it("rejects empty reconciliationId", () => {
    const r = DeleteReconciliationQuerySchema.safeParse({ reconciliationId: "" })
    expect(r.success).toBe(false)
  })

  it("rejects missing reconciliationId", () => {
    const r = DeleteReconciliationQuerySchema.safeParse({})
    expect(r.success).toBe(false)
  })
})
