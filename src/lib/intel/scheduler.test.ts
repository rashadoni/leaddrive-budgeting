// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, runIntelCrawlMock } = vi.hoisted(() => ({
  prismaMock: {
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
  },
  runIntelCrawlMock: vi.fn(),
}))

vi.mock("./crawler", async () => {
  const actual = await vi.importActual<typeof import("./crawler")>("./crawler")
  return {
    ...actual,
    runIntelCrawl: runIntelCrawlMock,
  }
})

import {
  runScheduledIntelCrawl,
  orgIdToLockKey,
  INTEL_SCHEDULE_INTERVAL_MS,
} from "./scheduler"

const ORG = "org_demo"
const NOW_ISO = "2026-05-10T20:00:00.000Z"
const NOW_MS = new Date(NOW_ISO).getTime()
const fakeNow = () => new Date(NOW_MS)

const buildInputOk = async () => ({
  organizationId: ORG,
  industries: ["hospitality"],
  companyCodes: ["AAC"],
  language: "en" as const,
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ settings: {} })
  prismaMock.organization.update.mockReset().mockResolvedValue({})
  prismaMock.$queryRawUnsafe.mockReset().mockResolvedValue([{ pg_try_advisory_lock: true }])
  runIntelCrawlMock.mockReset().mockResolvedValue({
    itemsFetched: 5,
    itemsCreated: 3,
    itemsSkipped: 2,
    errors: [],
    promptVersion: "v1",
    modelName: "test-model",
  })
})

describe("orgIdToLockKey", () => {
  it("deterministic — same orgId → same key", () => {
    expect(orgIdToLockKey(ORG)).toBe(orgIdToLockKey(ORG))
  })

  it("different orgIds → different keys", () => {
    expect(orgIdToLockKey("org_a")).not.toBe(orgIdToLockKey("org_b"))
  })

  it("returns bigint within signed 64-bit", () => {
    const key = orgIdToLockKey(ORG)
    expect(key > BigInt(0)).toBe(true)
    expect(key < BigInt(2) ** BigInt(56)).toBe(true) // 7 bytes max
  })
})

describe("runScheduledIntelCrawl", () => {
  it("happy path: no lastRunAt → runs crawl + updates settings", async () => {
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
    })
    expect(result).toMatchObject({ ok: true })
    expect(runIntelCrawlMock).toHaveBeenCalledOnce()
    expect(prismaMock.organization.update).toHaveBeenCalledWith({
      where: { id: ORG },
      data: { settings: { intelLastRunAt: NOW_ISO } },
    })
  })

  it("skip too-recent: lastRunAt < 24h ago", async () => {
    const recentRun = new Date(NOW_MS - 60 * 60 * 1000).toISOString() // 1h ago
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { intelLastRunAt: recentRun },
    })
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
    })
    expect(result).toMatchObject({ skipped: "too-recent", lastRunAt: recentRun })
    expect(runIntelCrawlMock).not.toHaveBeenCalled()
  })

  it("runs after 24h elapsed", async () => {
    const oldRun = new Date(NOW_MS - 25 * 60 * 60 * 1000).toISOString() // 25h ago
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { intelLastRunAt: oldRun },
    })
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
    })
    expect(result).toMatchObject({ ok: true })
    expect(runIntelCrawlMock).toHaveBeenCalledOnce()
  })

  it("skip lock-busy: pg_try_advisory_lock returns false", async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ pg_try_advisory_lock: false }])
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
    })
    expect(result).toEqual({ skipped: "lock-busy" })
    expect(runIntelCrawlMock).not.toHaveBeenCalled()
  })

  it("skip no-input: buildInput returns null (e.g. org has 0 active companies)", async () => {
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: async () => null,
      now: fakeNow,
    })
    expect(result).toEqual({ skipped: "no-input" })
    expect(runIntelCrawlMock).not.toHaveBeenCalled()
  })

  it("releases lock even if crawl throws", async () => {
    runIntelCrawlMock.mockRejectedValue(new Error("LLM down"))
    await expect(
      runScheduledIntelCrawl(prismaMock as never, ORG, {
        buildInput: buildInputOk,
        now: fakeNow,
      }),
    ).rejects.toThrow(/LLM down/)
    // Lock release call should still happen
    const calls = prismaMock.$queryRawUnsafe.mock.calls
    expect(calls.some((c) => String(c[0]).includes("pg_advisory_unlock"))).toBe(true)
  })

  it("skipLock=true bypasses Postgres advisory lock (test mode)", async () => {
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
      skipLock: true,
    })
    expect(result).toMatchObject({ ok: true })
    // Lock acquire NOT called
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it("returns error when org not found", async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null)
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
    })
    expect(result).toEqual({ ok: false, error: `Organization ${ORG} not found` })
  })

  it("custom intervalMs override", async () => {
    const recentRun = new Date(NOW_MS - 30 * 1000).toISOString() // 30s ago
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { intelLastRunAt: recentRun },
    })
    // 1-minute interval — 30s ago counts as too-recent
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
      intervalMs: 60 * 1000,
    })
    expect(result).toMatchObject({ skipped: "too-recent" })
  })

  it("INTEL_SCHEDULE_INTERVAL_MS is 24h", () => {
    expect(INTEL_SCHEDULE_INTERVAL_MS).toBe(24 * 60 * 60 * 1000)
  })
})

// Phase 7.G Turn CII (D.5b → scheduler) — optional commodity ingest
describe("D.5b wire — runCommodityIngest opt-in flag", () => {
  it("default (no flag) → result has no commodityIngest field", async () => {
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
      skipLock: true,
    })
    expect(result).toMatchObject({ ok: true })
    if ("ok" in result && result.ok) {
      expect(result.commodityIngest).toBeUndefined()
    }
  })

  it("runCommodityIngest=true → result includes commodityIngest counts", async () => {
    const fakeAdapter = {
      source: "test-fx",
      label: "Test",
      fetch: vi.fn(async () => ({
        source: "test-fx",
        dataPoints: [
          {
            sourceCode: "test-fx",
            metric: "USD_AZN",
            datetime: new Date(NOW_ISO),
            value: 0.58,
          },
        ],
        errors: [],
        fetched: true,
      })),
    }
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
      skipLock: true,
      runCommodityIngest: true,
      commodityAdapters: [fakeAdapter],
    })
    expect(result).toMatchObject({ ok: true })
    if ("ok" in result && result.ok) {
      expect(result.commodityIngest).toBeDefined()
      expect(result.commodityIngest?.sources).toEqual(["test-fx"])
      expect(result.commodityIngest?.pointsWritten).toBe(1)
      expect(result.commodityIngest?.errors).toEqual([])
    }
    expect(fakeAdapter.fetch).toHaveBeenCalledOnce()
  })

  it("commodity-ingest adapter throw is recorded but doesn't abort crawl", async () => {
    const throwingAdapter = {
      source: "broken",
      label: "Broken",
      fetch: vi.fn(async () => {
        throw new Error("upstream API down")
      }),
    }
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
      skipLock: true,
      runCommodityIngest: true,
      commodityAdapters: [throwingAdapter],
    })
    // Crawl still ok; per-adapter throw recorded under errors[]
    expect(result).toMatchObject({ ok: true })
    if ("ok" in result && result.ok) {
      expect(result.commodityIngest?.errors[0]).toMatch(/Adapter broken threw/)
    }
  })
})

// Phase 7.G Turn C (E.2e) — optional post-crawl breach scan
describe("E.2e — runBreachScan opt-in flag", () => {
  it("default (no flag) → result has no breachScan field", async () => {
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
      skipLock: true,
    })
    expect(result).toMatchObject({ ok: true })
    if ("ok" in result && result.ok) {
      expect(result.breachScan).toBeUndefined()
    }
  })

  it("runBreachScan=true → result includes breachScan counts", async () => {
    // Mock indicatorValue.findMany so the breach-scan-runner load step succeeds.
    // Empty rows → zero scans, but breachScan still present in result.
    const findManyMock = vi.fn(async () => [])
    const ext = prismaMock as unknown as { indicatorValue: { findMany: typeof findManyMock } }
    ext.indicatorValue = { findMany: findManyMock }
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
      skipLock: true,
      runBreachScan: true,
    })
    expect(result).toMatchObject({ ok: true })
    if ("ok" in result && result.ok) {
      expect(result.breachScan).toBeDefined()
      expect(result.breachScan?.ivsLoaded).toBe(0)
      expect(result.breachScan?.breachesPersisted).toBe(0)
      expect(result.breachScan?.errors).toEqual([])
    }
    expect(findManyMock).toHaveBeenCalledOnce()
  })

  it("breach-scan throw doesn't abort crawl result (records error)", async () => {
    const findManyMock = vi.fn(async () => {
      throw new Error("DB exploded")
    })
    const ext = prismaMock as unknown as { indicatorValue: { findMany: typeof findManyMock } }
    ext.indicatorValue = { findMany: findManyMock }
    const result = await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
      skipLock: true,
      runBreachScan: true,
    })
    // Crawl still ok even though breach scan threw
    expect(result).toMatchObject({ ok: true })
    if ("ok" in result && result.ok) {
      expect(result.breachScan?.errors[0]).toContain("breach-scan threw")
    }
  })
})

// Phase 7.G Turn LXXXXIII (D.5c) — language resolution from settings.intelLanguage
describe("D.5c — language resolution from settings", () => {
  it("settings.intelLanguage='ru' overrides input.language='en'", async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { intelLanguage: "ru" },
    })
    await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk, // input.language="en"
      now: fakeNow,
      skipLock: true,
    })
    // Verify runIntelCrawlMock called with overridden language
    const callArgs = runIntelCrawlMock.mock.calls[0]?.[0] as { language?: string }
    expect(callArgs.language).toBe("ru")
  })

  it("settings.intelLanguage='az' propagates to crawl input", async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { intelLanguage: "az" },
    })
    await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk,
      now: fakeNow,
      skipLock: true,
    })
    const callArgs = runIntelCrawlMock.mock.calls[0]?.[0] as { language?: string }
    expect(callArgs.language).toBe("az")
  })

  it("invalid settings.intelLanguage value falls back to input.language", async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { intelLanguage: "fr" }, // not in en/ru/az
    })
    await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk, // input.language="en"
      now: fakeNow,
      skipLock: true,
    })
    const callArgs = runIntelCrawlMock.mock.calls[0]?.[0] as { language?: string }
    expect(callArgs.language).toBe("en")
  })

  it("missing settings.intelLanguage falls back to input.language", async () => {
    prismaMock.organization.findUnique.mockResolvedValue({ settings: {} })
    await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputOk, // input.language="en"
      now: fakeNow,
      skipLock: true,
    })
    const callArgs = runIntelCrawlMock.mock.calls[0]?.[0] as { language?: string }
    expect(callArgs.language).toBe("en")
  })

  it("missing both settings AND input.language → 'en' default", async () => {
    prismaMock.organization.findUnique.mockResolvedValue({ settings: {} })
    const buildInputNoLang = async () => ({
      organizationId: ORG,
      industries: ["hospitality"],
      companyCodes: ["AAC"],
      // no language
    })
    await runScheduledIntelCrawl(prismaMock as never, ORG, {
      buildInput: buildInputNoLang,
      now: fakeNow,
      skipLock: true,
    })
    const callArgs = runIntelCrawlMock.mock.calls[0]?.[0] as { language?: string }
    expect(callArgs.language).toBe("en")
  })
})
