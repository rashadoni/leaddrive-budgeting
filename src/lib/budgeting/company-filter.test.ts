import { describe, it, expect, vi } from "vitest";
import { resolveCompanyFilter } from "./company-filter";

// Lightweight stub of PrismaClient — only the two `company` methods used.
// Cast to `any` at call site to satisfy resolveCompanyFilter's PrismaClient
// type without dragging in the full generated client.
function makeStubPrisma(opts: {
  findFirst?: (args: any) => Promise<any>;
  findMany?: (args: any) => Promise<any[]>;
}) {
  return {
    company: {
      findFirst: opts.findFirst ?? vi.fn().mockResolvedValue(null),
      findMany: opts.findMany ?? vi.fn().mockResolvedValue([]),
    },
  } as any;
}

describe("resolveCompanyFilter (Turn 30 helper)", () => {
  it("companyId null → {kind: 'all'} (org-wide consolidated)", async () => {
    const prisma = makeStubPrisma({});
    const result = await resolveCompanyFilter(prisma, "org-1", null);
    expect(result).toEqual({ kind: "all" });
  });

  it("companyId undefined → {kind: 'all'}", async () => {
    const prisma = makeStubPrisma({});
    const result = await resolveCompanyFilter(prisma, "org-1", undefined);
    expect(result).toEqual({ kind: "all" });
  });

  it("companyId empty string → {kind: 'all'}", async () => {
    const prisma = makeStubPrisma({});
    const result = await resolveCompanyFilter(prisma, "org-1", "");
    expect(result).toEqual({ kind: "all" });
  });

  it("level=2 op-co → {kind: 'single', companyIds: [id], resolvedFromLevel: 2}", async () => {
    const prisma = makeStubPrisma({
      findFirst: vi.fn().mockResolvedValue({ id: "co-aac-main", level: 2 }),
    });
    const result = await resolveCompanyFilter(prisma, "org-1", "co-aac-main");
    expect(result).toEqual({
      kind: "single",
      companyIds: ["co-aac-main"],
      resolvedFromLevel: 2,
    });
  });

  it("level=1 sub-group → expands to children's level=2 ids", async () => {
    const prisma = makeStubPrisma({
      findFirst: vi.fn().mockResolvedValue({ id: "sg-atl", level: 1 }),
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: "co-dbz" }, { id: "co-pmz" }, { id: "co-taz" }, { id: "co-mrkz" }]),
    });
    const result = await resolveCompanyFilter(prisma, "org-1", "sg-atl");
    expect(result).toEqual({
      kind: "single",
      companyIds: ["co-dbz", "co-pmz", "co-taz", "co-mrkz"],
      resolvedFromLevel: 1,
    });
  });

  it("level=1 sub-group with NO children → returns empty companyIds (caller handles as no-data)", async () => {
    const prisma = makeStubPrisma({
      findFirst: vi.fn().mockResolvedValue({ id: "sg-empty", level: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    });
    const result = await resolveCompanyFilter(prisma, "org-1", "sg-empty");
    expect(result).toEqual({
      kind: "single",
      companyIds: [],
      resolvedFromLevel: 1,
    });
  });

  it("cross-tenant companyId (exists in different org) → {kind: 'not_found'}", async () => {
    // findFirst returns null because the WHERE clause includes organizationId
    // — Prisma sees no row matching id+orgId tuple. Caller returns 404.
    const prisma = makeStubPrisma({
      findFirst: vi.fn().mockResolvedValue(null),
    });
    const result = await resolveCompanyFilter(prisma, "org-1", "co-from-other-org");
    expect(result).toEqual({ kind: "not_found" });
  });

  it("findFirst is called with tenant-scoped where clause (security regression guard)", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "co-aac", level: 2 });
    const prisma = makeStubPrisma({ findFirst });
    await resolveCompanyFilter(prisma, "org-azmade", "co-aac");
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "co-aac", organizationId: "org-azmade" },
      select: { id: true, level: true },
    });
  });

  it("level=1 children query uses tenant-scoped where (security regression guard)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makeStubPrisma({
      findFirst: vi.fn().mockResolvedValue({ id: "sg-atl", level: 1 }),
      findMany,
    });
    await resolveCompanyFilter(prisma, "org-azmade", "sg-atl");
    expect(findMany).toHaveBeenCalledWith({
      where: { parentCompanyId: "sg-atl", organizationId: "org-azmade" },
      select: { id: true },
    });
  });
});
