import { describe, expect, it } from "vitest"
import {
  WORKBOOK_CONTENT_HASH_KEY,
  computeWorkbookContentHash,
  getStagedWorkbookContentHash,
  verifyStagedWorkbookContent,
} from "./workbook-content-hash"

const bytes = (value: string) => new TextEncoder().encode(value)

describe("staged workbook content hash", () => {
  it("is deterministic and changes when workbook bytes change", () => {
    const first = computeWorkbookContentHash(bytes("workbook-v1"))
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(computeWorkbookContentHash(bytes("workbook-v1"))).toBe(first)
    expect(computeWorkbookContentHash(bytes("workbook-v2"))).not.toBe(first)
  })

  it("accepts only a well-formed server-staged sha256", () => {
    const digest = computeWorkbookContentHash(bytes("workbook-v1"))
    expect(getStagedWorkbookContentHash({ [WORKBOOK_CONTENT_HASH_KEY]: digest })).toBe(digest)
    expect(getStagedWorkbookContentHash({ [WORKBOOK_CONTENT_HASH_KEY]: "not-a-sha" })).toBeNull()
    expect(getStagedWorkbookContentHash({})).toBeNull()
  })

  it("distinguishes matching, changed, and unverifiable replacement uploads", () => {
    const reviewed = bytes("reviewed-workbook")
    const proposal = {
      [WORKBOOK_CONTENT_HASH_KEY]: computeWorkbookContentHash(reviewed),
    }

    expect(verifyStagedWorkbookContent(proposal, reviewed)).toBe("match")
    expect(verifyStagedWorkbookContent(proposal, bytes("changed-workbook"))).toBe("mismatch")
    expect(verifyStagedWorkbookContent({}, reviewed)).toBe("missing")
  })
})
