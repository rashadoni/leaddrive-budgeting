/**
 * Phase 7.G Turn G — `localizeAlertMessageParams` unit tests.
 *
 * Locks the fail-safe contract:
 *   - Missing `industry` key → pass-through
 *   - Non-string `industry` → pass-through (defensive)
 *   - Unknown industry code → pass-through (no blank substitution)
 *   - Known code → replaced with translator's localized output
 *   - Other params untouched
 *   - Original params not mutated
 *
 * Closes CARRYOVER L135 — see `alert-message-i18n.ts` for context.
 */

import { describe, it, expect } from 'vitest';
import {
  localizeAlertMessageParams,
  type IndustryTranslator,
} from './alert-message-i18n';

/**
 * Build a mock translator from a plain code→label map. `has()` is
 * derived from key presence; the function call returns the mapped
 * value. Calling on a missing key throws — same contract next-intl
 * uses (callers MUST guard with `.has()` first).
 */
function mockTranslator(map: Record<string, string>): IndustryTranslator {
  const fn = ((key: string) => {
    if (!(key in map)) {
      throw new Error(`mockTranslator: missing key '${key}'`);
    }
    return map[key];
  }) as IndustryTranslator;
  fn.has = (key: string) => key in map;
  return fn;
}

describe('localizeAlertMessageParams', () => {
  it('replaces known industry code with translator value', () => {
    const t = mockTranslator({ industrial: 'промышленность' });
    const out = localizeAlertMessageParams(
      { industry: 'industrial', amberCount: 12, companyCount: 4 },
      t,
    );
    expect(out).toEqual({
      industry: 'промышленность',
      amberCount: 12,
      companyCount: 4,
    });
  });

  it('passes through unchanged when params has no industry key', () => {
    const t = mockTranslator({ industrial: 'промышленность' });
    const params = { code: 'AAC-MAIN', redCount: 7 };
    const out = localizeAlertMessageParams(params, t);
    expect(out).toEqual({ code: 'AAC-MAIN', redCount: 7 });
  });

  it('passes through when industry is non-string (defensive)', () => {
    const t = mockTranslator({ industrial: 'промышленность' });
    // Cast through unknown — type system would normally prevent this, but
    // the runtime guard is the safety net for upstream type erosion.
    const params = { industry: 12 as unknown as string, otherKey: 'x' };
    const out = localizeAlertMessageParams(
      params as Record<string, string | number>,
      t,
    );
    expect(out.industry).toBe(12);
  });

  it('passes through when industry code is not in translator (unknown code)', () => {
    const t = mockTranslator({ industrial: 'промышленность' });
    const out = localizeAlertMessageParams(
      { industry: 'spaceflight', companyCount: 1 },
      t,
    );
    // Pass-through: the unknown code stays raw rather than substituting
    // with an empty string (which would make the message read
    // "Сектор : ..." with a visible double-space).
    expect(out.industry).toBe('spaceflight');
    expect(out.companyCount).toBe(1);
  });

  it('does not mutate the input params object', () => {
    const t = mockTranslator({ agro: 'агропром' });
    const params = { industry: 'agro', amberCount: 5, companyCount: 2 };
    const before = { ...params };
    localizeAlertMessageParams(params, t);
    expect(params).toEqual(before);
  });

  it('handles all 14 canonical codes without surprises', () => {
    const allCodes = [
      'agro',
      'beverage',
      'construction',
      'education',
      'entertainment',
      'food_processing',
      'hospitality',
      'industrial',
      'logistics',
      'pharma',
      'poultry',
      'real_estate',
      'retail',
      'services',
    ];
    const t = mockTranslator(
      Object.fromEntries(allCodes.map((c) => [c, `RU-${c}`])),
    );
    for (const code of allCodes) {
      const out = localizeAlertMessageParams(
        { industry: code, amberCount: 0, companyCount: 0 },
        t,
      );
      expect(out.industry).toBe(`RU-${code}`);
    }
  });

  it('preserves number-typed params alongside the substituted industry', () => {
    const t = mockTranslator({ pharma: 'фармацевтика' });
    const out = localizeAlertMessageParams(
      { industry: 'pharma', redCount: 9, companyCount: 3 },
      t,
    );
    expect(typeof out.redCount).toBe('number');
    expect(out.redCount).toBe(9);
    expect(typeof out.companyCount).toBe('number');
  });

  it('falls back gracefully when translator lacks .has (test-mock shape)', () => {
    // Models the vitest.setup.ts mock: a plain function, no `.has` method.
    // The helper should still localize when the call returns a usable
    // string, OR pass through silently if the call throws.
    const plainFn = ((key: string) => `RU-${key}`) as unknown as IndustryTranslator;
    // No `.has` property assigned — the helper takes the fallback branch.
    const out = localizeAlertMessageParams({ industry: 'industrial' }, plainFn);
    expect(out.industry).toBe('RU-industrial');
  });

  it('passes through when translator without .has throws on call', () => {
    const throwingFn = (() => {
      throw new Error('next-intl missing key');
    }) as unknown as IndustryTranslator;
    const out = localizeAlertMessageParams(
      { industry: 'unknown_code', companyCount: 1 },
      throwingFn,
    );
    expect(out.industry).toBe('unknown_code');
    expect(out.companyCount).toBe(1);
  });

  it('passes through when translator without .has returns empty string', () => {
    // Edge case: some translation libs return empty for missing keys.
    // We treat that as "missing" rather than substituting an empty
    // string into the message body.
    const emptyFn = (() => '') as unknown as IndustryTranslator;
    const out = localizeAlertMessageParams(
      { industry: 'industrial', companyCount: 2 },
      emptyFn,
    );
    expect(out.industry).toBe('industrial');
  });
});
