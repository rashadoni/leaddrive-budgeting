import { describe, it, expect } from 'vitest';
import { formatFreshness } from './relative-time';

// Fixed reference instant so the assertions stay deterministic (the function
// is pure — nowMs is injected). iso values are derived relative to it.
const NOW = 1_700_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('formatFreshness', () => {
  it('returns null for empty / null / undefined iso', () => {
    expect(formatFreshness(null, NOW)).toBeNull();
    expect(formatFreshness(undefined, NOW)).toBeNull();
    expect(formatFreshness('', NOW)).toBeNull();
  });

  it('returns null for an unparseable iso', () => {
    expect(formatFreshness('not-a-date', NOW)).toBeNull();
  });

  it('formats sub-minute as "just now" / "now", not stale', () => {
    expect(formatFreshness(iso(5_000), NOW)).toEqual({
      label: 'just now',
      short: 'now',
      isStale: false,
    });
  });

  it('formats minutes', () => {
    expect(formatFreshness(iso(5 * 60_000), NOW)).toEqual({
      label: '5m ago',
      short: '5m',
      isStale: false,
    });
  });

  it('formats hours', () => {
    expect(formatFreshness(iso(2 * 3_600_000), NOW)).toEqual({
      label: '2h ago',
      short: '2h',
      isStale: false,
    });
  });

  it('formats days and flips isStale strictly after 24h', () => {
    // Exactly 24h → "1d ago" but NOT yet stale (matches FreshnessLabel: > 86400).
    expect(formatFreshness(iso(86_400_000), NOW)).toEqual({
      label: '1d ago',
      short: '1d',
      isStale: false,
    });
    // 3 days → stale.
    expect(formatFreshness(iso(3 * 86_400_000), NOW)).toEqual({
      label: '3d ago',
      short: '3d',
      isStale: true,
    });
  });

  it('clamps a future timestamp to "just now" (never negative)', () => {
    expect(formatFreshness(iso(-10_000), NOW)).toEqual({
      label: 'just now',
      short: 'now',
      isStale: false,
    });
  });
});
