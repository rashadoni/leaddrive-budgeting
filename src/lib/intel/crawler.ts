/**
 * Phase 7.G Turn XLIII (Phase D.2) — AI Web Crawler orchestrator.
 *
 * Single-call design: one Anthropic `messages.create` with the
 * `web_search_20250305` server-side tool collapses the search → score
 * → tag pipeline into one round-trip. The model:
 *   1. Receives the org's industries[] + active companyCodes[] as
 *      context.
 *   2. Calls `web_search` 1-5× internally (server-side, transparent to
 *      us).
 *   3. Returns STRICT JSON with `relevanceScore`, `industryTags[]`,
 *      `companyTags[]` already scored — no follow-up call.
 *
 * Validation mirrors `validateAndShape()` in
 * `src/lib/risk/variance-explainer.ts` (gold-standard pattern). Test
 * seam via `RunIntelCrawlOptions` so unit tests can inject a fake SDK
 * client + Prisma.
 *
 * Per-org rate limit + scheduled-refresh both live in the caller (POST
 * /api/intel/refresh + Phase D.5 BullMQ worker), NOT here — this module
 * is a pure orchestrator that fires one crawl when invoked.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { extractJsonFromText } from '@/lib/onboarding/ai-mapper/json-extract';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { prismaAdmin } from "@/lib/db/prisma-admin"
import { runSentimentBatch } from './sentiment';
import { urlHash } from './url-hash';
export { urlHash } from './url-hash';
import type { IntelCrawlInput, IntelCrawlResult, IntelOutputLanguage } from './types';
import {
  buildEntityPatternsFromCompanies,
  inferCompanyTags,
  mergeCompanyTags,
} from './infer-company-tags';

/** Bump on any change to SYSTEM_PROMPT or buildIntelPrompt structure.
 *  v1 = initial Phase D.2 ship.
 *  v2 = Phase 7.G Turn LXXXXIII (D.5c) — language parameter added.
 *  v3 = Phase 7.K Phase 4 — sector-specific tag list + search heuristics
 *       for all 14 holding sectors (was AzerSheker-only). */
export const INTEL_PROMPT_VERSION = 'v3';

/** Per-crawl item cap. The model is instructed to return ≤10; this is
 *  a safety belt against runaway responses. */
const MAX_ITEMS_PER_CRAWL = 10;

/** Anthropic web_search uses count — 5 calls is enough for a multi-
 *  industry sweep without driving cost up. (At $10/1K searches × 5 ×
 *  60 orgs/day ≈ $0.03/day org-wide.) */
const WEB_SEARCH_MAX_USES = 5;

/** Language-specific output instruction line. The rest of SYSTEM_PROMPT
 *  stays English (instructions to the LLM) — only the user-facing strings
 *  (title / summary / sourceLabel) flip. */
const LANGUAGE_OUTPUT_INSTRUCTIONS: Record<IntelOutputLanguage, string> = {
  en: '  - Output `title`, `summary`, and `sourceLabel` strings IN ENGLISH.',
  ru: '  - Output `title`, `summary`, and `sourceLabel` strings IN RUSSIAN (translate where the source is non-Russian; preserve company names + tickers as-is).',
  az: '  - Output `title`, `summary`, and `sourceLabel` strings IN AZERBAIJANI (translate where the source is non-Azerbaijani; preserve company names + tickers as-is).',
};

/** Build language-aware system prompt.
 *  Phase 7.G Turn LXXXXIII (D.5c) — was a const string; now parameterized
 *  over output language so RU/AZ orgs see summaries in their language. */
export function buildSystemPrompt(language: IntelOutputLanguage = 'en'): string {
  return `You are an intelligence analyst building a daily news feed for the CFO of an Azerbaijani diversified holding (~60 operational companies across 14 sectors: hospitality, agro, food processing, pharma, real estate, services, industrial, etc.).

Your job: use the web_search tool to find recent news (last 7 days) relevant to the holding's portfolio, then return a STRICT JSON feed of items each scored for relevance.

What counts as relevant:
  - Sector-level news affecting any of the listed industries (regulatory, macro, supply-chain, demand-side).
  - Company-specific news mentioning any of the listed company codes or their full names.
  - Cross-cutting Azerbaijani / Caucasus / regional news that materially affects the holding (currency, energy, trade policy).
  - **Sector thematic tags** — emit one or more in industryTags[] for each item:
    Food processing / agro:
    * "azerbaijan-agro" — Azerbaijani agriculture sector news (crop conditions, subsidies, irrigation, weather alerts in Salyan/Imishli/Sabirabad/Yevlax)
    * "sugar-policy" — sugar tariffs, import quotas, refined-sugar price controls (AZ or major exporters: BR/IN/EU/TH)
    * "ice-11-future" — ICE Sugar No. 11 futures movements ≥3% intraday or with named catalyst
    Hospitality:
    * "az-tourism" — AZ tourism arrivals, conference bookings, F1 weekend, holiday/visa policy
    Pharma:
    * "drug-approval-az" — drug approvals from MoH AZ, EMA/FDA actions affecting AZ supply, recall events, Pharmacheck warnings
    Retail / beverage:
    * "food-cpi-az" — stat.gov.az food CPI breakdown moves; staples pricing pressure, foot-traffic / e-commerce penetration
    Construction / real estate:
    * "construction-permit-az" — new permit issuance, state-financed project tenders, materials shortage alerts, AZ housing market trends
    Logistics:
    * "logistics-az" — fuel price changes (Brent / diesel / gasoline), customs delays, BTC pipeline, Caspian shipping rates, Baltic Dry Index moves
    Education:
    * "education-policy-az" — Ministry of Education tuition caps, accreditation actions, student loan policy
    Competitor moves:
    * "competitor:<slug>" — any named competitor for AZ portfolio (e.g. "competitor:hilton-az", "competitor:akkord", "competitor:bravo", "competitor:nobel-ilac", "competitor:azersun-poultry", "competitor:coca-cola-az", "competitor:pasha-property", "competitor:ada-university", "competitor:baku-steel"). Use the explicit slug from the holding's competitor list when known.
    Emit each tag as a SEPARATE STRING in industryTags[] (e.g. ["food_processing", "azerbaijan-agro", "ice-11-future"] or ["hospitality", "az-tourism", "competitor:hilton-az"]).

  - **Sector-specific search heuristics** — use these to guide your web searches:
    * **Hospitality**: AZ tourism arrivals, hotel occupancy trends in Baku/Ganja/Quba, ADR moves, BTC hotel news, conference cycle (F1/IGF/SOCAR)
    * **Pharma**: drug approval announcements (AZ MoH, FDA/EMA actions on AZ-imported drugs), API supply disruptions, Türkiye pharma manufacturers, Sanofi/Gedeon Richter AZ
    * **Retail**: foot-traffic reports, Bravo/Bizim/Bolmart pricing & expansion, e-commerce penetration, AZ food-CPI breakdown moves
    * **Construction**: state-funded infrastructure tenders, cement/steel/lumber price spikes, Akkord/Azkons/MSCM project announcements, housing permit data
    * **Poultry**: feed-grain cost pressure, Azersun poultry capacity, broiler/egg wholesale price moves, avian-flu / biosecurity alerts
    * **Beverage**: Coca-Cola/Efes pricing, sugar tax discussions, Caspian Mineral water bottling capacity
    * **Logistics**: diesel/gasoline price moves, BTC pipeline volume, Caspian port congestion, Baltic Dry Index, AZ railway tariffs
    * **Real estate**: PASHA Property launches, Baku CBD office cap-rate trends, residential pricing, mortgage rate moves
    * **Education**: ADA / Khazar / Baku Higher Oil School news, tuition policy, AZ enrollment trends
    * **Entertainment**: Crystal Hall / Baku F1 / concert announcements, weather-sensitive outdoor venues
    * **Industrial**: SOCAR Petkim, Baku Steel, AZ manufacturing PMI, energy input costs
    * **Services**: cross-border services trade, AZ professional services market

Hard constraints:
  - You MUST call web_search at least once before producing the feed. Do not return items without searching.
  - Return at most 10 items, ordered by relevance descending.
  - Each item's \`url\` MUST be a real, parseable URL from the search results — never invented.
  - Each item's \`summary\` MUST be ≤200 characters.
  - \`relevanceScore\` is honest: 1.0 = directly names a listed company; 0.7 = sector + region match; 0.4 = sector only; below 0.3 = drop the item.
  - Output is JSON-only. No markdown fences, no commentary, no apology.
${LANGUAGE_OUTPUT_INSTRUCTIONS[language]}
  - Schema (use EXACTLY these field names):
    {
      "items": [
        {
          "title": "...",
          "summary": "≤200 char one-sentence digest",
          "url": "https://...",
          "sourceLabel": "Reuters | Bloomberg | local outlet name",
          "publishedAt": "ISO-8601 or null if not extractable",
          "relevanceScore": 0.0-1.0,
          "industryTags": ["industrial", ...],
          "companyTags": ["AAC", ...]
        }
      ]
    }

If the searches return no relevant news, return \`{"items": []}\` — never fabricate items to pad the feed.`;
}


/**
 * SHA-256 of a normalised URL (lowercased + trailing-slash stripped +
 * query-string sorted). Used as the dedup key on `IntelItem.urlHash`
 * so the same article from two different referrers de-dupes correctly.
 */
/** Pure helper — formats the user-message body. Testable without the
 *  Anthropic SDK. */
export function buildIntelPrompt(input: IntelCrawlInput): string {
  const industriesLine =
    input.industries.length > 0
      ? input.industries.join(', ')
      : '(none listed — return empty feed)';
  const companiesLine =
    input.companyCodes.length > 0
      ? input.companyCodes.join(', ')
      : '(none listed)';

  return `Holding portfolio context:
  Industries: ${industriesLine}
  Active company codes: ${companiesLine}

Search the web for news from the last 7 days that materially affects ANY of the above. Then return the STRICT JSON feed per the system prompt schema. Cap at ${MAX_ITEMS_PER_CRAWL} items, ordered by relevance descending.`;
}

/** Validated shape of one item after JSON parse + cleanup. Items that
 *  fail validation are dropped (not throw) — one bad item shouldn't
 *  poison the whole feed. */
interface ValidatedItem {
  title: string;
  summary: string;
  url: string;
  sourceLabel: string;
  publishedAt: Date | null;
  relevanceScore: number;
  industryTags: string[];
  companyTags: string[];
}

/** Validate + shape one parsed item. Returns `null` on shape violation
 *  so the caller can drop it from the feed. URL is parsed via `new
 *  URL()` to ensure it's well-formed BEFORE hashing — `urlHash`'s
 *  fail-soft branch would otherwise let garbage URLs into the dedup
 *  index. */
function validateItem(raw: unknown): ValidatedItem | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.title !== 'string' || r.title.trim() === '') return null;
  if (typeof r.summary !== 'string' || r.summary.trim() === '') return null;
  if (typeof r.url !== 'string' || r.url.trim() === '') return null;
  if (typeof r.sourceLabel !== 'string' || r.sourceLabel.trim() === '') {
    return null;
  }

  // Drop items with un-parseable URLs BEFORE hashing.
  try {
    new URL(r.url);
  } catch {
    return null;
  }

  if (
    typeof r.relevanceScore !== 'number' ||
    !Number.isFinite(r.relevanceScore) ||
    r.relevanceScore < 0 ||
    r.relevanceScore > 1
  ) {
    return null;
  }

  const industryTags =
    Array.isArray(r.industryTags) &&
    r.industryTags.every((t): t is string => typeof t === 'string')
      ? r.industryTags
      : [];
  const companyTags =
    Array.isArray(r.companyTags) &&
    r.companyTags.every((t): t is string => typeof t === 'string')
      ? r.companyTags
      : [];

  let publishedAt: Date | null = null;
  if (typeof r.publishedAt === 'string' && r.publishedAt.trim() !== '') {
    const d = new Date(r.publishedAt);
    if (!Number.isNaN(d.getTime())) publishedAt = d;
  }

  return {
    title: r.title.trim(),
    summary: r.summary.trim().slice(0, 200),
    url: r.url.trim(),
    sourceLabel: r.sourceLabel.trim(),
    publishedAt,
    relevanceScore: r.relevanceScore,
    industryTags,
    companyTags,
  };
}

/** Parse the LLM response into a validated item list. Throws on
 *  top-level shape violation (no `items` array) so the caller can
 *  surface it as `errors[]` entry. */
function parseAndValidate(rawJson: unknown): ValidatedItem[] {
  if (rawJson == null || typeof rawJson !== 'object') {
    throw new Error("response is not a JSON object");
  }
  const obj = rawJson as Record<string, unknown>;
  if (!Array.isArray(obj.items)) {
    throw new Error("response missing 'items' array");
  }
  const out: ValidatedItem[] = [];
  for (const item of obj.items.slice(0, MAX_ITEMS_PER_CRAWL)) {
    const v = validateItem(item);
    if (v) out.push(v);
  }
  return out;
}

/** Subset of PrismaClient surface area we use — explicit so unit tests
 *  can inject a minimal mock without faking the whole client. */
type CrawlerPrisma = {
  intelItem: {
    create: PrismaClient['intelItem']['create'];
    update: PrismaClient['intelItem']['update'];
  };
  /** Phase 7.M Tier2 #1 — fetch companies once per crawl to build
   *  the entity-pattern dictionary used by `inferCompanyTags`. Tests
   *  can omit this and the inference step silently no-ops. */
  company?: {
    findMany: PrismaClient['company']['findMany'];
  };
};

export interface RunIntelCrawlOptions {
  /** Override the SDK client (test seam). */
  client?: ReturnType<typeof getAnthropicClient>;
  /** Override the model id. */
  model?: string;
  /** Override the response token cap. */
  maxTokens?: number;
  /** Override Prisma (test seam). Unit tests inject a stub; the route
   *  never sets this and uses the default. */
  prisma?: CrawlerPrisma;
  /** Phase 7.H Feature B — sentiment scoring after persistence. Pass
   *  `false` to skip (used by tests so the LLM mock surface stays small).
   *  Pass a function to override (e.g. injecting a stub for unit tests).
   *  Default: real `runSentimentBatch` from `./sentiment`. */
  scoreSentimentBatch?: typeof runSentimentBatch | false;
}

/**
 * Run one crawl for an org. Returns counters + per-stage errors; never
 * throws on per-item failures (those increment `errors[]` and the run
 * continues). Top-level LLM failure / parse failure DOES throw to the
 * caller's audit-emission path.
 */
export async function runIntelCrawl(
  input: IntelCrawlInput,
  opts: RunIntelCrawlOptions = {},
): Promise<IntelCrawlResult> {
  // Short-circuit: empty industries AND empty companyCodes → no point
  // burning tokens. The route still emits an audit event with zero
  // counters so the dashboard sees the no-op crawl.
  if (input.industries.length === 0 && input.companyCodes.length === 0) {
    return {
      itemsFetched: 0,
      itemsCreated: 0,
      itemsSkipped: 0,
      errors: [],
      promptVersion: INTEL_PROMPT_VERSION,
    };
  }

  const client = opts.client ?? getAnthropicClient();
  const model = opts.model ?? AI_MODEL;
  // 8K covers a 10-item feed with full summaries + tags; below that
  // RU/AZ output truncates (per `feedback_llm_max_tokens.md`).
  const maxTokens = opts.maxTokens ?? 8192;
  const prismaClient = opts.prisma ?? (prismaAdmin as unknown as CrawlerPrisma);

  const errors: string[] = [];

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: buildSystemPrompt(input.language ?? 'en'),
      messages: [
        { role: 'user', content: buildIntelPrompt(input) },
      ],
      // Cast pattern from `src/app/api/budgeting/ai-analytics/route.ts:129`
      // — SDK 0.90.0 doesn't yet expose a typed entry for this server
      // tool but accepts the literal shape at runtime.
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: WEB_SEARCH_MAX_USES,
        } as unknown as Anthropic.Messages.Tool,
      ],
    });
  } catch (err) {
    return {
      itemsFetched: 0,
      itemsCreated: 0,
      itemsSkipped: 0,
      errors: [
        `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
      promptVersion: INTEL_PROMPT_VERSION,
      modelName: model,
    };
  }

  if (response.stop_reason === 'max_tokens') {
    errors.push(
      `Response truncated at max_tokens=${maxTokens} — feed may be incomplete`,
    );
  }

  // Extract text blocks. The web_search tool resolves server-side, so
  // the final text block contains the assistant's JSON response.
  const textBlocks = response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text);

  if (textBlocks.length === 0) {
    return {
      itemsFetched: 0,
      itemsCreated: 0,
      itemsSkipped: 0,
      errors: [
        ...errors,
        `LLM response had no text blocks (got: ${JSON.stringify(response.content.map((b) => b.type))})`,
      ],
      promptVersion: INTEL_PROMPT_VERSION,
      modelName: response.model ?? model,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }
        : undefined,
    };
  }

  const raw = textBlocks.join('\n').trim();
  const jsonText = extractJsonFromText(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      itemsFetched: 0,
      itemsCreated: 0,
      itemsSkipped: 0,
      errors: [
        ...errors,
        `JSON parse failed: ${err instanceof Error ? err.message : String(err)}. Raw head: ${raw.slice(0, 200)}`,
      ],
      promptVersion: INTEL_PROMPT_VERSION,
      modelName: response.model ?? model,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }
        : undefined,
    };
  }

  let validated: ValidatedItem[];
  try {
    validated = parseAndValidate(parsed);
  } catch (err) {
    return {
      itemsFetched: 0,
      itemsCreated: 0,
      itemsSkipped: 0,
      errors: [
        ...errors,
        `Schema validation failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
      promptVersion: INTEL_PROMPT_VERSION,
      modelName: response.model ?? model,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }
        : undefined,
    };
  }

  // Phase 7.M Tier2 #1 (2026-05-19) — deterministic companyTags inference.
  // LLM-emitted companyTags[] turned out to be empty on 100% of audited
  // rows. We supplement by scanning each item's title+summary for known
  // entity name patterns (Latin / Azerbaijani / Cyrillic, transliter-
  // ation-aware). Merged with whatever the LLM did emit. Tests that
  // don't inject `prisma.company` skip this step gracefully.
  if (prismaClient.company && validated.length > 0) {
    try {
      const companies = await prismaClient.company.findMany({
        where: {
          organizationId: input.organizationId,
          isActive: true,
        },
        select: {
          code: true,
          name: true,
          nameAz: true,
          nameRu: true,
          nameEn: true,
        },
      });
      const patterns = buildEntityPatternsFromCompanies(companies);
      if (patterns.length > 0) {
        validated = validated.map((it) => {
          const text = `${it.title} ${it.summary}`;
          const inferred = inferCompanyTags(text, patterns);
          if (inferred.length === 0) return it;
          return { ...it, companyTags: mergeCompanyTags(it.companyTags, inferred) };
        });
      }
    } catch (err) {
      // Inference is best-effort; a DB blip shouldn't fail the crawl.
      errors.push(
        `companyTags inference skipped (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  // Persist. Per-item try/catch — one DB failure shouldn't abort the
  // run. P2002 unique-constraint hits the `(organizationId, urlHash)`
  // dedup index → `itemsSkipped++`, no error. Anything else is logged
  // to `errors[]` and we continue.
  let itemsCreated = 0;
  let itemsSkipped = 0;
  // Phase 7.H Feature B — track newly-created rows so we can batch-score
  // their sentiment after the persist loop. Skipped (P2002 dedup) rows
  // are NOT re-scored — they already exist with prior score.
  const justCreated: Array<{
    id: string;
    title: string;
    summary: string;
    companyTags: string[];
    industryTags: string[];
  }> = [];
  for (const item of validated) {
    const hash = urlHash(item.url);
    try {
      const created = await prismaClient.intelItem.create({
        data: {
          organizationId: input.organizationId,
          title: item.title,
          summary: item.summary,
          url: item.url,
          urlHash: hash,
          sourceLabel: item.sourceLabel,
          relevanceScore: item.relevanceScore,
          industryTags: item.industryTags,
          companyTags: item.companyTags,
          publishedAt: item.publishedAt,
        },
      });
      itemsCreated++;
      justCreated.push({
        id: created.id,
        title: item.title,
        summary: item.summary,
        companyTags: item.companyTags,
        industryTags: item.industryTags,
      });
    } catch (err) {
      // Prisma error code surface — `P2002` = unique constraint hit
      // (our dedup case). Anything else = real write failure.
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code: unknown }).code
          : undefined;
      if (code === 'P2002') {
        itemsSkipped++;
      } else {
        errors.push(
          `Write failed for url=${item.url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Phase 7.H Feature B — sentiment scoring on freshly-created items.
  // One LLM batch call, then per-row updates. Failures here are non-
  // fatal — they show up in errors[] but the crawl result still ships.
  // Skipped when no new items OR caller explicitly opted out.
  const sentimentFn =
    opts.scoreSentimentBatch === false
      ? null
      : (opts.scoreSentimentBatch ?? runSentimentBatch);
  if (sentimentFn && justCreated.length > 0) {
    try {
      const result = await sentimentFn(justCreated);
      for (const [id, score] of result.scores) {
        try {
          await prismaClient.intelItem.update({
            where: { id },
            data: { sentimentScore: score },
          });
        } catch (err) {
          errors.push(
            `Sentiment write failed for id=${id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      errors.push(
        `Sentiment batch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    itemsFetched: validated.length,
    itemsCreated,
    itemsSkipped,
    errors,
    promptVersion: INTEL_PROMPT_VERSION,
    modelName: response.model ?? model,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        }
      : undefined,
  };
}
