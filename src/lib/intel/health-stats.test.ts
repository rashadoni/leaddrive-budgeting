// @vitest-environment node
/**
 * Phase 7.G Turn LXXXXIII (Phase 7.E #1 D.5d) — intel-health stats tests.
 */

import { describe, it, expect } from "vitest"
import { computeIntelHealthStats, type IntelHealthRowInput } from "./health-stats"

const NOW = new Date("2026-05-10T20:00:00.000Z")
const NOW_MS = NOW.getTime()

const minutesAgo = (m: number) => new Date(NOW_MS - m * 60 * 1000)
const hoursAgo = (h: number) => new Date(NOW_MS - h * 60 * 60 * 1000)
const daysAgo = (d: number) => new Date(NOW_MS - d * 24 * 60 * 60 * 1000)

const row = (overrides: Partial<IntelHealthRowInput> = {}): IntelHealthRowInput => ({
  fetchedAt: NOW,
  sourceLabel: "Reuters",
  industryTags: ["industrial"],
  relevanceScore: 0.75,
  ...overrides,
})

describe("computeIntelHealthStats — totals + meta", () => {
  it("zero rows: totalItems=0, latestFetchedAt=null, NaN relevance, empty top lists", () => {
    const stats = computeIntelHealthStats(
      [],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    expect(stats.totalItems).toBe(0)
    expect(stats.latestFetchedAt).toBeNull()
    expect(stats.averageRelevance).toBeNaN()
    expect(stats.topSources).toEqual([])
    expect(stats.topIndustries).toEqual([])
  })

  it("totalItems = rows.length", () => {
    const stats = computeIntelHealthStats(
      [row(), row(), row()],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    expect(stats.totalItems).toBe(3)
  })

  it("latestFetchedAt is the max fetchedAt", () => {
    const stats = computeIntelHealthStats(
      [
        row({ fetchedAt: hoursAgo(5) }),
        row({ fetchedAt: hoursAgo(1) }), // most recent
        row({ fetchedAt: hoursAgo(10) }),
      ],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    expect(stats.latestFetchedAt?.getTime()).toBe(hoursAgo(1).getTime())
  })

  it("intelLastRunAt + intelLanguage propagate from meta", () => {
    const stats = computeIntelHealthStats(
      [row()],
      { intelLastRunAt: "2026-05-10T10:00:00.000Z", intelLanguage: "ru" },
      NOW,
    )
    expect(stats.intelLastRunAt).toBe("2026-05-10T10:00:00.000Z")
    expect(stats.intelLanguage).toBe("ru")
  })

  it("averageRelevance is mean across all rows", () => {
    const stats = computeIntelHealthStats(
      [
        row({ relevanceScore: 0.8 }),
        row({ relevanceScore: 0.5 }),
        row({ relevanceScore: 1.0 }),
      ],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    expect(stats.averageRelevance).toBeCloseTo(0.7666666, 5)
  })
})

describe("computeIntelHealthStats — topSources / topIndustries", () => {
  it("topSources sorted by count descending", () => {
    const stats = computeIntelHealthStats(
      [
        row({ sourceLabel: "Reuters" }),
        row({ sourceLabel: "Reuters" }),
        row({ sourceLabel: "Bloomberg" }),
        row({ sourceLabel: "AP" }),
        row({ sourceLabel: "AP" }),
        row({ sourceLabel: "AP" }),
      ],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    expect(stats.topSources).toEqual([
      { source: "AP", count: 3 },
      { source: "Reuters", count: 2 },
      { source: "Bloomberg", count: 1 },
    ])
  })

  it("topSources caps at 10 entries", () => {
    const rows = Array.from({ length: 15 }, (_, i) => row({ sourceLabel: `src${i}` }))
    const stats = computeIntelHealthStats(
      rows,
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    expect(stats.topSources).toHaveLength(10)
  })

  it("topIndustries counts each tag separately (multi-tag rows)", () => {
    const stats = computeIntelHealthStats(
      [
        row({ industryTags: ["industrial", "agro"] }),
        row({ industryTags: ["industrial"] }),
        row({ industryTags: ["agro", "hospitality"] }),
      ],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    expect(stats.topIndustries).toEqual([
      { industry: "industrial", count: 2 },
      { industry: "agro", count: 2 },
      { industry: "hospitality", count: 1 },
    ])
  })

  it("topIndustries handles empty tag arrays gracefully", () => {
    const stats = computeIntelHealthStats(
      [row({ industryTags: [] }), row({ industryTags: [] })],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    expect(stats.topIndustries).toEqual([])
  })
})

describe("computeIntelHealthStats — last7Days time series", () => {
  it("returns 7 day buckets ordered oldest-first", () => {
    const stats = computeIntelHealthStats(
      [],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    expect(stats.last7Days).toHaveLength(7)
    // First entry is 6 days ago; last is today
    expect(stats.last7Days[0].date).toBe("2026-05-04")
    expect(stats.last7Days[6].date).toBe("2026-05-10")
  })

  it("counts items into the correct day bucket", () => {
    const stats = computeIntelHealthStats(
      [
        row({ fetchedAt: NOW }), // today bucket
        row({ fetchedAt: NOW }),
        row({ fetchedAt: daysAgo(2) }), // 2 days ago
      ],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    const today = stats.last7Days.find((d) => d.date === "2026-05-10")
    const twoDaysAgo = stats.last7Days.find((d) => d.date === "2026-05-08")
    expect(today?.count).toBe(2)
    expect(twoDaysAgo?.count).toBe(1)
  })

  it("excludes items older than 7 days", () => {
    const stats = computeIntelHealthStats(
      [row({ fetchedAt: daysAgo(10) }), row({ fetchedAt: daysAgo(30) })],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    const totalCounts = stats.last7Days.reduce((s, d) => s + d.count, 0)
    expect(totalCounts).toBe(0)
  })
})

describe("computeIntelHealthStats — status discriminator", () => {
  it("status='stale' when intelLastRunAt is null", () => {
    const stats = computeIntelHealthStats(
      [row()],
      { intelLastRunAt: null, intelLanguage: null },
      NOW,
    )
    expect(stats.status).toBe("stale")
  })

  it("status='stale' when intelLastRunAt > 25h ago", () => {
    const stats = computeIntelHealthStats(
      [row()],
      { intelLastRunAt: hoursAgo(26).toISOString(), intelLanguage: null },
      NOW,
    )
    expect(stats.status).toBe("stale")
  })

  it("status='healthy' when run < 25h ago AND items > 0", () => {
    const stats = computeIntelHealthStats(
      [row()],
      { intelLastRunAt: minutesAgo(60).toISOString(), intelLanguage: null },
      NOW,
    )
    expect(stats.status).toBe("healthy")
  })

  it("status='empty' when run < 25h ago BUT 0 items", () => {
    const stats = computeIntelHealthStats(
      [],
      { intelLastRunAt: minutesAgo(60).toISOString(), intelLanguage: null },
      NOW,
    )
    expect(stats.status).toBe("empty")
  })
})
