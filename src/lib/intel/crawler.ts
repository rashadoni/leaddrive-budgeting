/**
 * Phase 7.G Turn XLII (Phase D.1) — AI Web Crawler orchestrator skeleton.
 *
 * **Phase D.1 scope (this turn):** function signature + types + dedup
 * helper + URL-hash util. Real Anthropic `web_search_20250305` call
 * lands in Phase D.2 (separate turn) so the prompt design can be done
 * with care + LLM cost can be reasoned about without bundling it into
 * a foundation commit.
 *
 * **Phase D.2 will add:**
 *   - Anthropic SDK call with `web_search_20250305` tool, prompt
 *     including org's industries + active company codes.
 *   - Tool-use loop: search → parse results → score relevance via
 *     follow-up LLM call → write IntelItems.
 *   - Per-org rate limit (BullMQ-scheduled at 1×/day, on-demand
 *     `?refresh=true` capped 1×/hour).
 *
 * This file STAYS pure — no Anthropic import, no Prisma write — until
 * Phase D.2. Caller in Phase D.2 will compose `runIntelCrawl()` from
 * the helpers exported here + the LLM call.
 */

import { createHash } from 'node:crypto';
import type { IntelCrawlInput, IntelCrawlResult } from './types';

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
    const sortedSearch = Array.from(u.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    u.search = sortedSearch ? `?${sortedSearch}` : '';
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

/**
 * Phase D.1 stub. Returns an empty `IntelCrawlResult` without touching
 * Anthropic or Prisma. Phase D.2 swaps in the real implementation.
 *
 * The signature is locked NOW so the API route + BullMQ worker (Phase
 * D.2-D.5) can wire to it without churn at swap time.
 */
export async function runIntelCrawl(
  _input: IntelCrawlInput,
): Promise<IntelCrawlResult> {
  return {
    itemsFetched: 0,
    itemsCreated: 0,
    itemsSkipped: 0,
    errors: ['Phase D.2 not yet shipped — runIntelCrawl is a stub'],
  };
}
