/**
 * Free, retrieval-only news crawler.
 *
 * This module intentionally has no dependency on the Anthropic crawler or
 * sentiment scorer. It stores only source-native headlines and provenance.
 * `sentimentScore` is explicitly NULL: absence of a financial assessment must
 * remain `unknown`, never become a fabricated neutral value.
 */

import type { PrismaClient } from "@prisma/client";
import { inferCompanyTags } from "../infer-company-tags";
import { urlHash } from "../url-hash";
import { buildCompanyNewsQuery, PILOT_COMPANY_CODES, readApprovedNewsAliases } from "./entity-aliases";
import { fetchGdeltArticles, type FreeNewsArticle } from "./gdelt";

type FreeNewsPrisma = Pick<PrismaClient, "organization" | "company" | "intelItem">;

export type FreeNewsCrawlResult = {
  source: "gdelt-doc-2.1";
  queriedCompanies: string[];
  skippedNoApprovedAliases: string[];
  itemsFetched: number;
  itemsCreated: number;
  itemsSkipped: number;
  itemsRejected: number;
  errors: string[];
};

type PilotCompany = { code: string; industry: string | null };

type CollectedArticle = {
  article: FreeNewsArticle;
  companyTags: Set<string>;
  industryTags: Set<string>;
};

// A raw exact entity mention proves only that the company is named in the
// headline. It does not prove financial materiality, direction, or impact.
// Keep it deliberately neutral until a separately governed scorer exists.
const ENTITY_MENTION_RELEVANCE_SCORE = 0.5;

function formatSourceLabel(article: FreeNewsArticle): string {
  const language = article.language ?? "unknown-language";
  const observedAt = article.observedAt?.toISOString() ?? "unknown-observed-at";
  return `GDELT DOC 2.1 · ${article.domain} · ${language} · observed ${observedAt}`;
}

function isDuplicateError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002";
}

function mergeTags(existing: readonly string[], incoming: ReadonlySet<string>): string[] {
  const seen = new Set(existing);
  return [...existing, ...[...incoming].filter((tag) => !seen.has(tag))];
}

export async function runFreeNewsCrawl(
  organizationId: string,
  options: {
    prisma: FreeNewsPrisma;
    fetchArticles?: (query: string) => Promise<FreeNewsArticle[]>;
    now?: () => Date;
  },
): Promise<FreeNewsCrawlResult> {
  const result: FreeNewsCrawlResult = {
    source: "gdelt-doc-2.1",
    queriedCompanies: [],
    skippedNoApprovedAliases: [],
    itemsFetched: 0,
    itemsCreated: 0,
    itemsSkipped: 0,
    itemsRejected: 0,
    errors: [],
  };
  const pilotCodes = new Set<string>(PILOT_COMPANY_CODES);
  const [organization, companies] = await Promise.all([
    options.prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
    options.prisma.company.findMany({
      where: { organizationId, isActive: true, code: { in: [...PILOT_COMPANY_CODES] } },
      select: { code: true, industry: true },
    }),
  ]);
  const aliasesByCompany = readApprovedNewsAliases(organization?.settings, pilotCodes);
  const fetchArticles = options.fetchArticles ?? fetchGdeltArticles;
  const fetchedAt = (options.now ?? (() => new Date()))();
  const approvedEntities = [...aliasesByCompany.entries()].map(([code, patterns]) => ({ code, patterns }));
  const collectedByHash = new Map<string, CollectedArticle>();

  for (const company of companies as PilotCompany[]) {
    const aliases = aliasesByCompany.get(company.code) ?? [];
    const query = buildCompanyNewsQuery(aliases);
    if (!query) {
      result.skippedNoApprovedAliases.push(company.code);
      continue;
    }
    result.queriedCompanies.push(company.code);
    let articles: FreeNewsArticle[];
    try {
      articles = await fetchArticles(query);
    } catch (error) {
      result.errors.push(`${company.code}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    result.itemsFetched += articles.length;
    const queriedEntity = [{ code: company.code, patterns: aliases }];
    for (const article of articles) {
      // The source query is only a discovery filter. Persist a company tag only
      // when the raw headline itself contains an owner-approved alias.
      if (!inferCompanyTags(article.headline, queriedEntity).includes(company.code)) {
        result.itemsRejected++;
        continue;
      }
      const hash = urlHash(article.url);
      const confirmedCompanyTags = inferCompanyTags(article.headline, approvedEntities);
      const existing = collectedByHash.get(hash);
      if (existing) {
        for (const code of confirmedCompanyTags) existing.companyTags.add(code);
        for (const taggedCompany of companies as PilotCompany[]) {
          if (confirmedCompanyTags.includes(taggedCompany.code) && taggedCompany.industry) {
            existing.industryTags.add(taggedCompany.industry);
          }
        }
        result.itemsSkipped++;
        continue;
      }

      const industryTags = new Set<string>();
      for (const taggedCompany of companies as PilotCompany[]) {
        if (confirmedCompanyTags.includes(taggedCompany.code) && taggedCompany.industry) {
          industryTags.add(taggedCompany.industry);
        }
      }
      collectedByHash.set(hash, {
        article,
        companyTags: new Set(confirmedCompanyTags),
        industryTags,
      });
    }
  }

  for (const [hash, item] of collectedByHash) {
    const companyTags = [...item.companyTags];
    const industryTags = [...item.industryTags];
    try {
      await options.prisma.intelItem.create({
        data: {
          organizationId,
          title: item.article.headline,
          // The source provides no synopsis. Repeating the raw headline is
          // truthful and prevents an invented/translated summary.
          summary: item.article.headline,
          url: item.article.url,
          urlHash: hash,
          sourceLabel: formatSourceLabel(item.article),
          relevanceScore: ENTITY_MENTION_RELEVANCE_SCORE,
          industryTags,
          companyTags,
          publishedAt: item.article.publishedAt,
          fetchedAt,
          sentimentScore: null,
        },
      });
      result.itemsCreated++;
    } catch (error) {
      if (!isDuplicateError(error)) {
        result.errors.push(`write failed for ${item.article.url}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      // A prior crawl (or a concurrent writer) may already own this URL.
      // Preserve its source-native fields, but append only independently
      // verified tags so a shared article never loses a company association.
      try {
        const existing = await options.prisma.intelItem.findUnique({
          where: { organizationId_urlHash: { organizationId, urlHash: hash } },
          select: { companyTags: true, industryTags: true },
        });
        if (!existing) {
          result.errors.push(`dedupe conflict could not be re-read for ${item.article.url}`);
          continue;
        }
        const nextCompanyTags = mergeTags(existing.companyTags, item.companyTags);
        const nextIndustryTags = mergeTags(existing.industryTags, item.industryTags);
        if (
          nextCompanyTags.length !== existing.companyTags.length ||
          nextIndustryTags.length !== existing.industryTags.length
        ) {
          await options.prisma.intelItem.update({
            where: { organizationId_urlHash: { organizationId, urlHash: hash } },
            data: { companyTags: nextCompanyTags, industryTags: nextIndustryTags },
          });
        }
        result.itemsSkipped++;
      } catch (mergeError) {
        result.errors.push(`dedupe merge failed for ${item.article.url}: ${mergeError instanceof Error ? mergeError.message : String(mergeError)}`);
      }
    }
  }
  return result;
}
