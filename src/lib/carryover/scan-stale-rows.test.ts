/**
 * Tests for the CARRYOVER stale-row scanner (Phase 8 F3).
 *
 * Pure module — no DB, no fs, deterministic clock via opts.now.
 */
import { describe, it, expect } from "vitest"
import {
  scanCarryover,
  extractOpenSection,
  formatReport,
} from "./scan-stale-rows"

const NOW = new Date("2026-05-28T12:00:00Z")

function buildBody(rows: string[]): string {
  return `# CARRYOVER

Some preamble.

## OPEN

| marker | date | turns-open | owner | description |
|---|---|---|---|---|
${rows.join("\n")}

## CLOSED

| ✅ | 2026-01-01 | 0 | engineering | Old closed item — should be ignored even though it sits below. |
`
}

describe("extractOpenSection", () => {
  it("returns text between ## OPEN and ## CLOSED", () => {
    const body = buildBody([
      "| 🔄 | 2026-05-01 | 0 | user | Recent row |",
    ])
    const section = extractOpenSection(body)
    expect(section).toContain("Recent row")
    expect(section).not.toContain("Old closed item")
  })

  it("returns empty string when ## OPEN is missing", () => {
    expect(extractOpenSection("# CARRYOVER\n\nNo open section.")).toBe("")
  })
})

describe("scanCarryover", () => {
  it("returns no stale rows when every OPEN row is fresh", () => {
    const body = buildBody([
      "| 🔄 | 2026-05-20 | 0 | user | 8d old — within 30d SLA |",
      "| 🔄 | 2026-05-26 | 0 | engineering | 2d old |",
    ])
    const result = scanCarryover(body, { now: NOW })
    expect(result.openRows).toHaveLength(2)
    expect(result.staleRows).toHaveLength(0)
    expect(result.userBlockedStale).toHaveLength(0)
  })

  it("flags rows past the default 30d cutoff as stale", () => {
    const body = buildBody([
      "| 🔄 | 2026-04-01 | 0 | user | 57d old (past 30d) |",
      "| 🔄 | 2026-05-20 | 0 | engineering | 8d old (fresh) |",
    ])
    const result = scanCarryover(body, { now: NOW })
    expect(result.openRows).toHaveLength(2)
    expect(result.staleRows).toHaveLength(1)
    expect(result.staleRows[0].ageDays).toBeGreaterThanOrEqual(57)
    expect(result.userBlockedStale).toHaveLength(1)
  })

  it("honours a custom cutoffDays override", () => {
    const body = buildBody([
      "| 🔄 | 2026-05-21 | 0 | engineering | 7d old |",
    ])
    const result = scanCarryover(body, { now: NOW, cutoffDays: 5 })
    expect(result.staleRows).toHaveLength(1)
  })

  it("treats malformed dates as ageDays:null (not stale)", () => {
    const body = buildBody([
      "| 🔄 | not-a-date | 0 | user | Bad date row |",
    ])
    const result = scanCarryover(body, { now: NOW })
    expect(result.openRows).toHaveLength(1)
    expect(result.openRows[0].ageDays).toBeNull()
    expect(result.staleRows).toHaveLength(0)
  })

  it("ignores ✅ CLOSED / 📝 NOTE rows in the OPEN section", () => {
    const body = buildBody([
      "| 🔄 | 2026-01-01 | 0 | user | Real stale row |",
      "| ✅ | 2026-01-01 | 0 | engineering | Awaiting move to CLOSED |",
      "| 📝 | 2026-01-01 | 0 | engineering | Note entry |",
    ])
    const result = scanCarryover(body, { now: NOW })
    expect(result.openRows).toHaveLength(1)
    expect(result.openRows[0].marker).toBe("🔄")
  })

  it("partitions stale rows by owner=user vs other", () => {
    const body = buildBody([
      "| 🔄 | 2026-03-01 | 0 | user | A |",
      "| 🔄 | 2026-03-01 | 0 | engineering | B |",
      "| 🔄 | 2026-03-01 | 0 | ops | C |",
    ])
    const result = scanCarryover(body, { now: NOW })
    expect(result.staleRows).toHaveLength(3)
    expect(result.userBlockedStale).toHaveLength(1)
    expect(result.userBlockedStale[0].description).toBe("A")
  })

  it("handles description fields containing pipe characters", () => {
    const body = buildBody([
      "| 🔄 | 2026-03-01 | 0 | engineering | Some `a | b | c` code |",
    ])
    const result = scanCarryover(body, { now: NOW })
    expect(result.openRows).toHaveLength(1)
    expect(result.openRows[0].description).toContain("`a | b | c`")
  })
})

describe("formatReport", () => {
  it("emits a clean «no escalation needed» line when zero stale rows", () => {
    const body = buildBody([
      "| 🔄 | 2026-05-20 | 0 | user | Fresh row |",
    ])
    const report = formatReport(scanCarryover(body, { now: NOW }))
    expect(report).toContain("No rows past")
  })

  it("emits a tagged escalation summary for stale + user-blocked rows", () => {
    const body = buildBody([
      "| 🔄 | 2026-03-01 | 0 | user | Client awaits file X |",
      "| 🔄 | 2026-03-01 | 0 | engineering | Internal refactor |",
    ])
    const report = formatReport(scanCarryover(body, { now: NOW }))
    expect(report).toMatch(/2 row\(s\) past cutoff/)
    expect(report).toMatch(/1 owner=user/)
    expect(report).toContain("🚨 user")
    expect(report).toContain("Client awaits file X")
  })
})
