import { describe, it, expect } from 'vitest';
import { formatFreshness } from './relative-time';
import { bucketRelativeAge } from '@/lib/format/relative-age';

// Fixed reference instant so the assertions stay deterministic (the function
// is pure — nowMs is injected). iso values are derived relative to it.
const NOW = 1_700_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

// 2026-08-04 — this file used to assert the English strings this module built
// ('5m ago' / '5m'). The wording moved to src/lib/format/relative-age.ts and
// is tested there against the real catalogues; what is left here is the
// terminal-specific part: the age it measures and where the amber line falls.
describe('formatFreshness', () => {
  it('returns null for empty / null / undefined iso', () => {
    expect(formatFreshness(null, NOW)).toBeNull();
    expect(formatFreshness(undefined, NOW)).toBeNull();
    expect(formatFreshness('', NOW)).toBeNull();
  });

  it('returns null for an unparseable iso', () => {
    expect(formatFreshness('not-a-date', NOW)).toBeNull();
  });

  it('measures sub-minute ages, not stale', () => {
    expect(formatFreshness(iso(5_000), NOW)).toEqual({
      ageMinutes: 5_000 / 60_000,
      isStale: false,
    });
  });

  it('measures minutes', () => {
    expect(formatFreshness(iso(5 * 60_000), NOW)).toEqual({
      ageMinutes: 5,
      isStale: false,
    });
  });

  it('measures hours', () => {
    expect(formatFreshness(iso(2 * 3_600_000), NOW)).toEqual({
      ageMinutes: 120,
      isStale: false,
    });
  });

  it('flips isStale strictly after 24h', () => {
    // Exactly 24h → still 1 day old, but NOT yet amber.
    expect(formatFreshness(iso(86_400_000), NOW)).toEqual({
      ageMinutes: 1440,
      isStale: false,
    });
    expect(formatFreshness(iso(86_460_000), NOW)).toEqual({
      ageMinutes: 1441,
      isStale: true,
    });
  });

  it('clamps a future timestamp to zero (never negative)', () => {
    expect(formatFreshness(iso(-10_000), NOW)).toEqual({
      ageMinutes: 0,
      isStale: false,
    });
  });

  it('hands the shared bucketer an age that lands in the expected bucket', () => {
    // The pairing the two terminal chips rely on — this module measures,
    // relative-age.ts words it. Pinned here so a change to either is caught.
    const cases: Array<[number, ReturnType<typeof bucketRelativeAge>]> = [
      [5_000, { bucket: 'justNow', n: 0 }],
      [5 * 60_000, { bucket: 'minutes', n: 5 }],
      [2 * 3_600_000, { bucket: 'hours', n: 2 }],
      [3 * 86_400_000, { bucket: 'days', n: 3 }],
    ];
    for (const [msAgo, want] of cases) {
      const parts = formatFreshness(iso(msAgo), NOW);
      expect(bucketRelativeAge(parts!.ageMinutes), `${msAgo}ms ago`).toEqual(want);
    }
  });
});
