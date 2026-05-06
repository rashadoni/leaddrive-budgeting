/**
 * Phase 7.G Turn XLII (Phase D.1) — crawler unit tests.
 *
 * Phase D.1 scope: urlHash dedup-contract + runIntelCrawl stub. The
 * actual Anthropic + Prisma write paths land in Phase D.2.
 */

import { describe, it, expect } from 'vitest';
import { runIntelCrawl, urlHash } from './crawler';

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
    // Not a panic — just hashes the raw string trimmed + lowercased.
    const h = urlHash('not a real url');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('runIntelCrawl (Phase D.1 stub)', () => {
  it('returns empty result with explicit "not yet shipped" error', async () => {
    const result = await runIntelCrawl({
      organizationId: 'org_1',
      industries: ['industrial'],
      companyCodes: ['AAC'],
    });
    expect(result.itemsFetched).toBe(0);
    expect(result.itemsCreated).toBe(0);
    expect(result.itemsSkipped).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Phase D\.2 not yet shipped/);
  });
});
