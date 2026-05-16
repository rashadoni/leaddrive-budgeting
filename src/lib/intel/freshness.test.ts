/**
 * Pure-function tests for the reference-data freshness checker. Mocks
 * the IntelDataPoint queries to control fetchedAt timing and verify
 * each status branch (fresh / stale / critical_stale / missing).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkReferenceFreshness } from "./freshness";

const NOW = new Date("2026-05-16T12:00:00Z").getTime();

function makeMockPrisma(
  rowsBySource: Record<string, { fetchedAt: Date | null; metricCount: number }>,
) {
  return {
    intelDataPoint: {
      findFirst: async ({ where }: { where: { sourceCode: string } }) => {
        const r = rowsBySource[where.sourceCode];
        if (!r || !r.fetchedAt) return null;
        return { fetchedAt: r.fetchedAt };
      },
      groupBy: async ({ where }: { where: { sourceCode: string } }) => {
        const r = rowsBySource[where.sourceCode];
        if (!r) return [];
        return Array.from({ length: r.metricCount }, (_, i) => ({ metric: `m${i}` }));
      },
    },
  } as never;
}

describe("checkReferenceFreshness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("classifies as fresh when daily feed fetched within 36h", async () => {
    const prisma = makeMockPrisma({
      "tcmb-fx-rates": {
        fetchedAt: new Date(NOW - 12 * 60 * 60 * 1000), // 12h ago
        metricCount: 5,
      },
    });
    const r = await checkReferenceFreshness(prisma, "org-1", [
      { sourceCode: "tcmb-fx-rates", cadence: "daily" },
    ]);
    expect(r[0].status).toBe("fresh");
    expect(r[0].ageHours).toBeCloseTo(12, 0);
    expect(r[0].metricCount).toBe(5);
  });

  it("classifies as stale when daily feed is 36–72h old", async () => {
    const prisma = makeMockPrisma({
      "tcmb-fx-rates": {
        fetchedAt: new Date(NOW - 48 * 60 * 60 * 1000), // 48h ago
        metricCount: 5,
      },
    });
    const r = await checkReferenceFreshness(prisma, "org-1", [
      { sourceCode: "tcmb-fx-rates", cadence: "daily" },
    ]);
    expect(r[0].status).toBe("stale");
  });

  it("classifies as critical_stale when daily feed > 72h old", async () => {
    const prisma = makeMockPrisma({
      "tcmb-fx-rates": {
        fetchedAt: new Date(NOW - 100 * 60 * 60 * 1000), // 100h ago
        metricCount: 5,
      },
    });
    const r = await checkReferenceFreshness(prisma, "org-1", [
      { sourceCode: "tcmb-fx-rates", cadence: "daily" },
    ]);
    expect(r[0].status).toBe("critical_stale");
  });

  it("classifies monthly feeds with day-scale thresholds (45d / 60d)", async () => {
    const prisma = makeMockPrisma({
      "worldbank-cpi": {
        fetchedAt: new Date(NOW - 20 * 24 * 60 * 60 * 1000), // 20d ago
        metricCount: 3,
      },
      "worldbank-sugar": {
        fetchedAt: new Date(NOW - 50 * 24 * 60 * 60 * 1000), // 50d ago
        metricCount: 1,
      },
    });
    const r = await checkReferenceFreshness(prisma, "org-1", [
      { sourceCode: "worldbank-cpi", cadence: "monthly" },
      { sourceCode: "worldbank-sugar", cadence: "monthly" },
    ]);
    expect(r[0].status).toBe("fresh"); // 20d < 45d
    expect(r[1].status).toBe("stale"); // 50d > 45d but < 60d
  });

  it("returns missing when no datapoint exists", async () => {
    const prisma = makeMockPrisma({});
    const r = await checkReferenceFreshness(prisma, "org-1", [
      { sourceCode: "weather-openmeteo", cadence: "daily" },
    ]);
    expect(r[0].status).toBe("missing");
    expect(r[0].ageHours).toBeNull();
    expect(r[0].metricCount).toBe(0);
  });
});
