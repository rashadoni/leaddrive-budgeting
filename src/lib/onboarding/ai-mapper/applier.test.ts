/**
 * Unit tests for the apply-time pure helper.
 * Covers: column resolution, proposal merge, account-type fallback chain,
 * sign flip for cogs/expense, parent-rollup dedup integration, error
 * paths (missing months, duplicate role, conflicting overrides).
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { applyProposal, resolveColumns, detectProposalYear } from './applier';
import type {
  ColumnMappingProposal,
  MappingProposal,
} from './types';

function makeWorkbook(aoa: (string | number | null)[][], sheetName = 'Sheet1') {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

function buildProposal(columns: ColumnMappingProposal[]): MappingProposal {
  return {
    sourceFile: 'test.xlsx',
    sourceSheet: 'Sheet1',
    columns,
    accountTypeOverrides: [],
    anomalies: [],
    overallConfidence: 0.85,
    summary: 'test',
  };
}

function fullMonthCols(startIdx: number): ColumnMappingProposal[] {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months.map((m, i) => ({
    sourceIndex: startIdx + i,
    role: `amount:${m}` as const,
    confidence: 0.9,
    reasoning: `${m} column`,
  }));
}

describe('resolveColumns', () => {
  it('resolves a complete code+label+12-months proposal', () => {
    const cols: ColumnMappingProposal[] = [
      { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: 'KOD' },
      { sourceIndex: 1, role: 'label', confidence: 0.9, reasoning: 'Label' },
      ...fullMonthCols(2),
    ];
    const result = resolveColumns(cols);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.columns.codeCol).toBe(0);
      expect(result.columns.labelCol).toBe(1);
      expect(result.columns.monthCols).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    }
  });

  it('rejects proposal with no code column', () => {
    const cols: ColumnMappingProposal[] = [
      { sourceIndex: 0, role: 'label', confidence: 0.9, reasoning: '' },
      ...fullMonthCols(1),
    ];
    const result = resolveColumns(cols);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no "code" column/);
  });

  it('rejects proposal with duplicate code columns', () => {
    const cols: ColumnMappingProposal[] = [
      { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: '' },
      { sourceIndex: 1, role: 'code', confidence: 0.9, reasoning: '' },
      { sourceIndex: 2, role: 'label', confidence: 0.9, reasoning: '' },
      ...fullMonthCols(3),
    ];
    const result = resolveColumns(cols);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Multiple "code" columns/);
  });

  it('rejects proposal missing some months', () => {
    const partialMonths = fullMonthCols(2).slice(0, 6); // only Jan-Jun
    const cols: ColumnMappingProposal[] = [
      { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: '' },
      { sourceIndex: 1, role: 'label', confidence: 0.9, reasoning: '' },
      ...partialMonths,
    ];
    const result = resolveColumns(cols);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missing monthly columns/);
  });

  it('rejects proposal mapping two columns to the same month', () => {
    const cols: ColumnMappingProposal[] = [
      { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: '' },
      { sourceIndex: 1, role: 'label', confidence: 0.9, reasoning: '' },
      ...fullMonthCols(2),
      { sourceIndex: 14, role: 'amount:Jan', confidence: 0.9, reasoning: '' },
    ];
    const result = resolveColumns(cols);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Multiple columns mapped to month jan/);
  });

  it('ignores skip + amount:Total / amount:Plan / etc roles', () => {
    const cols: ColumnMappingProposal[] = [
      { sourceIndex: 0, role: 'skip', confidence: 1, reasoning: 'empty' },
      { sourceIndex: 1, role: 'code', confidence: 0.9, reasoning: '' },
      { sourceIndex: 2, role: 'label', confidence: 0.9, reasoning: '' },
      { sourceIndex: 3, role: 'amount:Total', confidence: 0.9, reasoning: 'annual sum' },
      { sourceIndex: 4, role: 'amount:Plan2026', confidence: 0.9, reasoning: 'plan flag' },
      ...fullMonthCols(5),
    ];
    const result = resolveColumns(cols);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.columns.codeCol).toBe(1);
      // Total / Plan2026 NOT among monthCols.
      expect(result.columns.monthCols).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    }
  });
});

describe('applyProposal — happy path', () => {
  it('parses a simple SOPL-shape sheet using proposal column-mapping', () => {
    const aoa: (string | number | null)[][] = [
      ['NUM', 'KOD', 'Label', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      [1, '601-04', 'Revenue', 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      [2, '701-01', 'COGS', -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50],
      [3, '721-02-01', 'Salary', -20, -20, -20, -20, -20, -20, -20, -20, -20, -20, -20, -20],
    ];
    const wb = makeWorkbook(aoa);
    const proposal = buildProposal([
      { sourceIndex: 0, role: 'skip', confidence: 1, reasoning: '' },
      { sourceIndex: 1, role: 'code', confidence: 0.95, reasoning: 'KOD' },
      { sourceIndex: 2, role: 'label', confidence: 0.95, reasoning: 'Label' },
      ...fullMonthCols(3),
    ]);

    const result = applyProposal(wb, 'Sheet1', proposal, XLSX);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.lines).toHaveLength(3);
    const rev = result.lines.find((l) => l.code === '601-04')!;
    expect(rev.accountType).toBe('revenue');
    expect(rev.plannedAnnual).toBe(1200); // 12 × 100, no flip
    const cogs = result.lines.find((l) => l.code === '701-01')!;
    expect(cogs.accountType).toBe('cogs');
    expect(cogs.plannedAnnual).toBe(600); // 12 × 50 (flipped from -50)
    const exp = result.lines.find((l) => l.code === '721-02-01')!;
    expect(exp.accountType).toBe('expense');
    expect(exp.plannedAnnual).toBe(240); // 12 × 20
  });

  it('uses accountTypeOverrides when LLM proposed something exotic', () => {
    // Proposal classifies 611-01 as revenue (non-standard 6xx prefix), even
    // though SAP fallback would also call it revenue. Override should win.
    const aoa: (string | number | null)[][] = [
      ['NUM', 'KOD', 'Label', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      [1, '999-01', 'Mystery line', 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
    ];
    const wb = makeWorkbook(aoa);
    const proposal: MappingProposal = {
      ...buildProposal([
        { sourceIndex: 0, role: 'skip', confidence: 1, reasoning: '' },
        { sourceIndex: 1, role: 'code', confidence: 0.9, reasoning: '' },
        { sourceIndex: 2, role: 'label', confidence: 0.9, reasoning: '' },
        ...fullMonthCols(3),
      ]),
      accountTypeOverrides: [
        { code: '999-01', accountType: 'revenue', confidence: 0.7, reasoning: 'context says revenue' },
      ],
    };
    const result = applyProposal(wb, 'Sheet1', proposal, XLSX);
    if ('error' in result) throw new Error(result.error);
    expect(result.lines[0].accountType).toBe('revenue');
  });

  it('triggers parent-rollup dedup when both parent and children present', () => {
    const aoa: (string | number | null)[][] = [
      ['NUM', 'KOD', 'Label', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      [1, '601-04', 'Revenue', 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      [2, '721-02', 'Personnel total', -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50],
      [3, '721-02-01', 'Salary', -40, -40, -40, -40, -40, -40, -40, -40, -40, -40, -40, -40],
      [4, '721-02-02', 'DSMF', -10, -10, -10, -10, -10, -10, -10, -10, -10, -10, -10, -10],
    ];
    const wb = makeWorkbook(aoa);
    const proposal = buildProposal([
      { sourceIndex: 0, role: 'skip', confidence: 1, reasoning: '' },
      { sourceIndex: 1, role: 'code', confidence: 0.95, reasoning: '' },
      { sourceIndex: 2, role: 'label', confidence: 0.95, reasoning: '' },
      ...fullMonthCols(3),
    ]);
    const result = applyProposal(wb, 'Sheet1', proposal, XLSX);
    if ('error' in result) throw new Error(result.error);

    const codes = result.lines.map((l) => l.code).sort();
    expect(codes).toEqual(['601-04', '721-02-01', '721-02-02']);
    expect(result.parentRollupsDropped.map((d) => d.code)).toEqual(['721-02']);
    // Children sum exactly to parent → no synthetic.
    expect(result.parentRollupsUnallocated).toHaveLength(0);
  });

  it('skips zero-only rows', () => {
    const aoa: (string | number | null)[][] = [
      ['NUM', 'KOD', 'Label', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      [1, '601-04', 'Revenue', 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      [2, '601-99', 'Empty placeholder', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    const wb = makeWorkbook(aoa);
    const proposal = buildProposal([
      { sourceIndex: 0, role: 'skip', confidence: 1, reasoning: '' },
      { sourceIndex: 1, role: 'code', confidence: 0.95, reasoning: '' },
      { sourceIndex: 2, role: 'label', confidence: 0.95, reasoning: '' },
      ...fullMonthCols(3),
    ]);
    const result = applyProposal(wb, 'Sheet1', proposal, XLSX);
    if ('error' in result) throw new Error(result.error);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].code).toBe('601-04');
  });

  it('silent-skip for 4xx/5xx/8xx OVERRIDES any accountType-override the LLM gave', () => {
    // Architect round-1 finding: silent-skip must run BEFORE consulting
    // overrides, otherwise an over-eager LLM override on 441-xx would
    // bypass the informational-row contract.
    const aoa: (string | number | null)[][] = [
      ['NUM', 'KOD', 'Label', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      [1, '601-04', 'Revenue', 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      [2, '441-01', 'Off-balance stat', 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    ];
    const wb = makeWorkbook(aoa);
    const proposal: MappingProposal = {
      ...buildProposal([
        { sourceIndex: 0, role: 'skip', confidence: 1, reasoning: '' },
        { sourceIndex: 1, role: 'code', confidence: 0.95, reasoning: '' },
        { sourceIndex: 2, role: 'label', confidence: 0.95, reasoning: '' },
        ...fullMonthCols(3),
      ]),
      // LLM mistakenly proposed 441-01 as expense; silent-skip must win.
      accountTypeOverrides: [
        { code: '441-01', accountType: 'expense', confidence: 0.6, reasoning: 'LLM guess' },
      ],
    };
    const result = applyProposal(wb, 'Sheet1', proposal, XLSX);
    if ('error' in result) throw new Error(result.error);
    // Only 601-04 should land — 441-01 silent-skipped despite override.
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].code).toBe('601-04');
    expect(result.warnings).toHaveLength(0);
  });

  it('silently skips 4xx/5xx/8xx informational codes (matches azmade-sopl convention)', () => {
    const aoa: (string | number | null)[][] = [
      ['NUM', 'KOD', 'Label', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      [1, '601-04', 'Revenue', 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      [2, '441-01', 'Info row', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      [3, '511-02', 'Info row', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [4, '811-01', 'Info row', 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    ];
    const wb = makeWorkbook(aoa);
    const proposal = buildProposal([
      { sourceIndex: 0, role: 'skip', confidence: 1, reasoning: '' },
      { sourceIndex: 1, role: 'code', confidence: 0.95, reasoning: '' },
      { sourceIndex: 2, role: 'label', confidence: 0.95, reasoning: '' },
      ...fullMonthCols(3),
    ]);
    const result = applyProposal(wb, 'Sheet1', proposal, XLSX);
    if ('error' in result) throw new Error(result.error);
    expect(result.lines).toHaveLength(1); // only 601-04
    expect(result.warnings).toHaveLength(0); // info rows shouldn't warn
  });

  it('merges userOverrides on top of the saved proposal', () => {
    const aoa: (string | number | null)[][] = [
      ['NUM', 'KOD', 'Label', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      [1, '601-04', 'Revenue', 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
    ];
    const wb = makeWorkbook(aoa);
    // Original proposal had col 1 marked as `skip` (LLM was wrong).
    const originalProposal = buildProposal([
      { sourceIndex: 0, role: 'skip', confidence: 1, reasoning: '' },
      { sourceIndex: 1, role: 'skip', confidence: 0.5, reasoning: 'mistakenly skipped' },
      { sourceIndex: 2, role: 'label', confidence: 0.95, reasoning: '' },
      ...fullMonthCols(3),
    ]);
    // User override: col 1 is actually `code`.
    const userOverride: Partial<MappingProposal> = {
      columns: [
        { sourceIndex: 1, role: 'code', confidence: 1.0, reasoning: 'user-corrected' },
      ],
    };
    const result = applyProposal(wb, 'Sheet1', originalProposal, XLSX, userOverride);
    if ('error' in result) throw new Error(result.error);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].code).toBe('601-04');
  });
});

describe('detectProposalYear', () => {
  it('returns null when no year is embedded in column roles', () => {
    const cols: ColumnMappingProposal[] = [
      { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: '' },
      { sourceIndex: 1, role: 'label', confidence: 0.9, reasoning: '' },
      ...fullMonthCols(2),
    ];
    expect(detectProposalYear(cols)).toBeNull();
  });

  it('extracts a single year from `amount:Plan2026` style roles', () => {
    const cols: ColumnMappingProposal[] = [
      { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: '' },
      { sourceIndex: 1, role: 'label', confidence: 0.9, reasoning: '' },
      { sourceIndex: 2, role: 'amount:Plan2026', confidence: 0.9, reasoning: '' },
      { sourceIndex: 3, role: 'amount:Jan2026', confidence: 0.9, reasoning: '' },
      { sourceIndex: 4, role: 'amount:Feb2026', confidence: 0.9, reasoning: '' },
    ];
    expect(detectProposalYear(cols)).toBe(2026);
  });

  it('returns conflict when multiple years are present', () => {
    const cols: ColumnMappingProposal[] = [
      { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: '' },
      { sourceIndex: 1, role: 'amount:Plan2026', confidence: 0.9, reasoning: '' },
      { sourceIndex: 2, role: 'amount:Plan2025', confidence: 0.9, reasoning: '' },
    ];
    const result = detectProposalYear(cols);
    expect(typeof result).toBe('object');
    if (typeof result === 'object' && result !== null && 'conflict' in result) {
      expect(result.conflict).toEqual([2025, 2026]);
    }
  });

  it('only matches 4-digit years starting with 20 (skips e.g. 1990)', () => {
    const cols: ColumnMappingProposal[] = [
      { sourceIndex: 0, role: 'amount:Jan1990', confidence: 0.9, reasoning: '' },
    ];
    expect(detectProposalYear(cols)).toBeNull();
  });
});

describe('applyProposal — error paths', () => {
  it('returns error when sheet name not found', () => {
    const wb = makeWorkbook([['x']]);
    const proposal = buildProposal([
      { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: '' },
    ]);
    const result = applyProposal(wb, 'WrongSheet', proposal, XLSX);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/not found/);
  });

  it('returns error when proposal has no code column', () => {
    const aoa: (string | number | null)[][] = [
      ['Label', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      ['Revenue', 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
    ];
    const wb = makeWorkbook(aoa);
    const proposal = buildProposal([
      { sourceIndex: 0, role: 'label', confidence: 0.9, reasoning: '' },
      ...fullMonthCols(1),
    ]);
    const result = applyProposal(wb, 'Sheet1', proposal, XLSX);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/no "code" column/);
  });

  it('returns error on empty sheet', () => {
    const wb = makeWorkbook([]);
    const proposal = buildProposal([
      { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: '' },
      { sourceIndex: 1, role: 'label', confidence: 0.9, reasoning: '' },
      ...fullMonthCols(2),
    ]);
    const result = applyProposal(wb, 'Sheet1', proposal, XLSX);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/empty/i);
  });
});
