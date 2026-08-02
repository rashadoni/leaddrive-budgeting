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

  it("sets the tenant GUC transaction-locally, with the id BOUND not interpolated", async () => {
    // 12.4/A06 — this assertion inverted on 2026-08-02 and is stronger for it.
    // It used to require the orgId to appear IN the SQL text, which is exactly
    // the property that made the single most security-critical statement in
    // the codebase a concatenation. Now the id must NOT be in the string: it
    // travels as $1.
    //
    // `is_local = true` is the third argument and is what makes this a SET
    // LOCAL. Without it the tenant leaks to the next request on the same
    // pooled connection — silently, and cross-org.
    const execRaw = vi.fn().mockResolvedValue(0);
    txMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { $executeRawUnsafe: execRaw };
      return fn(tx);
    });
    await withOrgScope("cmockji6c0000u6oseeuz5ipq", async () => "ok");
    expect(execRaw).toHaveBeenCalledTimes(1);
    const [sql, ...params] = execRaw.mock.calls[0];
    expect(sql).toContain("set_config('app.organization_id', $1, true)");
    expect(sql).not.toContain("cmockji6c0000u6oseeuz5ipq");
    expect(params).toEqual(["cmockji6c0000u6oseeuz5ipq"]);
  });

  it("rejects an orgId that could break out of a string literal, before any SQL runs", async () => {
    // Two guards, and this test pins which one fires. The cuid-shape validator
    // rejects this input at the helper boundary — it has since Phase 5.2, and
    // it is the reason the former interpolation was never exploitable. The
    // bound parameter is defence in depth behind it, not the thing standing
    // between this string and the database.
    const execRaw = vi.fn().mockResolvedValue(0);
    txMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = { $executeRawUnsafe: execRaw };
      return fn(tx);
    });
    const hostile = "x'; SET LOCAL \"app.bypass_rls\" = 'true'; --";
    await expect(withOrgScope(hostile, async () => "ok")).rejects.toThrow(
      /cuid-shaped/,
    );
    expect(execRaw).not.toHaveBeenCalled();
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
