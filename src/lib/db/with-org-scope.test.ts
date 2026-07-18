/**
 * Phase 5.2 — `withOrgScope()` pre-flight unit tests.
 *
 * Locks the input-validation contract BEFORE any RLS migration lands.
 * 2026-05-16 architect Round-1 surfaced a fixture-blank-leak class
 * (single-char or empty orgId passes the original `[a-z0-9]+` charset
 * guard but matches zero rows once RLS is enabled = silent breakage).
 * Regex tightened to cuid-length-bound `{20,32}`; this file enforces.
 *
 * Does NOT exercise the actual transaction / Prisma path — that's an
 * integration test deferred to the multi-org leak fixture (precondition
 * #4 of the rollout per docs/ADR-RLS.md).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma so we can assert calls into `$transaction` without
// touching a real DB.
const txMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (fn: unknown) => txMock(fn),
  },
}));
// Stage 3 — withOrgScope defaults to the RLS-enforced app client. Pin the
// mock so a DATABASE_URL_APP in the runner's shell can't leak a real
// PrismaClient into these unit tests.
vi.mock("@/lib/db/prisma-app", async () => {
  const { prisma } = await import("@/lib/prisma");
  return { getPrismaApp: () => prisma, prismaApp: prisma };
});

import { withOrgScope } from "./with-org-scope";

beforeEach(() => {
  txMock.mockReset();
});

describe("withOrgScope — input validation", () => {
  it("throws when organizationId is empty string", async () => {
    await expect(withOrgScope("", async () => "ok")).rejects.toThrow(
      /organizationId is required/,
    );
    expect(txMock).not.toHaveBeenCalled();
  });

  it("throws when organizationId is whitespace-only", async () => {
    await expect(withOrgScope("   ", async () => "ok")).rejects.toThrow(
      /organizationId is required/,
    );
  });

  it("throws when organizationId is shorter than 20 chars (cuid is 25)", async () => {
    await expect(withOrgScope("x", async () => "ok")).rejects.toThrow(
      /cuid-shaped/,
    );
    // Even 19 chars rejected — must be 20+.
    await expect(withOrgScope("a".repeat(19), async () => "ok")).rejects.toThrow(
      /cuid-shaped/,
    );
    expect(txMock).not.toHaveBeenCalled();
  });

  it("throws when organizationId is longer than 32 chars", async () => {
    await expect(withOrgScope("a".repeat(33), async () => "ok")).rejects.toThrow(
      /cuid-shaped/,
    );
  });

  it("throws when organizationId contains non-alphanumeric chars (SQL injection guard)", async () => {
    // Length 25 (cuid-shaped) but contains `'`.
    await expect(
      withOrgScope("cmp123' OR '1'='1789abc", async () => "ok"),
    ).rejects.toThrow(/cuid-shaped/);
    // Hyphens / underscores / spaces all rejected — cuid charset only.
    await expect(
      withOrgScope("cmp-12345678901234567890", async () => "ok"),
    ).rejects.toThrow(/cuid-shaped/);
    await expect(
      withOrgScope("cmp 12345678901234567890", async () => "ok"),
    ).rejects.toThrow(/cuid-shaped/);
  });

  it("accepts valid 25-char cuid", async () => {
    txMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };
      return fn(tx);
    });
    const result = await withOrgScope("cmockji6c0000u6oseeuz5ipq", async () => "scoped-result");
    expect(result).toBe("scoped-result");
    expect(txMock).toHaveBeenCalledTimes(1);
  });

  it("accepts valid 20-char minimum cuid (lower bound inclusive)", async () => {
    txMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };
      return fn(tx);
    });
    await expect(withOrgScope("a".repeat(20), async () => "ok")).resolves.toBe("ok");
  });

  it("accepts valid 32-char maximum cuid (upper bound inclusive)", async () => {
    txMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };
      return fn(tx);
    });
    await expect(withOrgScope("a".repeat(32), async () => "ok")).resolves.toBe("ok");
  });

  it("emits SET LOCAL app.organization_id with the orgId", async () => {
    const execRaw = vi.fn().mockResolvedValue(0);
    txMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { $executeRawUnsafe: execRaw };
      return fn(tx);
    });
    await withOrgScope("cmockji6c0000u6oseeuz5ipq", async () => "ok");
    expect(execRaw).toHaveBeenCalledTimes(1);
    expect(execRaw.mock.calls[0][0]).toContain('SET LOCAL "app.organization_id"');
    expect(execRaw.mock.calls[0][0]).toContain("cmockji6c0000u6oseeuz5ipq");
  });

  it("never emits a custom-GUC bypass in normal scope", async () => {
    const execRaw = vi.fn().mockResolvedValue(0);
    txMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { $executeRawUnsafe: execRaw };
      return fn(tx);
    });
    await withOrgScope("cmockji6c0000u6oseeuz5ipq", async () => "ok");
    expect(execRaw).toHaveBeenCalledTimes(1);
    expect(execRaw.mock.calls[0][0]).not.toContain("bypass_rls");
  });
});
