import { describe, it, expect } from "vitest"
import {
  readTemplateFromSettings,
  upsertTemplateInSettings,
} from "./template-store"

const base = {
  structureHash: "h1",
  sheetName: "PL",
  mapping: { columns: [{ sourceIndex: 0, role: "code" as const, confidence: 1, reasoning: "" }], accountTypeOverrides: [] },
  approvedBy: "u1",
  sourceFile: "f.xlsx",
}

describe("upsertTemplateInSettings / readTemplateFromSettings", () => {
  it("returns null when no template exists for the hash", () => {
    expect(readTemplateFromSettings({}, "h1")).toBeNull()
    expect(readTemplateFromSettings(null, "h1")).toBeNull()
    expect(readTemplateFromSettings({ importTemplates: {} }, "h1")).toBeNull()
  })

  it("stores a v1 template and reads it back", () => {
    const s = upsertTemplateInSettings({}, base, "2026-06-20T00:00:00Z")
    const t = readTemplateFromSettings(s, "h1")
    expect(t).toMatchObject({ structureHash: "h1", version: 1, approvedBy: "u1", approvedAt: "2026-06-20T00:00:00Z" })
  })

  it("appends a new version (never mutates the prior) and reads the LATEST", () => {
    const s1 = upsertTemplateInSettings({}, base, "2026-06-20T00:00:00Z")
    const s2 = upsertTemplateInSettings(s1, { ...base, approvedBy: "u2", sourceFile: "f2.xlsx" }, "2026-06-21T00:00:00Z")
    const book = (s2 as { importTemplates: Record<string, unknown[]> }).importTemplates
    expect(book.h1).toHaveLength(2) // both versions retained (audit-safe)
    const latest = readTemplateFromSettings(s2, "h1")
    expect(latest).toMatchObject({ version: 2, approvedBy: "u2", sourceFile: "f2.xlsx" })
    // v1 untouched
    expect((book.h1[0] as { version: number; approvedBy: string }).version).toBe(1)
    expect((book.h1[0] as { approvedBy: string }).approvedBy).toBe("u1")
  })

  it("preserves other settings keys when upserting", () => {
    const s = upsertTemplateInSettings({ importConfig: { x: 1 }, lockedPeriods: [] }, base, "t")
    expect((s as { importConfig: { x: number } }).importConfig).toEqual({ x: 1 })
    expect(readTemplateFromSettings(s, "h1")).not.toBeNull()
  })

  it("keeps separate version chains per hash", () => {
    let s = upsertTemplateInSettings({}, base, "t1")
    s = upsertTemplateInSettings(s, { ...base, structureHash: "h2", sheetName: "BS" }, "t2")
    expect(readTemplateFromSettings(s, "h1")?.sheetName).toBe("PL")
    expect(readTemplateFromSettings(s, "h2")?.sheetName).toBe("BS")
  })
})
