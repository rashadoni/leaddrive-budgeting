/**
 * Phase 7.G Turn XLVII (Board Deck v2 Turn 1) — cache helper tests.
 *
 * Locks: snapshotHash determinism (excludes generatedAt), cache hit
 * skips LLM, cache miss calls LLM + writes row, stale-after-24h
 * regenerates, hash-changed regenerates, language pinning, bypassCache
 * forces regen, P2002 race falls through to update, LLM failure
 * returns null.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the audit logger so the test doesn't reach Prisma for it.
const { logAuditMock } = vi.hoisted(() => ({
  logAuditMock: vi.fn().mockResolvedValue({ ok: true, id: "audit_1" }),
}));
vi.mock("@/lib/audit/log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit/log")>(
    "@/lib/audit/log",
  );
  return { ...actual, logAuditEvent: logAuditMock };
});

// Mock the default prisma export so any path that falls through to
// `defaultPrisma` (audit emission) doesn't try to open a real
// connection. Tests inject their own mock for the cache itself via
// the `prisma` option.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  getCachedNarration,
  getOrCreateNarration,
  snapshotHash,
  NARRATION_CACHE_TTL_MS,
} from "./get-or-create-narration";
import type { BoardSnapshot } from "./build-snapshot";
import type { NarrationOutput } from "./narrate-snapshot";
import { NarrationProviderResponseError } from "./narrate-snapshot";

function makeSnapshot(
  overrides: Partial<BoardSnapshot> = {},
): BoardSnapshot {
  return {
    org: { name: "FO Holding", slug: "fo", settings: null },
    period: "2026",
    generatedAt: "2026-05-07T10:00:00.000Z",
    operational: [
      {
        id: "co_1",
        code: "AAC",
        name: "AAC Industrial",
        industry: "industrial",
        level: 2,
        isActive: true,
        role: "operational",
        sortOrder: 1,
      },
    ],
    indicators: [],
    cells: [],
    compositeByCompany: new Map([
      [
        "co_1",
        { score: 42, band: "amber", contributingCount: 5, totalCount: 5, coverage: "full" as const },
      ],
    ]),
    countsByCompany: new Map(),
    matches: [],
    matchesBySeverity: { critical: [], warning: [], info: [] },
    idToCode: new Map([["co_1", "AAC"]]),
    cellByKey: new Map(),
    totals: {
      operational: 1,
      indicators: 0,
      cells: 0,
      green: 0,
      amber: 1,
      red: 0,
    },
    ...overrides,
  } as BoardSnapshot;
}

const VALID_OUTPUT: NarrationOutput = {
  headline: "Stable quarter, mild industrial drag.",
  paragraphs: ["P1.", "P2.", "P3."],
  modelName: "claude-sonnet-4-5-20250929",
  promptVersion: "v1",
  usage: { inputTokens: 1500, outputTokens: 700 },
};

interface MockPrismaShape {
  boardDeckNarration: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  auditEvent: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

/**
 * Builds a runtime-mock with the right shape, then casts to the
 * production `PrismaSurface`. Vitest's `Mock<Procedure>` type is
 * intentionally too narrow to satisfy Prisma's overloaded generic
 * method signatures — cast pattern mirrors the variance-explainer
 * + intel-crawler test seams.
 */
type PrismaSurfaceForTest = Parameters<
  typeof getOrCreateNarration
>[1] extends infer Opts
  ? Opts extends { prisma?: infer P }
    ? P
    : never
  : never;

function makePrismaShape(): MockPrismaShape {
  return {
    boardDeckNarration: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({ id: "audit_1" }),
      update: vi.fn().mockResolvedValue({ id: "audit_1" }),
    },
  };
}

function makePrisma(): MockPrismaShape & PrismaSurfaceForTest {
  return makePrismaShape() as MockPrismaShape & PrismaSurfaceForTest;
}

beforeEach(() => {
  vi.clearAllMocks();
  logAuditMock.mockResolvedValue({ ok: true, id: "audit_1" });
});

// ---------------------------------------------------------------------------
// snapshotHash
// ---------------------------------------------------------------------------

describe("snapshotHash", () => {
  it("returns stable sha256 hex", () => {
    const h = snapshotHash(makeSnapshot());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("excludes generatedAt — same snapshot 10ms apart hits same hash", () => {
    const a = snapshotHash(
      makeSnapshot({ generatedAt: "2026-05-07T10:00:00.000Z" }),
    );
    const b = snapshotHash(
      makeSnapshot({ generatedAt: "2026-05-07T10:00:00.010Z" }),
    );
    expect(a).toBe(b);
  });

  it("changes when totals change", () => {
    const a = snapshotHash(makeSnapshot());
    const b = snapshotHash(
      makeSnapshot({
        totals: {
          operational: 1,
          indicators: 0,
          cells: 0,
          green: 1, // changed: was 0
          amber: 1,
          red: 0,
        },
      }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when a composite score moves", () => {
    const a = snapshotHash(makeSnapshot());
    const b = snapshotHash(
      makeSnapshot({
        compositeByCompany: new Map([
          [
            "co_1",
            {
              score: 50, // moved
              band: "amber" as const,
              contributingCount: 5,
              totalCount: 5,
              coverage: "full" as const,
            },
          ],
        ]),
      }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when alert counts change", () => {
    const a = snapshotHash(makeSnapshot());
    const b = snapshotHash(
      makeSnapshot({
        matchesBySeverity: {
          critical: [
            {
              ruleId: "r1",
              ruleName: "R1",
              severity: "critical",
              message: "m",
              messageKey: "alerts.messages.r1",
              messageParams: {},
              affectedCompanyIds: [],
            },
          ],
          warning: [],
          info: [],
        },
      }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when prompt-visible company identity changes", () => {
    const a = snapshotHash(makeSnapshot());
    const renamed = makeSnapshot();
    renamed.operational = renamed.operational.map((company) => ({
      ...company,
      name: "Renamed entity",
      industry: "hospitality",
    }));
    expect(snapshotHash(renamed)).not.toBe(a);
  });

  it("changes when prompt-visible alert content changes at the same count", () => {
    const first = makeSnapshot({
      matchesBySeverity: {
        critical: [{
          ruleId: "r1",
          ruleName: "Rule",
          severity: "critical",
          message: "First evidence",
          messageKey: "alerts.messages.r1",
          messageParams: {},
          affectedCompanyIds: ["co_1"],
        }],
        warning: [],
        info: [],
      },
    });
    const second = makeSnapshot({
      matchesBySeverity: {
        critical: [{
          ruleId: "r1",
          ruleName: "Rule",
          severity: "critical",
          message: "Changed evidence",
          messageKey: "alerts.messages.r1",
          messageParams: {},
          affectedCompanyIds: ["co_1"],
        }],
        warning: [],
        info: [],
      },
    });
    expect(snapshotHash(second)).not.toBe(snapshotHash(first));
  });

  it("is stable when only alert evaluation order changes", () => {
    const alertA = {
      ruleId: "a-rule",
      ruleName: "A",
      severity: "critical" as const,
      message: "A evidence",
      messageKey: "alerts.a",
      messageParams: {},
      affectedCompanyIds: ["co_1"],
    };
    const alertB = {
      ruleId: "b-rule",
      ruleName: "B",
      severity: "critical" as const,
      message: "B evidence",
      messageKey: "alerts.b",
      messageParams: {},
      affectedCompanyIds: ["co_1"],
    };
    const first = makeSnapshot({
      matchesBySeverity: { critical: [alertA, alertB], warning: [], info: [] },
    });
    const reordered = makeSnapshot({
      matchesBySeverity: { critical: [alertB, alertA], warning: [], info: [] },
    });
    expect(snapshotHash(reordered)).toBe(snapshotHash(first));
  });
});

describe("getCachedNarration — read-only boundary", () => {
  it("returns exact cached content and never writes or audits", async () => {
    const prisma = makePrisma();
    prisma.boardDeckNarration.findUnique.mockResolvedValue({
      headline: "Cached",
      paragraphs: ["a", "b", "c"],
      modelName: "m",
      promptVersion: "v1",
      tokensIn: 10,
      tokensOut: 5,
      generatedAt: new Date("2026-05-07T10:00:00.000Z"),
    });
    const result = await getCachedNarration(
      {
        organizationId: "org_1",
        snapshot: makeSnapshot(),
        language: "en",
      },
      {
        prisma: prisma as never,
        now: () => new Date("2026-05-07T11:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({
      narration: { headline: "Cached", paragraphs: ["a", "b", "c"] },
      generatedAt: "2026-05-07T10:00:00.000Z",
      isStale: false,
    });
    expect(prisma.boardDeckNarration.create).not.toHaveBeenCalled();
    expect(prisma.boardDeckNarration.update).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("returns an expired exact row with a stale marker instead of generating", async () => {
    const prisma = makePrisma();
    prisma.boardDeckNarration.findUnique.mockResolvedValue({
      headline: "Old cached",
      paragraphs: ["a", "b", "c"],
      modelName: "m",
      promptVersion: "v1",
      tokensIn: 0,
      tokensOut: 0,
      generatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    const result = await getCachedNarration(
      {
        organizationId: "org_1",
        snapshot: makeSnapshot(),
        language: "ru",
      },
      {
        prisma: prisma as never,
        now: () => new Date("2026-05-03T00:00:00.000Z"),
      },
    );
    expect(result?.isStale).toBe(true);
    expect(prisma.boardDeckNarration.create).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("treats malformed cached paragraphs as absent", async () => {
    const prisma = makePrisma();
    prisma.boardDeckNarration.findUnique.mockResolvedValue({
      headline: "Broken",
      paragraphs: ["only one"],
      modelName: "m",
      promptVersion: "v1",
      tokensIn: 0,
      tokensOut: 0,
      generatedAt: new Date(),
    });
    await expect(
      getCachedNarration(
        {
          organizationId: "org_1",
          snapshot: makeSnapshot(),
          language: "az",
        },
        { prisma: prisma as never },
      ),
    ).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getOrCreateNarration — cache hit
// ---------------------------------------------------------------------------

describe("getOrCreateNarration — cache hit", () => {
  it("returns cached row + does NOT call LLM when fresh", async () => {
    const prisma = makePrisma();
    const cached = {
      id: "row_1",
      organizationId: "org_1",
      period: "2026",
      snapshotHash: "abc",
      language: "en",
      headline: "Cached headline",
      paragraphs: ["a", "b", "c"],
      modelName: "claude-sonnet-4-5-20250929",
      promptVersion: "v1",
      tokensIn: 1500,
      tokensOut: 700,
      generatedAt: new Date("2026-05-07T09:00:00.000Z"),
    };
    prisma.boardDeckNarration.findUnique.mockResolvedValue(cached);

    const runImpl = vi.fn();
    const result = await getOrCreateNarration(
      {
        organizationId: "org_1",
        snapshot: makeSnapshot(),
        language: "en",
      },
      {
        prisma,
        runNarrationImpl: runImpl,
        now: () => new Date("2026-05-07T10:00:00.000Z"), // 1h after cache row
      },
    );

    expect(runImpl).not.toHaveBeenCalled();
    expect(prisma.boardDeckNarration.create).not.toHaveBeenCalled();
    expect(result?.headline).toBe("Cached headline");
    expect(result?.paragraphs).toEqual(["a", "b", "c"]);
    expect(result?.usage).toEqual({ inputTokens: 1500, outputTokens: 700 });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("regenerates when cache row is stale (>24h)", async () => {
    const prisma = makePrisma();
    prisma.boardDeckNarration.findUnique.mockResolvedValue({
      id: "row_1",
      organizationId: "org_1",
      period: "2026",
      snapshotHash: "abc",
      language: "en",
      headline: "Old headline",
      paragraphs: ["a", "b", "c"],
      modelName: "old-model",
      promptVersion: "v0",
      tokensIn: 100,
      tokensOut: 50,
      generatedAt: new Date("2026-05-06T09:00:00.000Z"), // 25h ago
    });
    const runImpl = vi.fn().mockResolvedValue(VALID_OUTPUT);
    const now = () => new Date("2026-05-07T10:00:00.000Z");

    const result = await getOrCreateNarration(
      {
        organizationId: "org_1",
        snapshot: makeSnapshot(),
        language: "en",
      },
      { prisma, runNarrationImpl: runImpl, now },
    );

    expect(runImpl).toHaveBeenCalledTimes(1);
    expect(prisma.boardDeckNarration.create).toHaveBeenCalledTimes(1);
    expect(result?.headline).toBe(VALID_OUTPUT.headline);
  });

  it("respects custom ttlMs override", async () => {
    const prisma = makePrisma();
    prisma.boardDeckNarration.findUnique.mockResolvedValue({
      id: "row_1",
      organizationId: "org_1",
      period: "2026",
      snapshotHash: "abc",
      language: "en",
      headline: "h",
      paragraphs: ["a", "b", "c"],
      modelName: "m",
      promptVersion: "v1",
      tokensIn: 0,
      tokensOut: 0,
      generatedAt: new Date("2026-05-07T09:59:00.000Z"), // 1 min ago
    });
    const runImpl = vi.fn().mockResolvedValue(VALID_OUTPUT);
    const now = () => new Date("2026-05-07T10:00:00.000Z");

    // ttl = 30s → 1-minute-old row is stale.
    const result = await getOrCreateNarration(
      {
        organizationId: "org_1",
        snapshot: makeSnapshot(),
        language: "en",
      },
      { prisma, runNarrationImpl: runImpl, now, ttlMs: 30_000 },
    );

    expect(runImpl).toHaveBeenCalledTimes(1);
    expect(result?.headline).toBe(VALID_OUTPUT.headline);
  });

  it("default TTL is 24h", () => {
    expect(NARRATION_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// getOrCreateNarration — cache miss
// ---------------------------------------------------------------------------

describe("getOrCreateNarration — cache miss", () => {
  it("calls LLM + writes row + emits audit on miss", async () => {
    const prisma = makePrisma();
    const runImpl = vi.fn().mockResolvedValue(VALID_OUTPUT);

    const result = await getOrCreateNarration(
      {
        organizationId: "org_1",
        snapshot: makeSnapshot(),
        language: "en",
        audit: {
          route: "/budgeting/board-deck",
          actorUserId: "u_admin",
        },
      },
      { prisma, runNarrationImpl: runImpl },
    );

    expect(runImpl).toHaveBeenCalledTimes(1);
    expect(prisma.boardDeckNarration.create).toHaveBeenCalledTimes(1);
    expect(result?.headline).toBe(VALID_OUTPUT.headline);

    // Verify create payload shape.
    const createArg = prisma.boardDeckNarration.create.mock.calls[0][0];
    expect(createArg.data.organizationId).toBe("org_1");
    expect(createArg.data.period).toBe("2026");
    expect(createArg.data.language).toBe("en");
    expect(createArg.data.headline).toBe(VALID_OUTPUT.headline);
    expect(createArg.data.paragraphs).toEqual(VALID_OUTPUT.paragraphs);
    expect(createArg.data.tokensIn).toBe(1500);
    expect(createArg.data.tokensOut).toBe(700);
    expect(typeof createArg.data.snapshotHash).toBe("string");
    expect(createArg.data.snapshotHash).toMatch(/^[0-9a-f]{64}$/);

    // An awaited event is durable before the paid call starts.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const auditArg = logAuditMock.mock.calls[0][1];
    expect(auditArg.event.action).toBe("ai_board_deck_narration_run");
    expect(auditArg.event.entityId).toBe("org_1");
    expect(auditArg.event.metadata.tokensIn).toBe(0);
    expect(auditArg.event.metadata.modelName).toBe("pending-provider-response");
    expect(auditArg.event.metadata.outcome).toBe("pending");
    expect(auditArg.actorUserId).toBe("u_admin");

    expect(prisma.auditEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "audit_1", organizationId: "org_1" },
        data: {
          metadata: expect.objectContaining({
            tokensIn: 1500,
            tokensOut: 700,
            modelName: VALID_OUTPUT.modelName,
            outcome: "succeeded",
          }),
        },
      }),
    );
  });

  it("regenerates when snapshot hash differs from cached row", async () => {
    const prisma = makePrisma();
    // findUnique scoped by hash — different hash returns null.
    prisma.boardDeckNarration.findUnique.mockResolvedValue(null);
    const runImpl = vi.fn().mockResolvedValue(VALID_OUTPUT);

    await getOrCreateNarration(
      {
        organizationId: "org_1",
        snapshot: makeSnapshot(),
        language: "en",
      },
      { prisma, runNarrationImpl: runImpl },
    );
    expect(runImpl).toHaveBeenCalledTimes(1);
    expect(prisma.boardDeckNarration.create).toHaveBeenCalledTimes(1);
  });

  it("language is part of cache key — separate languages = separate rows", async () => {
    const prisma = makePrisma();
    const runImpl = vi.fn().mockResolvedValue(VALID_OUTPUT);
    const snap = makeSnapshot();

    await getOrCreateNarration(
      { organizationId: "org_1", snapshot: snap, language: "en" },
      { prisma, runNarrationImpl: runImpl },
    );
    await getOrCreateNarration(
      { organizationId: "org_1", snapshot: snap, language: "ru" },
      { prisma, runNarrationImpl: runImpl },
    );

    // Both calls fired (both cache misses — different language keys).
    expect(runImpl).toHaveBeenCalledTimes(2);
    // findUnique was called with `language: "en"` then `language: "ru"`.
    const callA = prisma.boardDeckNarration.findUnique.mock.calls[0][0];
    const callB = prisma.boardDeckNarration.findUnique.mock.calls[1][0];
    expect(callA.where.organizationId_period_snapshotHash_language.language).toBe(
      "en",
    );
    expect(callB.where.organizationId_period_snapshotHash_language.language).toBe(
      "ru",
    );
  });
});

// ---------------------------------------------------------------------------
// getOrCreateNarration — bypassCache + race + LLM failure
// ---------------------------------------------------------------------------

describe("getOrCreateNarration — bypassCache + race + LLM failure", () => {
  it("bypassCache=true skips findUnique + always calls LLM", async () => {
    const prisma = makePrisma();
    const runImpl = vi.fn().mockResolvedValue(VALID_OUTPUT);

    await getOrCreateNarration(
      { organizationId: "org_1", snapshot: makeSnapshot(), language: "en" },
      { prisma, runNarrationImpl: runImpl, bypassCache: true },
    );

    expect(prisma.boardDeckNarration.findUnique).not.toHaveBeenCalled();
    expect(runImpl).toHaveBeenCalledTimes(1);
  });

  it("falls through to update on P2002 race", async () => {
    const prisma = makePrisma();
    prisma.boardDeckNarration.create.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "P2002" }),
    );
    const runImpl = vi.fn().mockResolvedValue(VALID_OUTPUT);

    const result = await getOrCreateNarration(
      { organizationId: "org_1", snapshot: makeSnapshot(), language: "en" },
      { prisma, runNarrationImpl: runImpl },
    );

    expect(prisma.boardDeckNarration.update).toHaveBeenCalledTimes(1);
    expect(result?.headline).toBe(VALID_OUTPUT.headline);
  });

  it("returns null when LLM throws (graceful degradation)", async () => {
    const prisma = makePrisma();
    const runImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    const result = await getOrCreateNarration(
      { organizationId: "org_1", snapshot: makeSnapshot(), language: "en" },
      { prisma, runNarrationImpl: runImpl },
    );

    expect(result).toBeNull();
    // No row written; the paid attempt was durably audited before provider use.
    expect(prisma.boardDeckNarration.create).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][1].event.action).toBe(
      "ai_board_deck_narration_run",
    );
    expect(prisma.auditEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          metadata: expect.objectContaining({
            outcome: "provider_failed",
            tokensIn: 0,
            tokensOut: 0,
          }),
        },
      }),
    );
  });

  it("finalizes failed-response audit with billable provider usage", async () => {
    const prisma = makePrisma();
    const runImpl = vi.fn().mockRejectedValue(
      new NarrationProviderResponseError("invalid response JSON", {
        modelName: "claude-billable-response",
        usage: { inputTokens: 1234, outputTokens: 321 },
      }),
    );

    const result = await getOrCreateNarration(
      { organizationId: "org_1", snapshot: makeSnapshot(), language: "en" },
      { prisma, runNarrationImpl: runImpl },
    );

    expect(result).toBeNull();
    expect(prisma.auditEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          metadata: expect.objectContaining({
            outcome: "provider_failed",
            modelName: "claude-billable-response",
            tokensIn: 1234,
            tokensOut: 321,
          }),
        },
      }),
    );
  });

  it("withholds the provider call when the pre-provider audit cannot persist", async () => {
    const prisma = makePrisma();
    const runImpl = vi.fn().mockResolvedValue(VALID_OUTPUT);
    logAuditMock.mockRejectedValueOnce(new Error("audit unavailable"));
    const result = await getOrCreateNarration(
      { organizationId: "org_1", snapshot: makeSnapshot(), language: "en" },
      { prisma, runNarrationImpl: runImpl },
    );
    expect(result).toBeNull();
    expect(runImpl).not.toHaveBeenCalled();
    expect(prisma.boardDeckNarration.create).not.toHaveBeenCalled();
  });

  it("withholds the provider call when audit resolves ok=false", async () => {
    const prisma = makePrisma();
    const runImpl = vi.fn().mockResolvedValue(VALID_OUTPUT);
    logAuditMock.mockResolvedValueOnce({ ok: false, error: "db unavailable" });
    const result = await getOrCreateNarration(
      { organizationId: "org_1", snapshot: makeSnapshot(), language: "en" },
      { prisma, runNarrationImpl: runImpl },
    );
    expect(result).toBeNull();
    expect(runImpl).not.toHaveBeenCalled();
  });

  it("logs but tolerates non-P2002 write failure", async () => {
    const prisma = makePrisma();
    prisma.boardDeckNarration.create.mockRejectedValue(
      new Error("connection refused"),
    );
    const runImpl = vi.fn().mockResolvedValue(VALID_OUTPUT);
    // Phase 8 D4 continuation — get-or-create-narration migrated to
    // structured logger which mutes itself in test env by default.
    // Opt into LOG_IN_TESTS=1 so the existing console.error spy still
    // sees the emission via the logger's internal emit path.
    const prevLogInTests = process.env.LOG_IN_TESTS;
    process.env.LOG_IN_TESTS = "1";
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await getOrCreateNarration(
      { organizationId: "org_1", snapshot: makeSnapshot(), language: "en" },
      { prisma, runNarrationImpl: runImpl },
    );

    // Caller still gets the result — DB blip shouldn't lose the LLM's
    // output.
    expect(result?.headline).toBe(VALID_OUTPUT.headline);
    expect(consoleSpy).toHaveBeenCalled();
    expect(prisma.boardDeckNarration.update).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    if (prevLogInTests === undefined) delete process.env.LOG_IN_TESTS;
    else process.env.LOG_IN_TESTS = prevLogInTests;
  });
});
