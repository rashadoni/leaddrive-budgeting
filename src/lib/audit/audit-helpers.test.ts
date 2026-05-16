/**
 * Unit tests for pure helpers extracted from `scripts/audit-company.cjs`
 * (F1 closure 2026-05-16).
 *
 * Covers the four logic branches that used to live inline in the CLI script:
 *   - `classifyDrift` — drift-pct → match / drift_minor / drift_major.
 *   - `classifySanityBand` — industry × indicator × value → band label.
 *   - `extractAnnualFromSheet` — xlsx row → 12-month sum at 2-decimal precision.
 *   - `parseArgs` — argv → {key:value | true} map.
 *   - `computeVerdict` — checks + sanity → worst-signal verdict.
 */
import { describe, it, expect } from 'vitest';
// CommonJS interop: helpers is a default-shaped require with named exports
// re-exposed from `module.exports = { ... }`. tsconfig esModuleInterop +
// allowJs + moduleResolution:bundler makes this resolve under vitest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const helpers = require('./audit-helpers.cjs') as {
  classifyDrift: (pct: number) => 'match' | 'drift_minor' | 'drift_major';
  classifySanityBand: (
    industry: string,
    code: string,
    value: number | null | undefined,
  ) => 'normal' | 'low_extreme' | 'high_extreme' | 'missing_input' | 'no_band';
  extractAnnualFromSheet: (sheet: unknown, plfCode: string) => number | null;
  parseArgs: (argv: string[]) => Record<string, string | true>;
  computeVerdict: (
    checks: Array<{ class: string }>,
    sanity: Record<string, unknown>,
  ) => 'verified' | 'partial' | 'suspicious' | 'drift_major';
  SHEET_MAP: Record<string, string | null>;
  INDICATORS_BY_INDUSTRY: Record<string, string[]>;
  SANITY_BANDS: Record<string, Record<string, [number, number]>>;
  PLF_LINES: Array<{ plfCode: string; label: string; sign: number }>;
};

describe('classifyDrift', () => {
  it('returns "match" for sub-0.01% drift', () => {
    expect(helpers.classifyDrift(0)).toBe('match');
    expect(helpers.classifyDrift(0.009)).toBe('match');
    expect(helpers.classifyDrift(-0.009)).toBe('match');
  });

  it('returns "drift_minor" between 0.01% and 1.0%', () => {
    expect(helpers.classifyDrift(0.5)).toBe('drift_minor');
    expect(helpers.classifyDrift(-0.99)).toBe('drift_minor');
  });

  it('returns "drift_major" at >=1.0%', () => {
    expect(helpers.classifyDrift(1.0)).toBe('drift_major');
    expect(helpers.classifyDrift(-25)).toBe('drift_major');
    expect(helpers.classifyDrift(422.78)).toBe('drift_major');
  });
});

describe('classifySanityBand', () => {
  it('returns "missing_input" for null / undefined / NaN', () => {
    expect(helpers.classifySanityBand('food_processing', 'IND_GROSS_MARGIN', null)).toBe(
      'missing_input',
    );
    expect(helpers.classifySanityBand('food_processing', 'IND_GROSS_MARGIN', undefined)).toBe(
      'missing_input',
    );
    expect(helpers.classifySanityBand('food_processing', 'IND_GROSS_MARGIN', Number.NaN)).toBe(
      'missing_input',
    );
  });

  it('returns "no_band" when industry × indicator pair has no rule', () => {
    expect(
      helpers.classifySanityBand('food_processing', 'AGRO_YIELD_PER_HA', 50),
    ).toBe('no_band');
    expect(helpers.classifySanityBand('mystery_industry', 'IND_GROSS_MARGIN', 30)).toBe(
      'no_band',
    );
  });

  it('returns "normal" inside the band', () => {
    expect(helpers.classifySanityBand('food_processing', 'IND_GROSS_MARGIN', 25)).toBe('normal');
    expect(helpers.classifySanityBand('food_processing', 'IND_GROSS_MARGIN', 10)).toBe('normal');
    expect(helpers.classifySanityBand('food_processing', 'IND_GROSS_MARGIN', 50)).toBe('normal');
  });

  it('returns "low_extreme" below the band', () => {
    expect(helpers.classifySanityBand('food_processing', 'IND_GROSS_MARGIN', 5)).toBe(
      'low_extreme',
    );
    expect(helpers.classifySanityBand('agro_crops', 'IND_NET_MARGIN', -50)).toBe('low_extreme');
  });

  it('returns "high_extreme" above the band', () => {
    expect(helpers.classifySanityBand('food_processing', 'IND_GROSS_MARGIN', 75)).toBe(
      'high_extreme',
    );
    expect(helpers.classifySanityBand('hospitality', 'HOSP_OCC', 97)).toBe('high_extreme');
  });
});

describe('extractAnnualFromSheet', () => {
  // Build a stub xlsx sheet object: cells are keyed by A1-style addresses,
  // and the sheet has a `!ref` property describing its bounds.
  function stubSheet(rows: Array<{ code: string; values: number[] }>) {
    const sheet: Record<string, unknown> = {};
    rows.forEach((row, rIdx) => {
      sheet[`A${rIdx + 1}`] = { v: row.code, t: 's' };
      row.values.forEach((v, mIdx) => {
        // Months live at cols 3..14 (0-indexed → D..O).
        const colLetter = String.fromCharCode('A'.charCodeAt(0) + 3 + mIdx);
        sheet[`${colLetter}${rIdx + 1}`] = { v, t: 'n' };
      });
    });
    sheet['!ref'] = `A1:O${rows.length}`;
    return sheet;
  }

  it('sums the 12 monthly columns for a matching PLF code', () => {
    const sheet = stubSheet([
      { code: 'PLF.01', values: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
      { code: 'PLF.02', values: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50] },
    ]);
    expect(helpers.extractAnnualFromSheet(sheet, 'PLF.01')).toBe(1200);
    expect(helpers.extractAnnualFromSheet(sheet, 'PLF.02')).toBe(600);
  });

  it('returns null for missing codes', () => {
    const sheet = stubSheet([{ code: 'PLF.01', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }]);
    expect(helpers.extractAnnualFromSheet(sheet, 'PLF.99')).toBeNull();
  });

  it('returns null for null/missing sheet or empty !ref', () => {
    expect(helpers.extractAnnualFromSheet(null, 'PLF.01')).toBeNull();
    expect(helpers.extractAnnualFromSheet({}, 'PLF.01')).toBeNull();
  });

  it('rounds to 2-decimal precision', () => {
    const sheet = stubSheet([
      { code: 'PLF.01', values: [10.123, 10.124, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    ]);
    expect(helpers.extractAnnualFromSheet(sheet, 'PLF.01')).toBeCloseTo(20.25, 2);
  });
});

describe('parseArgs', () => {
  it('parses --key value pairs', () => {
    expect(helpers.parseArgs(['--company', 'AZSEKER-EDEN', '--period', '2026'])).toEqual({
      company: 'AZSEKER-EDEN',
      period: '2026',
    });
  });

  it('parses boolean flags (no value)', () => {
    expect(helpers.parseArgs(['--auto', '--json'])).toEqual({ auto: true, json: true });
  });

  it('mixes value flags and boolean flags', () => {
    expect(
      helpers.parseArgs(['--company', 'AZSEKER', '--auto', '--period', '2026']),
    ).toEqual({ company: 'AZSEKER', auto: true, period: '2026' });
  });
});

describe('computeVerdict', () => {
  it('returns "verified" when no signals fire', () => {
    expect(
      helpers.computeVerdict([{ class: 'match' }, { class: 'drift_minor' }], {
        IND_REVENUE_TOTAL: { value: 100, band: 'normal' },
      }),
    ).toBe('verified');
  });

  it('returns "drift_major" with absolute priority', () => {
    expect(
      helpers.computeVerdict([{ class: 'drift_major' }], {
        IND_REVENUE_TOTAL: { value: 100, band: 'high_extreme' },
      }),
    ).toBe('drift_major');
  });

  it('returns "suspicious" on extreme band when no major drift', () => {
    expect(
      helpers.computeVerdict([{ class: 'match' }], {
        IND_REVENUE_TOTAL: { value: 100, band: 'normal' },
        FP_GROSS_MARGIN: { value: 95, band: 'high_extreme' },
      }),
    ).toBe('suspicious');
  });

  it('returns "partial" on missing IV or missing DB', () => {
    expect(
      helpers.computeVerdict([{ class: 'db_missing' }], {
        IND_REVENUE_TOTAL: { value: 100, band: 'normal' },
      }),
    ).toBe('partial');
    expect(
      helpers.computeVerdict([{ class: 'match' }], {
        IND_REVENUE_TOTAL: 'missing_iv',
      }),
    ).toBe('partial');
  });
});

describe('catalog tables', () => {
  it('SHEET_MAP covers AZSEKER cluster', () => {
    expect(helpers.SHEET_MAP['AZSEKER-EDEN']).toBe('PL_EDEN');
    expect(helpers.SHEET_MAP['AZSEKER-AZSF']).toBe('PLF_AZSF');
  });

  it('INDICATORS_BY_INDUSTRY covers 5 known industries', () => {
    for (const k of ['agro_crops', 'food_processing', 'services', 'industrial', 'hospitality']) {
      expect(helpers.INDICATORS_BY_INDUSTRY[k]).toContain('IND_REVENUE_TOTAL');
    }
  });

  it('PLF_LINES has REVENUE / EBITDA / NET PROFIT with correct signs', () => {
    const rev = helpers.PLF_LINES.find((l) => l.plfCode === 'PLF.01');
    const ebitda = helpers.PLF_LINES.find((l) => l.plfCode === 'PLF.07');
    const net = helpers.PLF_LINES.find((l) => l.plfCode === 'PLF.10');
    expect(rev?.sign).toBe(1);
    expect(ebitda?.sign).toBe(1);
    expect(net?.sign).toBe(1);
  });
});
