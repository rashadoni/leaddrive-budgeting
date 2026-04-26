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
