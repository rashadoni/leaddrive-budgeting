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

import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { extractJsonFromText } from '@/lib/onboarding/ai-mapper/json-extract';
import { prisma as defaultPrisma } from '@/lib/prisma';
import type { IntelCrawlInput, IntelCrawlResult, IntelOutputLanguage } from './types';

/** Bump on any change to SYSTEM_PROMPT or buildIntelPrompt structure.
 *  v1 = initial Phase D.2 ship.
 *  v2 = Phase 7.G Turn LXXXXIII (D.5c) — language parameter added. */
export const INTEL_PROMPT_VERSION = 'v2';

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
export function urlHash(rawUrl: string): string {
  let normalised: string;
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    // Sort query params for stable hashing.
    // Architect Turn-XLII Round-1 Проблема fix: `URL.search` setter
    // accepts both `?foo=bar` and `foo=bar` forms but normalises
    // inconsistently across Node versions; assigning the bare value
    // (no leading `?`) mirrors what `URLSearchParams.toString()`
    // produces and avoids a brittle double-`?` shape on some runtimes.
    const sortedSearch = Array.from(u.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    u.search = sortedSearch;
    normalised = u
      .toString()
      .toLowerCase()
      .replace(/\/$/, '');
  } catch {
    // Malformed URL — hash the raw string. Caller probably has a bug;
    // fail-soft so a single bad URL doesn't blow up the whole crawl.
    normalised = rawUrl.toLowerCase().trim();
  }
  return createHash('sha256').update(normalised).digest('hex');
}

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
  const prismaClient = opts.prisma ?? (defaultPrisma as unknown as CrawlerPrisma);

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

  // Persist. Per-item try/catch — one DB failure shouldn't abort the
  // run. P2002 unique-constraint hits the `(organizationId, urlHash)`
  // dedup index → `itemsSkipped++`, no error. Anything else is logged
  // to `errors[]` and we continue.
  let itemsCreated = 0;
  let itemsSkipped = 0;
  for (const item of validated) {
    const hash = urlHash(item.url);
    try {
      await prismaClient.intelItem.create({
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
