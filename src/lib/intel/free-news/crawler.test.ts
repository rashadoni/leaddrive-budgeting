import { describe, expect, it, vi } from "vitest";
import { runFreeNewsCrawl } from "./crawler";
import type { FreeNewsArticle } from "./gdelt";

const NOW = new Date("2026-07-21T12:00:00.000Z");

type TestPrisma = {
  organization: { findUnique: ReturnType<typeof vi.fn> };
  company: { findMany: ReturnType<typeof vi.fn> };
  intelItem: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(input: {
  settings?: unknown;
  companies?: Array<{ code: string; industry: string | null }>;
  create?: ReturnType<typeof vi.fn>;
  existingIntelItem?: { companyTags: string[]; industryTags: string[] } | null;
  update?: ReturnType<typeof vi.fn>;
}): TestPrisma {
  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue({ settings: input.settings ?? null }),
    },
    company: {
      findMany: vi.fn().mockResolvedValue(input.companies ?? []),
    },
    intelItem: {
      create: input.create ?? vi.fn().mockResolvedValue({ id: "item_1" }),
      findUnique: vi.fn().mockResolvedValue(input.existingIntelItem ?? null),
      update: input.update ?? vi.fn().mockResolvedValue({ id: "item_1" }),
    },
  };
}

const EDEN_ARTICLE: FreeNewsArticle = {
  headline: "Eden Agro announces harvest update",
  url: "https://example.az/eden-harvest",
  domain: "example.az",
  language: "azerbaijani",
  publishedAt: null,
  observedAt: new Date("2026-07-21T11:00:00.000Z"),
};

describe("runFreeNewsCrawl", () => {
  it("writes raw evidence with tenant scope and an explicit null sentiment score", async () => {
    const create = vi.fn().mockResolvedValue({ id: "item_1" });
    const prisma = makePrisma({
      settings: { newsEntityAliases: { "AZSEKER-EDEN": ["Eden Agro"] } },
      companies: [{ code: "AZSEKER-EDEN", industry: "agro_crops" }],
      create,
    });

    const result = await runFreeNewsCrawl("org_1", {
      prisma: prisma as never,
      fetchArticles: vi.fn().mockResolvedValue([EDEN_ARTICLE]),
      now: () => NOW,
    });

    expect(result).toMatchObject({ itemsFetched: 1, itemsCreated: 1, errors: [] });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        title: EDEN_ARTICLE.headline,
        summary: EDEN_ARTICLE.headline,
        companyTags: ["AZSEKER-EDEN"],
        industryTags: ["agro_crops"],
        relevanceScore: 0.5,
        publishedAt: null,
        fetchedAt: NOW,
        sentimentScore: null,
        sourceLabel: "GDELT DOC 2.1 · example.az · azerbaijani · observed 2026-07-21T11:00:00.000Z",
      }),
    });
    expect(prisma.company.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        isActive: true,
        code: { in: ["AZSEKER-AZSF", "AZSEKER-CPC", "AZSEKER-EDEN", "AZSEKER-MALT"] },
      },
      select: { code: true, industry: true },
    });
  });

  it("fails closed without approved aliases and never guesses from the company code", async () => {
    const prisma = makePrisma({
      settings: { entityAliases: { EDEN: "AZSEKER-EDEN" } },
      companies: [{ code: "AZSEKER-EDEN", industry: "agro_crops" }],
    });
    const fetchArticles = vi.fn();

    const result = await runFreeNewsCrawl("org_1", { prisma: prisma as never, fetchArticles });

    expect(result.skippedNoApprovedAliases).toEqual(["AZSEKER-EDEN"]);
    expect(fetchArticles).not.toHaveBeenCalled();
    expect(prisma.intelItem.create).not.toHaveBeenCalled();
  });

  it("rejects query-only hits whose raw headline does not contain an approved alias", async () => {
    const prisma = makePrisma({
      settings: { newsEntityAliases: { "AZSEKER-EDEN": ["Eden Agro"] } },
      companies: [{ code: "AZSEKER-EDEN", industry: "agro_crops" }],
    });
    const result = await runFreeNewsCrawl("org_1", {
      prisma: prisma as never,
      fetchArticles: vi.fn().mockResolvedValue([{ ...EDEN_ARTICLE, headline: "Generic agriculture update" }]),
    });

    expect(result).toMatchObject({ itemsRejected: 1, itemsCreated: 0 });
    expect(prisma.intelItem.create).not.toHaveBeenCalled();
  });

  it("is idempotent both within one provider response and across the database unique key", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: "first" })
      .mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "P2002" }));
    const prisma = makePrisma({
      settings: {
        newsEntityAliases: {
          "AZSEKER-EDEN": ["Eden Agro"],
          "AZSEKER-AZSF": ["Azərşəkər Sugar"],
        },
      },
      companies: [
        { code: "AZSEKER-EDEN", industry: "agro_crops" },
        { code: "AZSEKER-AZSF", industry: "food_processing" },
      ],
      create,
      existingIntelItem: { companyTags: ["AZSEKER-AZSF"], industryTags: ["food_processing"] },
    });
    const fetchArticles = vi
      .fn()
      .mockResolvedValueOnce([EDEN_ARTICLE, EDEN_ARTICLE])
      .mockResolvedValueOnce([
        {
          ...EDEN_ARTICLE,
          headline: "Azərşəkər Sugar reports another source article",
          url: "https://example.az/azsf-duplicate-in-db",
        },
      ]);

    const result = await runFreeNewsCrawl("org_1", { prisma: prisma as never, fetchArticles });
    expect(result).toMatchObject({ itemsCreated: 1, itemsSkipped: 2, errors: [] });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retains every verified company tag when one URL is found by multiple approved queries", async () => {
    const create = vi.fn().mockResolvedValue({ id: "shared" });
    const prisma = makePrisma({
      settings: {
        newsEntityAliases: {
          "AZSEKER-EDEN": ["Eden Agro"],
          "AZSEKER-AZSF": ["Azərşəkər Sugar"],
        },
      },
      companies: [
        { code: "AZSEKER-EDEN", industry: "agro_crops" },
        { code: "AZSEKER-AZSF", industry: "food_processing" },
      ],
      create,
    });
    const sharedArticle = {
      ...EDEN_ARTICLE,
      headline: "Eden Agro and Azərşəkər Sugar announce a joint harvest programme",
      url: "https://example.az/joint-harvest",
    };

    const result = await runFreeNewsCrawl("org_1", {
      prisma: prisma as never,
      fetchArticles: vi.fn().mockResolvedValue([sharedArticle]),
    });

    expect(result).toMatchObject({ itemsFetched: 2, itemsCreated: 1, itemsSkipped: 1, errors: [] });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyTags: ["AZSEKER-EDEN", "AZSEKER-AZSF"],
        industryTags: ["agro_crops", "food_processing"],
        relevanceScore: 0.5,
      }),
    });
  });

  it("merges newly verified tags onto an existing tenant-scoped URL row", async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" }));
    const update = vi.fn().mockResolvedValue({ id: "existing" });
    const prisma = makePrisma({
      settings: { newsEntityAliases: { "AZSEKER-EDEN": ["Eden Agro"] } },
      companies: [{ code: "AZSEKER-EDEN", industry: "agro_crops" }],
      create,
      existingIntelItem: { companyTags: ["AZSEKER-AZSF"], industryTags: ["food_processing"] },
      update,
    });

    const result = await runFreeNewsCrawl("org_1", {
      prisma: prisma as never,
      fetchArticles: vi.fn().mockResolvedValue([EDEN_ARTICLE]),
    });

    expect(result).toMatchObject({ itemsCreated: 0, itemsSkipped: 1, errors: [] });
    expect(prisma.intelItem.findUnique).toHaveBeenCalledWith({
      where: expect.objectContaining({ organizationId_urlHash: expect.objectContaining({ organizationId: "org_1" }) }),
      select: { companyTags: true, industryTags: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: expect.objectContaining({ organizationId_urlHash: expect.objectContaining({ organizationId: "org_1" }) }),
      data: {
        companyTags: ["AZSEKER-AZSF", "AZSEKER-EDEN"],
        industryTags: ["food_processing", "agro_crops"],
      },
    });
  });

  it("contains per-company provider failures and continues other approved queries", async () => {
    const prisma = makePrisma({
      settings: {
        newsEntityAliases: {
          "AZSEKER-EDEN": ["Eden Agro"],
          "AZSEKER-AZSF": ["Azərşəkər Sugar"],
        },
      },
      companies: [
        { code: "AZSEKER-EDEN", industry: "agro_crops" },
        { code: "AZSEKER-AZSF", industry: "food_processing" },
      ],
    });
    const fetchArticles = vi
      .fn()
      .mockRejectedValueOnce(new Error("GDELT DOC request failed (429)"))
      .mockResolvedValueOnce([
        { ...EDEN_ARTICLE, headline: "Azərşəkər Sugar reports production update" },
      ]);

    const result = await runFreeNewsCrawl("org_1", { prisma: prisma as never, fetchArticles });
    expect(result.itemsCreated).toBe(1);
    expect(result.errors).toEqual(["AZSEKER-EDEN: GDELT DOC request failed (429)"]);
  });
});
