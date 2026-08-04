/**
 * Phase 7.G Turn XLIII (Phase D.2) — crawler unit tests.
 *
 * Phase D.1 covered urlHash + the stub. Phase D.2 swaps the stub for a
 * real implementation. Tests now exercise:
 *   - prompt shape (industries + companyCodes literals included)
 *   - short-circuit on empty input (no LLM, no DB)
 *   - happy path (parse → write → counters)
 *   - dedup (P2002 → itemsSkipped++)
 *   - per-item write failure → errors[] entry, run continues
 *   - max_tokens stop_reason → errors[] entry
 *   - malformed JSON → errors[]
 *   - bad URL inside an item → dropped before hashing
 *   - LLM call failure (network throw) → errors[] populated
 *   - usage + modelName populated when SDK envelope returns them
 *
 * Anthropic SDK + Prisma both injected via `RunIntelCrawlOptions` test
 * seam — no `vi.mock("@/lib/prisma")` needed for this unit test (the
 * route handler test mocks at module level).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/ai/client', () => ({
  AI_MODEL: 'mock-model',
  getAnthropicClient: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { intelItem: { create: vi.fn(), update: vi.fn() } },
}));

import {
  runIntelCrawl,
  urlHash,
  buildIntelPrompt,
  buildSystemPrompt,
  INTEL_PROMPT_VERSION,
} from './crawler';
import type { IntelCrawlInput } from './types';

// ---------------------------------------------------------------------------
// urlHash (Phase D.1 — preserved)
// ---------------------------------------------------------------------------

describe('urlHash (Phase D.1 dedup helper)', () => {
  it('returns stable sha256 hex for the same URL', () => {
    const a = urlHash('https://example.com/article-1');
    const b = urlHash('https://example.com/article-1');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalises trailing slash', () => {
    expect(urlHash('https://example.com/article-1/')).toBe(
      urlHash('https://example.com/article-1'),
    );
  });

  it('normalises case (host + path)', () => {
    expect(urlHash('HTTPS://EXAMPLE.COM/Article-1')).toBe(
      urlHash('https://example.com/article-1'),
    );
  });

  it('strips fragment (#section)', () => {
    expect(urlHash('https://example.com/article-1#summary')).toBe(
      urlHash('https://example.com/article-1'),
    );
  });

  it('sorts query params for stable hashing', () => {
    expect(urlHash('https://example.com/x?b=2&a=1')).toBe(
      urlHash('https://example.com/x?a=1&b=2'),
    );
  });

  it('produces DIFFERENT hashes for different URLs', () => {
    expect(urlHash('https://example.com/a')).not.toBe(
      urlHash('https://example.com/b'),
    );
  });

  it('handles malformed URL gracefully (fail-soft)', () => {
    const h = urlHash('not a real url');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// buildIntelPrompt — pure helper
// ---------------------------------------------------------------------------

describe('buildIntelPrompt (Phase D.2)', () => {
  it('lists every industry verbatim in the prompt', () => {
    const prompt = buildIntelPrompt({
      organizationId: 'org_1',
      industries: ['industrial', 'hospitality', 'agro'],
      companyCodes: [],
    });
    expect(prompt).toContain('industrial, hospitality, agro');
    expect(prompt).toContain('(none listed)');
  });

  it('lists every company code verbatim', () => {
    const prompt = buildIntelPrompt({
      organizationId: 'org_1',
      industries: ['industrial'],
      companyCodes: ['AAC', 'ATL', 'ZTP'],
    });
    expect(prompt).toContain('Active company codes: AAC, ATL, ZTP');
  });

  it('renders the empty-industries fallback line', () => {
    const prompt = buildIntelPrompt({
      organizationId: 'org_1',
      industries: [],
      companyCodes: ['AAC'],
    });
    expect(prompt).toContain('(none listed — return empty feed)');
  });
});

// Phase 7.G Turn LXXXXIII (D.5c) — language-aware system prompt
/** Recency is enforced at ingest, so fixtures date themselves relative to the
 *  run. Absolute dates here aged past the cap and broke the happy path. */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('buildSystemPrompt (D.5c — language pipe-through)', () => {
  it('default (no arg) → English instruction', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('IN ENGLISH');
    expect(p).not.toContain('IN RUSSIAN');
    expect(p).not.toContain('IN AZERBAIJANI');
  });

  it('language="en" → English instruction', () => {
    expect(buildSystemPrompt('en')).toContain('IN ENGLISH');
  });

  // 2026-08-04 — companyTags used to appear only in the schema block, with no
  // rule for when to fill it. Production showed the result: 8 of 12 items with
  // no company tag and the rest tagged with the holding code, so most of the
  // feed could not move any risk score. These assertions pin the intent, not
  // the wording of any one sentence.
  it('tells the model how to fill companyTags, in every language', () => {
    for (const lang of ['en', 'ru', 'az'] as const) {
      const p = buildSystemPrompt(lang);
      // Only real codes, exactly as supplied.
      expect(p).toContain('Active company codes');
      expect(p).toMatch(/Never invent a code/i);
      // Specificity beats the parent.
      expect(p).toMatch(/MOST SPECIFIC/i);
      // An empty array is a valid, correct answer.
      expect(p).toMatch(/Leave the array EMPTY/i);
    }
  });

  it('language="ru" → Russian instruction (preserves company names)', () => {
    const p = buildSystemPrompt('ru');
    expect(p).toContain('IN RUSSIAN');
    expect(p).toContain('preserve company names');
    expect(p).not.toContain('IN ENGLISH');
  });

  it('language="az" → Azerbaijani instruction (preserves company names)', () => {
    const p = buildSystemPrompt('az');
    expect(p).toContain('IN AZERBAIJANI');
    expect(p).toContain('preserve company names');
    expect(p).not.toContain('IN ENGLISH');
  });

  // 2026-08-04 — the prompt has asked for "last 7 days" since v1; production
  // returned articles published across four months. Recency is now stated as a
  // hard filter AND enforced at ingest, because a stale item is read as a
  // current signal by the rolling sentiment window.
  it('states recency as a hard filter, in every language', () => {
    for (const lang of ['en', 'ru', 'az'] as const) {
      const p = buildSystemPrompt(lang);
      expect(p).toMatch(/RECENCY IS A HARD FILTER/i);
      expect(p).toMatch(/last 7 days/i);
    }
  });

  it('common scaffolding (web_search, ≤200 chars, JSON-only) shared across all languages', () => {
    for (const lang of ['en', 'ru', 'az'] as const) {
      const p = buildSystemPrompt(lang);
      expect(p).toContain('web_search');
      expect(p).toContain('≤200 char');
      expect(p).toContain('JSON-only');
      expect(p).toContain('relevanceScore');
    }
  });

  it('runIntelCrawl passes input.language through to messages.create system field', async () => {
    let capturedSystem: string | null = null;
    const client = {
      messages: {
        create: vi.fn(async (args: { system: string }) => {
          capturedSystem = args.system;
          return fakeResponse('{"items": []}');
        }),
      },
    } as unknown as ReturnType<typeof import('@/lib/ai/client').getAnthropicClient>;
    await runIntelCrawl(
      { ...BASE_INPUT, language: 'ru' },
      { client, prisma: makePrisma() },
    );
    expect(capturedSystem).toContain('IN RUSSIAN');
  });

  it('runIntelCrawl defaults to English when language unset', async () => {
    let capturedSystem: string | null = null;
    const client = {
      messages: {
        create: vi.fn(async (args: { system: string }) => {
          capturedSystem = args.system;
          return fakeResponse('{"items": []}');
        }),
      },
    } as unknown as ReturnType<typeof import('@/lib/ai/client').getAnthropicClient>;
    await runIntelCrawl(BASE_INPUT, { client, prisma: makePrisma(), scoreSentimentBatch: false });
    expect(capturedSystem).toContain('IN ENGLISH');
  });
});

// ---------------------------------------------------------------------------
// runIntelCrawl — real implementation
// ---------------------------------------------------------------------------

interface FakeMessage {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

function fakeResponse(
  text: string,
  overrides: Partial<FakeMessage> = {},
): FakeMessage {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    model: 'claude-sonnet-4-5-20250929',
    usage: { input_tokens: 1000, output_tokens: 500 },
    ...overrides,
  };
}

function makeClient(response: FakeMessage | (() => Promise<FakeMessage>)) {
  const create =
    typeof response === 'function'
      ? vi.fn(response)
      : vi.fn().mockResolvedValue(response);
  return {
    messages: { create },
    // Other SDK methods aren't reached; cast cleanly.
  } as unknown as ReturnType<typeof import('@/lib/ai/client').getAnthropicClient>;
}

function makePrisma() {
  return {
    intelItem: {
      create: vi.fn().mockResolvedValue({ id: 'intel_1' }),
      update: vi.fn().mockResolvedValue({ id: 'intel_1' }),
    },
  };
}

const BASE_INPUT: IntelCrawlInput = {
  organizationId: 'org_demo',
  industries: ['industrial', 'hospitality'],
  companyCodes: ['AAC', 'HLTN'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runIntelCrawl — short-circuit', () => {
  it('returns zero counters and skips LLM when both arrays are empty', async () => {
    const client = makeClient(fakeResponse('{"items":[]}'));
    const prismaStub = makePrisma();
    const result = await runIntelCrawl(
      { organizationId: 'org_1', industries: [], companyCodes: [] },
      { client, prisma: prismaStub },
    );
    expect(result.itemsFetched).toBe(0);
    expect(result.itemsCreated).toBe(0);
    expect(result.itemsSkipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.promptVersion).toBe(INTEL_PROMPT_VERSION);
    expect(client.messages.create).not.toHaveBeenCalled();
    expect(prismaStub.intelItem.create).not.toHaveBeenCalled();
  });

  it('does NOT short-circuit when industries is empty but companyCodes is not', async () => {
    const client = makeClient(fakeResponse('{"items":[]}'));
    const prismaStub = makePrisma();
    await runIntelCrawl(
      {
        organizationId: 'org_1',
        industries: [],
        companyCodes: ['AAC'],
      },
      { client, prisma: prismaStub },
    );
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});

describe('runIntelCrawl — happy path', () => {
  it('writes 3 items + populates counters + usage + modelName', async () => {
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'Cocoa supply tightens',
          summary: 'Ghana export cuts squeeze global cocoa supply.',
          url: 'https://reuters.com/cocoa-supply-2026',
          sourceLabel: 'Reuters',
          publishedAt: daysAgoIso(3),
          relevanceScore: 0.85,
          industryTags: ['agro'],
          companyTags: [],
        },
        {
          title: 'Baku hotel occupancy up',
          summary: 'Q1 occupancy +12% vs prior year for premium tier.',
          url: 'https://example.com/baku-hotels',
          sourceLabel: 'Local outlet',
          publishedAt: null,
          relevanceScore: 0.72,
          industryTags: ['hospitality'],
          companyTags: ['HLTN'],
        },
        {
          title: 'AAC named in steel-tariff brief',
          summary: 'Industrial corridor exempted; AAC listed beneficiary.',
          url: 'https://bloomberg.com/steel-tariff-2026',
          sourceLabel: 'Bloomberg',
          publishedAt: daysAgoIso(1),
          relevanceScore: 0.93,
          industryTags: ['industrial'],
          companyTags: ['AAC'],
        },
      ],
    });
    const client = makeClient(fakeResponse(llmJson));
    const prismaStub = makePrisma();

    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });

    expect(result.itemsFetched).toBe(3);
    expect(result.itemsCreated).toBe(3);
    expect(result.itemsSkipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.modelName).toBe('claude-sonnet-4-5-20250929');
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
    expect(result.promptVersion).toBe(INTEL_PROMPT_VERSION);
    expect(prismaStub.intelItem.create).toHaveBeenCalledTimes(3);

    const firstCall = prismaStub.intelItem.create.mock.calls[0][0];
    expect(firstCall.data.organizationId).toBe('org_demo');
    expect(firstCall.data.url).toBe('https://reuters.com/cocoa-supply-2026');
    expect(firstCall.data.urlHash).toMatch(/^[0-9a-f]{64}$/);
    expect(firstCall.data.industryTags).toEqual(['agro']);
  });

  it('caps at 10 items even if LLM returns more', async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      title: `Item ${i}`,
      summary: `Summary ${i}`,
      url: `https://example.com/item-${i}`,
      sourceLabel: 'Test',
      publishedAt: null,
      relevanceScore: 0.5,
      industryTags: [],
      companyTags: [],
    }));
    const client = makeClient(fakeResponse(JSON.stringify({ items })));
    const prismaStub = makePrisma();

    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });

    expect(result.itemsFetched).toBe(10);
    expect(result.itemsCreated).toBe(10);
    expect(prismaStub.intelItem.create).toHaveBeenCalledTimes(10);
  });
});

describe('runIntelCrawl — dedup + per-item failure', () => {
  it('increments itemsSkipped on P2002 unique-constraint hit', async () => {
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'A',
          summary: 'a',
          url: 'https://x.com/a',
          sourceLabel: 'X',
          relevanceScore: 0.5,
          industryTags: [],
          companyTags: [],
        },
        {
          title: 'B',
          summary: 'b',
          url: 'https://x.com/b',
          sourceLabel: 'X',
          relevanceScore: 0.5,
          industryTags: [],
          companyTags: [],
        },
      ],
    });
    const client = makeClient(fakeResponse(llmJson));
    const prismaStub = makePrisma();
    prismaStub.intelItem.create
      .mockResolvedValueOnce({ id: 'created' })
      // Second item is a duplicate → P2002.
      .mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));

    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });

    expect(result.itemsFetched).toBe(2);
    expect(result.itemsCreated).toBe(1);
    expect(result.itemsSkipped).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('continues run + records errors[] when a non-P2002 write fails', async () => {
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'A',
          summary: 'a',
          url: 'https://x.com/a',
          sourceLabel: 'X',
          relevanceScore: 0.5,
          industryTags: [],
          companyTags: [],
        },
        {
          title: 'B',
          summary: 'b',
          url: 'https://x.com/b',
          sourceLabel: 'X',
          relevanceScore: 0.5,
          industryTags: [],
          companyTags: [],
        },
      ],
    });
    const client = makeClient(fakeResponse(llmJson));
    const prismaStub = makePrisma();
    prismaStub.intelItem.create
      .mockRejectedValueOnce(new Error('connection terminated'))
      .mockResolvedValueOnce({ id: 'ok' });

    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });

    expect(result.itemsFetched).toBe(2);
    expect(result.itemsCreated).toBe(1);
    expect(result.itemsSkipped).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Write failed for url=https:\/\/x\.com\/a/);
  });
});

describe('runIntelCrawl — bad item filtering', () => {
  it('drops items with malformed URLs BEFORE hashing', async () => {
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'Bad URL',
          summary: 'b',
          url: 'not-a-url',
          sourceLabel: 'X',
          relevanceScore: 0.5,
          industryTags: [],
          companyTags: [],
        },
        {
          title: 'Good',
          summary: 'g',
          url: 'https://x.com/good',
          sourceLabel: 'X',
          relevanceScore: 0.5,
          industryTags: [],
          companyTags: [],
        },
      ],
    });
    const client = makeClient(fakeResponse(llmJson));
    const prismaStub = makePrisma();
    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });
    expect(result.itemsFetched).toBe(1);
    expect(result.itemsCreated).toBe(1);
    expect(prismaStub.intelItem.create).toHaveBeenCalledTimes(1);
    expect(prismaStub.intelItem.create.mock.calls[0][0].data.url).toBe(
      'https://x.com/good',
    );
  });

  it('drops items with relevanceScore out of [0, 1]', async () => {
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'Too high',
          summary: 's',
          url: 'https://x.com/h',
          sourceLabel: 'X',
          relevanceScore: 1.5,
          industryTags: [],
          companyTags: [],
        },
        {
          title: 'Negative',
          summary: 's',
          url: 'https://x.com/n',
          sourceLabel: 'X',
          relevanceScore: -0.1,
          industryTags: [],
          companyTags: [],
        },
        {
          title: 'OK',
          summary: 's',
          url: 'https://x.com/ok',
          sourceLabel: 'X',
          relevanceScore: 0.7,
          industryTags: [],
          companyTags: [],
        },
      ],
    });
    const client = makeClient(fakeResponse(llmJson));
    const prismaStub = makePrisma();
    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });
    expect(result.itemsFetched).toBe(1);
    expect(result.itemsCreated).toBe(1);
  });

  it('truncates summary to ≤200 chars', async () => {
    const longSummary = 'x'.repeat(300);
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'A',
          summary: longSummary,
          url: 'https://x.com/a',
          sourceLabel: 'X',
          relevanceScore: 0.5,
          industryTags: [],
          companyTags: [],
        },
      ],
    });
    const client = makeClient(fakeResponse(llmJson));
    const prismaStub = makePrisma();
    await runIntelCrawl(BASE_INPUT, { client, prisma: prismaStub, scoreSentimentBatch: false });
    const writtenSummary =
      prismaStub.intelItem.create.mock.calls[0][0].data.summary;
    expect(writtenSummary.length).toBe(200);
  });
});

describe('runIntelCrawl — LLM-side failures (errors[])', () => {
  it('records errors[] entry when stop_reason is max_tokens', async () => {
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'A',
          summary: 'a',
          url: 'https://x.com/a',
          sourceLabel: 'X',
          relevanceScore: 0.5,
          industryTags: [],
          companyTags: [],
        },
      ],
    });
    const client = makeClient(
      fakeResponse(llmJson, { stop_reason: 'max_tokens' }),
    );
    const prismaStub = makePrisma();
    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });
    // Items still parsed + written — the truncation warning is purely
    // surfaced via errors[] so the operator sees the feed may be partial.
    expect(result.itemsCreated).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/max_tokens/);
  });

  it('records errors[] entry when JSON parse fails', async () => {
    const client = makeClient(fakeResponse('this is not json at all'));
    const prismaStub = makePrisma();
    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });
    expect(result.itemsFetched).toBe(0);
    expect(result.itemsCreated).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/JSON parse failed/);
    expect(prismaStub.intelItem.create).not.toHaveBeenCalled();
  });

  it('records errors[] entry when response is missing items array', async () => {
    const client = makeClient(fakeResponse('{"foo":"bar"}'));
    const prismaStub = makePrisma();
    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });
    expect(result.itemsFetched).toBe(0);
    expect(result.errors[0]).toMatch(/missing 'items' array/);
  });

  it('records errors[] entry when LLM call throws (network)', async () => {
    const client = makeClient(async () => {
      throw new Error('ECONNRESET');
    });
    const prismaStub = makePrisma();
    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });
    expect(result.itemsFetched).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/LLM call failed.*ECONNRESET/);
    expect(prismaStub.intelItem.create).not.toHaveBeenCalled();
  });

  it('handles response with zero text blocks', async () => {
    // Server returns no text content (e.g. only tool_use blocks).
    const client = makeClient({
      content: [],
      stop_reason: 'end_turn',
      model: 'mock',
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    const prismaStub = makePrisma();
    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: false,
    });
    expect(result.itemsFetched).toBe(0);
    expect(result.errors[0]).toMatch(/no text blocks/);
  });
});

describe('runIntelCrawl — Phase 7.H Feature B sentiment scoring', () => {
  it('calls scoreSentimentBatch with newly-created items when option is omitted (production default)', async () => {
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'AAC margins under pressure',
          summary: 'Cocoa supplier shortage',
          url: 'https://x.com/a',
          sourceLabel: 'X',
          relevanceScore: 0.7,
          industryTags: ['food'],
          companyTags: ['AAC'],
        },
        {
          title: 'AZN strengthens',
          summary: 'Currency tailwind',
          url: 'https://x.com/b',
          sourceLabel: 'X',
          relevanceScore: 0.6,
          industryTags: [],
          companyTags: [],
        },
      ],
    });
    const client = makeClient(fakeResponse(llmJson));
    const prismaStub = makePrisma();
    prismaStub.intelItem.create
      .mockResolvedValueOnce({ id: 'intel_a' })
      .mockResolvedValueOnce({ id: 'intel_b' });

    const sentimentSpy = vi.fn().mockResolvedValue({
      scores: new Map([
        ['intel_a', -0.6],
        ['intel_b', 0.3],
      ]),
      usage: { inputTokens: 100, outputTokens: 30 },
    });

    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: sentimentSpy,
    });

    expect(result.itemsCreated).toBe(2);
    expect(result.errors).toEqual([]);
    expect(sentimentSpy).toHaveBeenCalledTimes(1);
    const sentimentArg = sentimentSpy.mock.calls[0][0];
    expect(sentimentArg).toHaveLength(2);
    expect(sentimentArg[0]).toMatchObject({
      id: 'intel_a',
      title: 'AAC margins under pressure',
      companyTags: ['AAC'],
    });
    expect(prismaStub.intelItem.update).toHaveBeenCalledTimes(2);
    expect(prismaStub.intelItem.update).toHaveBeenCalledWith({
      where: { id: 'intel_a' },
      data: { sentimentScore: -0.6 },
    });
  });

  it('does not call sentiment when zero items were created', async () => {
    const llmJson = JSON.stringify({ items: [] });
    const client = makeClient(fakeResponse(llmJson));
    const prismaStub = makePrisma();
    const sentimentSpy = vi.fn();
    await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: sentimentSpy,
    });
    expect(sentimentSpy).not.toHaveBeenCalled();
  });

  it('records errors[] entry but still returns counters when sentiment batch throws', async () => {
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'A',
          summary: 'a',
          url: 'https://x.com/a',
          sourceLabel: 'X',
          relevanceScore: 0.5,
          industryTags: [],
          companyTags: [],
        },
      ],
    });
    const client = makeClient(fakeResponse(llmJson));
    const prismaStub = makePrisma();
    const sentimentSpy = vi
      .fn()
      .mockRejectedValue(new Error('LLM rate-limited'));
    const result = await runIntelCrawl(BASE_INPUT, {
      client,
      prisma: prismaStub,
      scoreSentimentBatch: sentimentSpy,
    });
    expect(result.itemsCreated).toBe(1);
    expect(result.errors[0]).toMatch(/Sentiment batch failed.*rate-limited/);
  });
});

// ---------------------------------------------------------------------------
// Recency backstop at ingest (2026-08-04)
// ---------------------------------------------------------------------------

describe('runIntelCrawl — recency backstop', () => {
  it('drops items published past the cap and reports how many', async () => {
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'Fresh sugar policy move',
          summary: 'Recent.',
          url: 'https://example.com/fresh',
          sourceLabel: 'Outlet',
          publishedAt: daysAgoIso(2),
          relevanceScore: 0.9,
          industryTags: ['agro'],
          companyTags: [],
        },
        {
          title: 'Spring article resurfaced by search',
          summary: 'Months old.',
          url: 'https://example.com/stale',
          sourceLabel: 'Outlet',
          publishedAt: daysAgoIso(120),
          relevanceScore: 0.95,
          industryTags: ['agro'],
          companyTags: [],
        },
      ],
    });
    const res = await runIntelCrawl(BASE_INPUT, {
      client: makeClient(fakeResponse(llmJson)),
      prisma: makePrisma(),
    });

    // Two items in, one survives, and the drop is counted rather than silent.
    expect(res.itemsFetched).toBe(1);
    expect(res.itemsStale).toBe(1);
  });

  it('keeps items whose source exposed no publish date', async () => {
    const llmJson = JSON.stringify({
      items: [
        {
          title: 'No date available',
          summary: 'Source did not expose one.',
          url: 'https://example.com/undated',
          sourceLabel: 'Outlet',
          publishedAt: null,
          relevanceScore: 0.8,
          industryTags: ['agro'],
          companyTags: [],
        },
      ],
    });
    const res = await runIntelCrawl(BASE_INPUT, {
      client: makeClient(fakeResponse(llmJson)),
      prisma: makePrisma(),
    });

    expect(res.itemsFetched).toBe(1);
    expect(res.itemsStale).toBe(0);
  });
});
