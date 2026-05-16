/**
 * Phase 5.2 — ALS-based org-scope context tests.
 *
 * Locks the contract that `runWithOrgScope` correctly propagates
 * `orgId` across async/await boundaries AND fails-loud on misuse
 * (empty / wrong-shape orgId, calling getCurrentOrgId outside scope).
 */
import { describe, it, expect } from "vitest"
import {
  runWithOrgScope,
  getCurrentOrgId,
  requireCurrentOrgId,
} from "./org-scope-context"

const VALID_ORG_ID = "cmockji6c0000u6oseeuz5ipq"

describe("runWithOrgScope", () => {
  it("makes orgId available via getCurrentOrgId() inside the callback", async () => {
    let captured: string | null = null
    await runWithOrgScope(VALID_ORG_ID, async () => {
      captured = getCurrentOrgId()
    })
    expect(captured).toBe(VALID_ORG_ID)
  })

  it("returns the callback result", async () => {
    const result = await runWithOrgScope(VALID_ORG_ID, async () => 42)
    expect(result).toBe(42)
  })

  it("propagates orgId across nested async/await boundaries", async () => {
    const captured: (string | null)[] = []
    await runWithOrgScope(VALID_ORG_ID, async () => {
      captured.push(getCurrentOrgId())
      await new Promise((resolve) => setImmediate(resolve))
      captured.push(getCurrentOrgId())
      await Promise.resolve()
      captured.push(getCurrentOrgId())
    })
    expect(captured).toEqual([VALID_ORG_ID, VALID_ORG_ID, VALID_ORG_ID])
  })

  it("does NOT leak orgId outside the callback", async () => {
    await runWithOrgScope(VALID_ORG_ID, async () => "in")
    expect(getCurrentOrgId()).toBeNull()
  })

  it("nested scopes inherit then restore", async () => {
    const other = "cmother00000000000000000o"
    let outer: string | null = null
    let inner: string | null = null
    let after: string | null = null
    await runWithOrgScope(VALID_ORG_ID, async () => {
      outer = getCurrentOrgId()
      await runWithOrgScope(other, async () => {
        inner = getCurrentOrgId()
      })
      after = getCurrentOrgId()
    })
    expect(outer).toBe(VALID_ORG_ID)
    expect(inner).toBe(other)
    expect(after).toBe(VALID_ORG_ID) // restored on inner exit
  })

  // Validation throws SYNCHRONOUSLY before returning the Promise —
  // assert with `expect(() => ...).toThrow()` not `.rejects.toThrow()`.
  it("rejects empty/whitespace orgId", () => {
    expect(() => runWithOrgScope("", async () => 1)).toThrow(/orgId is required/)
    expect(() => runWithOrgScope("   ", async () => 1)).toThrow(/orgId is required/)
  })

  it("rejects orgId shorter than 20 chars (cuid-shape guard)", () => {
    expect(() => runWithOrgScope("x", async () => 1)).toThrow(/cuid-shaped/)
    expect(() => runWithOrgScope("a".repeat(19), async () => 1)).toThrow(/cuid-shaped/)
  })

  it("rejects orgId longer than 32 chars", () => {
    expect(() => runWithOrgScope("a".repeat(33), async () => 1)).toThrow(/cuid-shaped/)
  })

  it("rejects orgId with non-alphanumeric chars (SQL injection guard)", () => {
    expect(() => runWithOrgScope("cmp123' OR '1'='1789abc", async () => 1)).toThrow(
      /cuid-shaped/,
    )
    expect(() => runWithOrgScope("cmp-12345678901234567890", async () => 1)).toThrow(
      /cuid-shaped/,
    )
  })
})

describe("requireCurrentOrgId", () => {
  it("returns orgId when inside a scope", async () => {
    await runWithOrgScope(VALID_ORG_ID, async () => {
      expect(requireCurrentOrgId()).toBe(VALID_ORG_ID)
    })
  })

  it("throws helpful error when called outside any scope", () => {
    expect(() => requireCurrentOrgId()).toThrow(
      /no orgId in scope.*Wrap your handler/,
    )
  })
})
