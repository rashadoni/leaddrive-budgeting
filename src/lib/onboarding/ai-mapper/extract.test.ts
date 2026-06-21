import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { extractMapperInput, renderInputForPrompt } from './extract';

function makeWorkbook(aoa: (string | number | null)[][], sheetName = 'Sheet1'): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

describe('extractMapperInput', () => {
  it('returns error for missing sheet', () => {
    const wb = makeWorkbook([['a', 'b']], 'Sheet1');
    const result = extractMapperInput(wb, 'Sheet2', XLSX);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/not found/);
    }
  });

  it('returns error for empty sheet', () => {
    const wb = makeWorkbook([], 'Empty');
    const result = extractMapperInput(wb, 'Empty', XLSX);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/empty/i);
    }
  });

  it('extracts column headers from first 5 rows (handles title banners)', () => {
    // Row 0 = title banner, row 1 = blank (stripped by blankrows:false),
    // row 2 (post-strip) = real headers, rows 3+ = data.
    const aoa: (string | number | null)[][] = [
      [null, null, 'COMPANY 2026 BUDGET', null],
      [null, null, null, null], // stripped at parse time
      ['NUM', 'KOD', 'Description', 'Amount'],
      ['1', '601-04', 'Revenue line A', 1000],
      ['2', '701-01', 'Cost line', -500],
      ['3', '721-02', 'Expense line', -200],
      ['4', '721-04', 'Other expense', -100],
      ['5', '601-99', 'Other revenue', 50],
    ];
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX);

    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.columns.length).toBe(4);
    // Header detection picks row 1 (post-strip) — `[NUM, KOD, Description,
    // Amount]` has 4 non-empty short strings, qualifies. headerText comes
    // ONLY from that row, not from the banner above it.
    expect(result.columns[0].headerText).toBe('NUM');
    expect(result.columns[1].headerText).toBe('KOD');
    expect(result.columns[2].headerText).toBe('Description');
    expect(result.columns[3].headerText).toBe('Amount');
  });

  it('collects up to 5 sample data values per column from row 5+', () => {
    // xlsx's `blankrows: false` strips fully-empty rows when reading back.
    // To populate "header band" rows 0-4 without them being collapsed, put
    // a placeholder value in another column.
    const aoa: (string | number | null)[][] = [
      ['header', null],
      ['title', null],
      ['x', null],
      ['x', null],
      ['x', null],
      ['data1', null],
      ['data2', null],
      ['data3', null],
      ['data4', null],
      ['data5', null],
      ['data6', null],  // exceeds limit
    ];
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX);
    if ('error' in result) throw new Error(result.error);

    // Samples come from row 5 onwards, max 5 entries.
    expect(result.columns[0].samples).toEqual(['data1', 'data2', 'data3', 'data4', 'data5']);
    expect(result.columns[0].samples.length).toBeLessThanOrEqual(5);
  });

  it('skips null/empty cells when collecting samples', () => {
    // Header detection requires ≥3 non-empty cells. Use a 3-col header so
    // headerEndRow=1 and samples start from row 1.
    const aoa: (string | number | null)[][] = [
      ['NUM', 'KOD', 'Label'],   // header — 3 cells, triggers headerEndRow=1
      [null, 'r1', 'lab1'],      // col 0 null → skipped
      ['data1', 'r2', 'lab2'],
      ['', 'r3', 'lab3'],        // col 0 empty string → skipped
      ['data2', 'r4', 'lab4'],
    ];
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX);
    if ('error' in result) throw new Error(result.error);
    expect(result.columns[0].samples).toEqual(['data1', 'data2']);
  });

  it('caps sample rows at 30', () => {
    const aoa: (string | number | null)[][] = [];
    for (let i = 0; i < 100; i++) aoa.push([`row${i}`]);
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX);
    if ('error' in result) throw new Error(result.error);
    expect(result.sampleRows.length).toBeLessThanOrEqual(30);
  });

  it('handles long title banners (header on row 6+) via non-empty heuristic', () => {
    // 6-row title banner → real header on row 6 (after blankrows strip).
    // Heuristic: first row with ≥2 non-empty cells = header band end.
    const aoa: (string | number | null)[][] = [
      ['COMPANY 2026 BUDGET', null, null, null],   // 1 cell → not header
      ['Approved by CFO', null, null, null],         // 1 cell
      ['Period: Jan-Dec 2026', null, null, null],    // 1 cell
      ['Currency: AZN', null, null, null],           // 1 cell
      ['Prepared 2026-04-01', null, null, null],     // 1 cell
      ['Reviewed 2026-04-15', null, null, null],     // 1 cell
      ['NUM', 'KOD', 'Description', 'Amount'],       // ≥2 cells → header!
      [1, '601-04', 'Revenue line', 1000],
      [2, '701-01', 'Cost line', -500],
    ];
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX);
    if ('error' in result) throw new Error(result.error);

    // Header texts should come from row 6 (the real header), not from the
    // banner rows.
    expect(result.columns[1].headerText).toBe('KOD');
    expect(result.columns[2].headerText).toBe('Description');
    // Samples should come from rows AFTER header (601-04, 701-01).
    expect(result.columns[1].samples).toContain('601-04');
    expect(result.columns[1].samples).toContain('701-01');
  });

  it('does NOT mistake a 2-cell title banner for the header row', () => {
    // Architect round-2 finding: 2-cell title banner like
    // ["Company XYZ Ltd", "Q4 2025"] would falsely trigger the old
    // ≥2-non-empty heuristic. New heuristic requires ≥3 non-empty cells +
    // all strings + each cell ≤50 chars to qualify.
    const aoa: (string | number | null)[][] = [
      ['Company XYZ Ltd', 'Q4 2025', null, null], // 2-cell banner — must NOT match
      ['NUM', 'KOD', 'Description', 'Amount'],     // real header — 4 cells
      [1, '601-04', 'Revenue', 1000],
      [2, '701-01', 'Cost', -500],
    ];
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX);
    if ('error' in result) throw new Error(result.error);
    // Real header detected on row 1, not banner.
    expect(result.columns[1].headerText).toBe('KOD');
    expect(result.columns[2].headerText).toBe('Description');
    // Samples come from rows AFTER real header (row 1).
    expect(result.columns[1].samples).toContain('601-04');
    expect(result.columns[1].samples).toContain('701-01');
  });

  it('does NOT mistake a numeric-bearing row for the header (data starts here)', () => {
    // Numeric cells indicate data, not header.
    const aoa: (string | number | null)[][] = [
      ['title', null, null, null],
      ['x', 1, 2, 3],   // numbers → not header
      ['NUM', 'KOD', 'Label', 'Amount'],
      [1, '601', 'rev', 100],
    ];
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX);
    if ('error' in result) throw new Error(result.error);
    expect(result.columns[2].headerText).toBe('Label');
  });

  it('does NOT mistake a long-prose row for the header', () => {
    // Approval / notes row with long prose strings (>MAX_HEADER_CELL_LEN
    // = 80 chars). Real header below should be picked up correctly.
    const longProse =
      'Approved by CFO on 2026-04-01 — version 3, signed by board members of the holding';
    const aoa: (string | number | null)[][] = [
      [longProse, 'OK', 'YES', null],
      ['NUM', 'KOD', 'Label', 'Amount'],
      [1, '601', 'rev', 100],
    ];
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX);
    if ('error' in result) throw new Error(result.error);
    expect(result.columns[2].headerText).toBe('Label');
  });

  it('falls back to row 5 when no row in first 20 has ≥2 non-empty cells', () => {
    // Pathological: only column 0 ever has data.
    const aoa: (string | number | null)[][] = [];
    for (let i = 0; i < 25; i++) aoa.push([`row${i}`, null, null]);
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX);
    if ('error' in result) throw new Error(result.error);
    // Falls back to default headerEndRow=5 → samples from row5+.
    expect(result.columns[0].samples[0]).toBe('row5');
  });

  it('passes through company context', () => {
    const aoa: (string | number | null)[][] = [['x']];
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX, {
      sourceFile: '/some/path.xlsx',
      companyName: 'TestCo',
      industry: 'pharma',
    });
    if ('error' in result) throw new Error(result.error);
    expect(result.sourceFile).toBe('/some/path.xlsx');
    expect(result.companyContext).toEqual({ name: 'TestCo', industry: 'pharma' });
  });
});

describe('renderInputForPrompt', () => {
  it('produces a token-bounded text block with all column samples + first rows', () => {
    const aoa: (string | number | null)[][] = [
      [null, 'KOD', 'Label', 'Jan', 'Feb'],
      ['x', '601-04', 'Revenue', 100, 110],
      ['x', '701-01', 'COGS', -50, -55],
    ];
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX, {
      sourceFile: 'test.xlsx',
      companyName: 'TestCo',
      industry: 'industrial',
    });
    if ('error' in result) throw new Error(result.error);

    const rendered = renderInputForPrompt(result);

    expect(rendered).toContain('Sheet "Sheet1" from "test.xlsx"');
    expect(rendered).toContain('industrial');
    expect(rendered).toContain('KOD');
    expect(rendered).toContain('Label');
    expect(rendered).toContain('Columns (5 total)');
  });

  it('truncates very long cell values to keep prompt size bounded', () => {
    const longString = 'x'.repeat(500);
    const aoa: (string | number | null)[][] = [[longString]];
    const wb = makeWorkbook(aoa);
    const result = extractMapperInput(wb, 'Sheet1', XLSX);
    if ('error' in result) throw new Error(result.error);

    const rendered = renderInputForPrompt(result);
    // The full 500-char string must NOT be in the output.
    expect(rendered).not.toContain(longString);
    expect(rendered).toContain('…');
  });
});

describe('extractMapperInput — stratified samples (C2.6)', () => {
  it('samples a contiguous block column across its full range (entity detection)', () => {
    // A BU/entity column whose values are CONTIGUOUS blocks: 8×AZSF, 8×EDEN,
    // 8×CPC. First-N sampling would show only AZSF; stratified must reveal the
    // other blocks so the mapper can recognise the entity dimension.
    const aoa: (string | number | null)[][] = [['Code', 'Label', 'BU']]
    const blocks = ['AZSF', 'EDEN', 'CPC']
    for (const bu of blocks) for (let i = 0; i < 8; i++) aoa.push([`PLF.0${blocks.indexOf(bu) + 1}.${i}`, `${bu} line ${i}`, bu])
    const res = extractMapperInput(makeWorkbook(aoa), 'Sheet1', XLSX)
    expect('error' in res).toBe(false)
    if ('error' in res) return
    const buCol = res.columns.find((c) => c.headerText === 'BU')!
    const distinct = new Set(buCol.samples.map(String))
    // Must surface >1 distinct BU (not just the first block).
    expect(distinct.size).toBeGreaterThan(1)
    expect(distinct.has('EDEN') || distinct.has('CPC')).toBe(true)
  })
})

describe('renderInputForPrompt — wide row display (C2.7)', () => {
  it('shows columns beyond the old 18-col cap (multi-year / multi-company)', () => {
    const columns = Array.from({ length: 40 }, (_, i) => ({ index: i, headerText: `H${i}`, samples: [] as string[] }))
    const wideRow = Array.from({ length: 40 }, (_, i) => `c${i}`)
    const input = { sourceFile: 'f', sourceSheet: 's', columns, sampleRows: [wideRow] }
    const out = renderInputForPrompt(input as Parameters<typeof renderInputForPrompt>[0])
    // c25 + c39 sit past the old slice(0, 18) cutoff — they must now appear.
    expect(out).toContain('c25')
    expect(out).toContain('c39')
  })
})

describe('extractMapperInput — Excel date-serial month headers (Reporting 2026 Actual/Budget PLF)', () => {
  it('decodes serial-date header cells to month labels (monthly cols → amount:<month>, not code)', () => {
    // Mirrors Reporting 2026 "Actual PLF": row 0 = blank,blank,blank + serial-date
    // months (45658=Jan2025 … 45992=Dec2025); rows 1+ = code, label, blank, amounts.
    const aoa: (string | number | null)[][] = [
      [null, null, null, 45658, 45689, 45992],
      ['PLF.01', 'REVENUE', null, 203195, 473454, 1566074],
      ['PLF.01.01', 'Revenue from sugar', null, 189688, 406466, 1447343],
      ['PLF.01.02', 'Other revenue', null, 9072, 3272, 0],
      ['PLF.02', 'COGS', null, -50000, -60000, -70000],
    ]
    const result = extractMapperInput(makeWorkbook(aoa, 'Actual PLF'), 'Actual PLF', XLSX)
    if ('error' in result) throw new Error(result.error)
    // serial-date header row now detected + decoded → readable month labels
    expect(result.columns[3].headerText).toBe('Jan 2025')
    expect(result.columns[4].headerText).toBe('Feb 2025')
    expect(result.columns[5].headerText).toBe('Dec 2025')
    // code/label columns keep (empty) headers but get real samples from row 1+
    expect(result.columns[0].samples.map(String)).toContain('PLF.01')
    expect(result.columns[1].samples.map(String)).toContain('REVENUE')
  })

  it('does NOT mistake a normal numeric data row for a date-serial header', () => {
    // A genuine string header wins; amounts (fractional or out of serial range)
    // must not be misread as a period header.
    const aoa: (string | number | null)[][] = [
      ['Kod', 'Ad', 'Jan', 'Feb'],
      ['601-01', 'Satış', 45000.5, 60001],
      ['701-01', 'Maya', 30000, 40000],
    ]
    const result = extractMapperInput(makeWorkbook(aoa, 'Plain'), 'Plain', XLSX)
    if ('error' in result) throw new Error(result.error)
    expect(result.columns[0].headerText).toBe('Kod')
    expect(result.columns[2].headerText).toBe('Jan')
  })
})
