import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  accountTypeFromCode,
  dedupeParentRollups,
  findHeaderRow,
  mapColumns,
  matchRollupLabel,
  parseSoplSheet,
  parseSummaryRollupSheet,
} from './azmade-sopl';

describe('accountTypeFromCode', () => {
  it('maps 6xx → revenue', () => {
    expect(accountTypeFromCode('601-04')).toBe('revenue');
    expect(accountTypeFromCode('611-01')).toBe('revenue');
    expect(accountTypeFromCode('699')).toBe('revenue');
  });

  it('maps 70x / 71x → cogs', () => {
    expect(accountTypeFromCode('701-01')).toBe('cogs');
    expect(accountTypeFromCode('701-06')).toBe('cogs');
    expect(accountTypeFromCode('711-02')).toBe('cogs');
  });

  it('maps 72x..79x → expense', () => {
    expect(accountTypeFromCode('721-02')).toBe('expense');
    expect(accountTypeFromCode('721-02-01')).toBe('expense');
    expect(accountTypeFromCode('731-05')).toBe('expense');
    expect(accountTypeFromCode('799-99')).toBe('expense');
  });

  it('maps balance-sheet prefixes', () => {
    expect(accountTypeFromCode('111-05')).toBe('asset');
    expect(accountTypeFromCode('201-03')).toBe('liability');
    expect(accountTypeFromCode('301')).toBe('equity');
  });

  it('ignores leading non-digit noise', () => {
    expect(accountTypeFromCode('  601 ')).toBe('revenue');
    expect(accountTypeFromCode('№601-04')).toBe('revenue');
  });

  it('maps 9xx → expense (AZ profit-tax accounts)', () => {
    expect(accountTypeFromCode('901-01')).toBe('expense');
  });

  it('returns null for garbage or unmappable prefix', () => {
    expect(accountTypeFromCode('abc')).toBeNull();
    expect(accountTypeFromCode('801-01')).toBeNull(); // no 8xx category
    expect(accountTypeFromCode('')).toBeNull();
  });
});

describe('findHeaderRow', () => {
  const allMonths = [
    'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
    'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
  ];

  it('returns the index of the row that holds all 12 AZ months', () => {
    const aoa = [
      ['Some Title', null],
      [null, null],
      ['KOD', 'MADDƏ', ...allMonths],
      [null],
    ];
    expect(findHeaderRow(aoa)).toBe(2);
  });

  it('matches P-F plan-variant headers ("YanvarPlan" / "Yanvar\\nPlan")', () => {
    // ATL rev9 P-F sheets use the `<Month>Plan` compound form or a
    // `<Month>\nPlan` merged-cell display. Both should resolve.
    const planRow = allMonths.map((m) => `${m}\nPlan`);
    const aoa = [
      [null],
      [null],
      ['', '', 'Aylar', ...planRow],
    ];
    expect(findHeaderRow(aoa)).toBe(2);
  });

  it('trims whitespace when matching', () => {
    const padded = allMonths.map((m) => `  ${m}  `);
    expect(findHeaderRow([padded])).toBe(0);
  });

  it('returns -1 when fewer than all 12 months are present', () => {
    expect(
      findHeaderRow([['Yanvar', 'Fevral', 'Mart']]), // only 3 of 12
    ).toBe(-1);
  });

  it('known-limitation: `<Month>Budget` / `<Month>LE` variants are NOT matched', () => {
    // Locks the current behavior. If a workbook uses these variants instead
    // of the plain or `<Month>Plan` forms, findHeaderRow returns -1 and the
    // sheet parses to zero rows. Extend `isPlanMonthHeader` when a real
    // such workbook lands.
    const budgetRow = allMonths.map((m) => `${m}Budget`);
    const leRow = allMonths.map((m) => `${m}LE`);
    expect(findHeaderRow([budgetRow])).toBe(-1);
    expect(findHeaderRow([leRow])).toBe(-1);
  });
});

describe('mapColumns', () => {
  it('finds code col, label col, and 12 months from a simple header', () => {
    const header = [
      'KOD', 'MADDƏ',
      'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
      'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
    ];
    const cols = mapColumns(header);
    expect(cols).not.toBeNull();
    expect(cols!.codeCol).toBe(0);
    expect(cols!.labelCol).toBe(1);
    expect(cols!.monthCols).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('defaults codeCol = labelCol-2 when no KOD header label is found', () => {
    // LLS / ZTP shape: code is in column B, label in column D, no "KOD" header.
    const header = [
      null, null, null, 'GƏLİR/XƏRC MADDƏLƏRİ', '46022',
      'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
      'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
    ];
    const cols = mapColumns(header);
    expect(cols).not.toBeNull();
    expect(cols!.labelCol).toBe(3);
    expect(cols!.codeCol).toBe(1); // labelCol - 2
    expect(cols!.monthCols[0]).toBe(5); // Yanvar
  });

  it('returns null when any month column is missing', () => {
    const header = [
      'KOD', 'MADDƏ',
      'Yanvar', 'Fevral', 'Mart', // truncated — only 3 months
    ];
    expect(mapColumns(header)).toBeNull();
  });
});

describe('parseSoplSheet', () => {
  function makeWorkbook(aoa: (string | number | null)[][]): XLSX.WorkBook {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SOPL');
    return wb;
  }

  it('parses LLS-shaped SOPL (code col-2 of label, 12 monthly cols)', () => {
    const aoa: (string | number | null)[][] = [
      [null, null, null, 'LLS MMC 2026 Büdcə'],
      [null, null, null, null],
      [
        null, null, null, 'GƏLİR/XƏRC MADDƏLƏRİ', '46022',
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
        'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
      ],
      // Category-header (no KOD) — should be skipped
      [
        null, null, null, 'SATIŞDAN GƏLİRLƏR', 100,
        10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
      ],
      // Leaf: 601-04 revenue row with monthly plan
      [
        null, '601-04', null, 'Məhsul satışı', 0,
        100, 200, 300, 400, 500, 600,
        700, 800, 900, 1000, 1100, 1200,
      ],
      // Leaf: 701-01 cogs row (negative values common for costs)
      [
        null, '701-01', null, 'Məhsul maya dəyəri', 0,
        -50, -60, -70, -80, -90, -100,
        -110, -120, -130, -140, -150, -160,
      ],
      // Leaf: 721-02-01 expense (deep sub-account)
      [
        null, '721-02-01', null, 'Əmək haqqı', 0,
        -10, -10, -10, -10, -10, -10,
        -10, -10, -10, -10, -10, -10,
      ],
      // Zero-all-months row — should be skipped
      [
        null, '601-99', null, 'Sair satışlar',
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ],
      // Subtotal / category-calc (no KOD)
      [
        null, null, null, 'MƏCMU GƏLİR',
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ],
    ];
    const wb = makeWorkbook(aoa);
    const result = parseSoplSheet(wb, 'SOPL', XLSX);

    // LLS layout has no explicit "KOD" header → codeCol derived via fallback.
    // That surfaces as one info-level warning by design so unseen 4th layouts
    // don't silently parse zero rows.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toMatch(/codeCol guessed/);
    expect(result.lines).toHaveLength(3);
    expect(result.skippedRowCount).toBeGreaterThan(0);

    const rev = result.lines.find((l) => l.code === '601-04');
    expect(rev?.accountType).toBe('revenue');
    expect(rev?.plannedAnnual).toBe(7800); // 100+200+…+1200
    expect(rev?.perMonth).toHaveLength(12);

    const cogs = result.lines.find((l) => l.code === '701-01');
    expect(cogs?.accountType).toBe('cogs');
    // Raw SOPL stores cogs as negative (-50, -60, ..., -160 = -1260). Parser
    // flips sign so downstream `revenue - cogs` yields correct gross profit.
    expect(cogs?.plannedAnnual).toBe(1260);

    const opex = result.lines.find((l) => l.code === '721-02-01');
    expect(opex?.accountType).toBe('expense');
    expect(opex?.plannedAnnual).toBe(120); // flipped from -120
  });

  it('surfaces a warning for codes with no accountType prefix AND not in 4xx/5xx/8xx silent-skip range', () => {
    // "001-01" passes the KOD regex (3+ digits) but `0` is neither a P&L
    // nor a BS prefix AND not in the 4xx/5xx/8xx informational-skip range,
    // so it surfaces as a warning for the operator to investigate.
    const aoa: (string | number | null)[][] = [
      [
        'KOD', 'MADDƏ',
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
        'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
      ],
      [
        '001-01', 'Unknown bucket',
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      ],
    ];
    const wb = makeWorkbook(aoa);
    const result = parseSoplSheet(wb, 'SOPL', XLSX);
    expect(result.lines).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toMatch(/001-01/);
  });

  it('maps 9xx codes as expense (AZ profit-tax) end-to-end through parseSoplSheet', () => {
    const aoa: (string | number | null)[][] = [
      [
        'KOD', 'MADDƏ',
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
        'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
      ],
      [
        '901-01', 'Cari mənfəət vergisi üzrə xərclər',
        -100, -100, -100, -100, -100, -100, -100, -100, -100, -100, -100, -100,
      ],
    ];
    const wb = makeWorkbook(aoa);
    const result = parseSoplSheet(wb, 'SOPL', XLSX);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].code).toBe('901-01');
    expect(result.lines[0].accountType).toBe('expense');
    // Sign flipped: raw -1200 displayed → stored as +1200 (amount spent).
    expect(result.lines[0].plannedAnnual).toBe(1200);
    expect(result.warnings).toHaveLength(0);
  });

  it('silently skips 4xx / 5xx / 8xx codes (AZ informational rows in SOPL)', () => {
    // ZTP mixes quantity metrics (501 Məhsul miqdarı, 502 Yarımfabrikat
    // miqdarı) into the P&L sheet. Not P&L items — skip quietly.
    const aoa: (string | number | null)[][] = [
      [
        'KOD', 'MADDƏ',
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
        'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
      ],
      ['501', 'Məhsul miqdarı (ton)', 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200],
      ['801-01', 'AZ reserve-adjustment', 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
      ['601-04', 'Məhsul satışı', 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
    ];
    const wb = makeWorkbook(aoa);
    const result = parseSoplSheet(wb, 'SOPL', XLSX);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].code).toBe('601-04');
    expect(result.warnings).toHaveLength(0); // silent skip, not a warning
  });

  it('silently skips numeric-looking garbage in the code column', () => {
    // ZTP-style SOPL sheets have prior-year value columns that can leak into
    // the code column depending on layout. Anything that doesn't match the
    // SAP-KOD regex (digits-and-hyphens only) is treated as non-code and
    // skipped quietly — not a warning, because these aren't user errors.
    const aoa: (string | number | null)[][] = [
      [
        'KOD', 'MADDƏ',
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
        'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
      ],
      ['8776.41', 'garbage from a value column', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      ['-4948682.96', 'also garbage', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      ['601-04', 'Məhsul satışı', 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
    ];
    const wb = makeWorkbook(aoa);
    const result = parseSoplSheet(wb, 'SOPL', XLSX);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].code).toBe('601-04');
    expect(result.warnings).toHaveLength(0); // NOT warnings — silent skip
    expect(result.skippedRowCount).toBe(2);
  });

  it('fails gracefully on a sheet without a "Yanvar" header', () => {
    const aoa: (string | number | null)[][] = [['no', 'header', 'here']];
    const wb = makeWorkbook(aoa);
    const result = parseSoplSheet(wb, 'SOPL', XLSX);
    expect(result.lines).toEqual([]);
    expect(result.warnings[0].reason).toMatch(/Yanvar/);
  });

  it('parses numeric strings (xlsx occasionally stringifies numbers)', () => {
    const aoa: (string | number | null)[][] = [
      [
        'KOD', 'MADDƏ',
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
        'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
      ],
      [
        '601-01', 'Test',
        '100', '200', '300', '400', '500', '600',
        '700', '800', '900', '1000', '1100', '1200',
      ] as unknown as (string | number | null)[],
    ];
    const wb = makeWorkbook(aoa);
    const result = parseSoplSheet(wb, 'SOPL', XLSX);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].plannedAnnual).toBe(7800);
  });
});

describe('matchRollupLabel', () => {
  it('matches top-level rollup labels to accountType + synthetic code', () => {
    expect(matchRollupLabel('GƏLİRLƏR')).toEqual({
      accountType: 'revenue',
      code: 'ROLLUP-REVENUE',
    });
    expect(matchRollupLabel('SATIŞIN MAYA DƏYƏRİ')).toEqual({
      accountType: 'cogs',
      code: 'ROLLUP-COGS',
    });
    expect(matchRollupLabel('ÜMUMİ VƏ İNZİBATİ XƏRCLƏR')).toEqual({
      accountType: 'expense',
      code: 'ROLLUP-OPEX-GA',
    });
    expect(matchRollupLabel('AMORTİZASİYA XƏRCLƏRİ')).toEqual({
      accountType: 'expense',
      code: 'ROLLUP-OPEX-DEPRECIATION',
    });
  });

  it('returns null for computed / summary labels that should be skipped', () => {
    expect(matchRollupLabel('MƏCMU GƏLİR')).toBeNull();
    expect(matchRollupLabel('EBITDA')).toBeNull();
    expect(matchRollupLabel('Məcmu gəlir ( % )')).toBeNull();
    expect(matchRollupLabel('')).toBeNull();
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(matchRollupLabel('  gəlirlər  ')?.accountType).toBe('revenue');
  });
});

describe('parseSummaryRollupSheet', () => {
  function makeWorkbook(aoa: (string | number | null)[][]): XLSX.WorkBook {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '5-2');
    return wb;
  }

  it('extracts annual rollup values from the target entity column', () => {
    const aoa: (string | number | null)[][] = [
      [null, 'AZERTEXNOLAYN MMC-NIN 2026', null, null, null, null],
      // Row 2: header — entity names
      [' Gəlir/xərc maddələri', 'Azertexnolayn', null, 'Mərkəz', 'DBZ', 'PMZ'],
      // Row 3: revenue rollup
      ['GƏLİRLƏR', 162269256, null, 10653246, 110249184, 28713024],
      // Row 4: cogs (negative for display)
      ['SATIŞIN MAYA DƏYƏRİ', -114712755, null, -2400, -76825284, -22019133],
      // Row 5: computed — should be skipped
      ['MƏCMU GƏLİRLƏR', 47556500, null, 10650846, 33423900, 6693890],
      // Row 6: computed — should be skipped
      ['Məcmu gəlir ( % )', 0.293, null, 0.999, 0.303, 0.233],
      // Row 7: other revenue
      ['DİGƏR GƏLİRLƏR', 150067.8, null, 150067.8, 0, 0],
      // Row 8: G&A opex
      ['ÜMUMİ VƏ İNZİBATİ XƏRCLƏR', -14994381, null, -7852893, -10127624, -2998213],
      // Row 9: marketing
      ['SATIŞ , MARKETİNQ VƏ PAYLAŞDIRMA', -4645212, null, -1495193, -3100134, -703335],
      // Row 10: other opex
      ['DİGƏR XƏRCLƏR', -5649930, null, -357650, -3752324, -951654],
      // Row 11: EBITDA — computed, skip
      ['EBITDA', 22417043, null, 1095176, 16443816, 2040687],
    ];
    const wb = makeWorkbook(aoa);
    const result = parseSummaryRollupSheet(wb, '5-2', 'Mərkəz', XLSX);

    expect(result.warnings).toEqual([]);
    // 6 rollup rows matched (revenue, other-revenue, cogs, ga, marketing, other-opex)
    expect(result.lines).toHaveLength(6);

    const rev = result.lines.find((l) => l.code === 'ROLLUP-REVENUE');
    expect(rev?.plannedAnnual).toBe(10653246);
    expect(rev?.accountType).toBe('revenue');

    const cogs = result.lines.find((l) => l.code === 'ROLLUP-COGS');
    // Sign flipped from -2400 → +2400 (same convention as leaf SOPL)
    expect(cogs?.plannedAnnual).toBe(2400);
    expect(cogs?.accountType).toBe('cogs');

    const ga = result.lines.find((l) => l.code === 'ROLLUP-OPEX-GA');
    expect(ga?.plannedAnnual).toBe(7852893);
    expect(ga?.accountType).toBe('expense');

    // perMonth is an even 1/12 split — not monthly detail
    expect(rev?.perMonth).toHaveLength(12);
    expect(rev?.perMonth[0]).toBeCloseTo(10653246 / 12);
  });

  it('warns and returns empty when target column is missing', () => {
    const aoa: (string | number | null)[][] = [
      [null, null],
      [' Gəlir/xərc maddələri', 'Azertexnolayn'],
      ['GƏLİRLƏR', 1000],
    ];
    const wb = makeWorkbook(aoa);
    const result = parseSummaryRollupSheet(wb, '5-2', 'NonExistentEntity', XLSX);
    expect(result.lines).toEqual([]);
    expect(result.warnings[0].reason).toMatch(/not found/);
  });

  it('silently skips rows where the target column value is null or zero', () => {
    const aoa: (string | number | null)[][] = [
      [null, null, null],
      [' Gəlir/xərc maddələri', 'Azertexnolayn', 'Mərkəz'],
      ['GƏLİRLƏR', 1000, 500], // valid
      ['SATIŞIN MAYA DƏYƏRİ', -200, null], // null → skip
      ['DİGƏR GƏLİRLƏR', 50, 0], // zero → skip
    ];
    const wb = makeWorkbook(aoa);
    const result = parseSummaryRollupSheet(wb, '5-2', 'Mərkəz', XLSX);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].code).toBe('ROLLUP-REVENUE');
    expect(result.skippedRowCount).toBeGreaterThan(0);
  });

});

describe('dedupeParentRollups', () => {
  function line(code: string, accountType: 'revenue' | 'cogs' | 'expense' | 'asset' | 'liability' | 'equity', amount: number) {
    return {
      code,
      label: code,
      accountType,
      plannedAnnual: amount,
      perMonth: Array.from({ length: 12 }, () => amount / 12),
    } as const;
  }

  it('drops parent when any leaf child exists and children sum to parent (within tolerance)', () => {
    // LLS-shaped: 721-02 (total 679k) + children summing to 632k — diff 47k
    // is ~7% of parent which EXCEEDS the 1% tolerance → this should produce
    // a synthetic unallocated row, not a silent drop. Tested separately.
    // Here we use children that sum to EXACTLY the parent to assert the
    // safe-drop path.
    const input = [
      line('721-02', 'expense', 632000),
      line('721-02-01', 'expense', 545000),
      line('721-02-02', 'expense', 87000),
      line('601-04', 'revenue', 1000000),
    ];
    const { kept, dropped, synthetic } = dedupeParentRollups(input);
    expect(kept.map((l) => l.code).sort()).toEqual(['601-04', '721-02-01', '721-02-02']);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].code).toBe('721-02');
    expect(synthetic).toHaveLength(0);
  });

  it('keeps standalone leaves with no descendants', () => {
    const input = [
      line('601-04', 'revenue', 1000),
      line('701-01', 'cogs', 300),
      line('771-01', 'expense', 50),
    ];
    const { kept, dropped, synthetic } = dedupeParentRollups(input);
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(0);
    expect(synthetic).toHaveLength(0);
  });

  it('treats a `.R` cost-center suffix as a separate dimension, not a hierarchy level', () => {
    // AzerSheker: PLF.05 = Head Office, PLF.05.R = Region (mirror hierarchy,
    // same labels). The `.R` codes must NOT nest under the Head-Office tree.
    const input = [
      line('PLF.05', 'expense', 100),
      line('PLF.05.01', 'expense', 60),
      line('PLF.05.02', 'expense', 40),
      line('PLF.05.R', 'expense', 200),
      line('PLF.05.01.R', 'expense', 150),
      line('PLF.05.02.R', 'expense', 50),
    ];

    // WITHOUT the option: `.R` codes are wrongly read as children of PLF.05 /
    // PLF.05.01 → parents don't reconcile → synthetic unallocated rows (the bug).
    expect(dedupeParentRollups(input).synthetic.length).toBeGreaterThan(0);

    // WITH the option: Head Office and Region each reconcile on their own → both
    // parents safe-drop, the four leaves kept, no synthetic unallocated.
    const fixed = dedupeParentRollups(input, { costCenterSuffixes: ['.R'] });
    expect(fixed.kept.map((l) => l.code).sort()).toEqual([
      'PLF.05.01',
      'PLF.05.01.R',
      'PLF.05.02',
      'PLF.05.02.R',
    ]);
    expect(fixed.dropped.map((l) => l.code).sort()).toEqual(['PLF.05', 'PLF.05.R']);
    expect(fixed.synthetic).toHaveLength(0);
  });

  it('handles 3-level hierarchy — drops both levels of parents when reconciled', () => {
    // `721` = 700 (children 721-02 = 700 ✓). `721-02` = 700 (children sum
    // 500+200 = 700 ✓). Both reconcile inside tolerance → both parents drop.
    const input = [
      line('721', 'expense', 700),
      line('721-02', 'expense', 700),
      line('721-02-01', 'expense', 500),
      line('721-02-02', 'expense', 200),
    ];
    const { kept, dropped, synthetic } = dedupeParentRollups(input);
    expect(kept.map((l) => l.code).sort()).toEqual(['721-02-01', '721-02-02']);
    expect(dropped.map((l) => l.code).sort()).toEqual(['721', '721-02']);
    expect(synthetic).toHaveLength(0);
  });

  it('does not treat similarly-prefixed codes as parent/child (601-04 vs 601-99)', () => {
    // `601-04` is NOT a parent of `601-99`; both are leaves under an
    // (absent) `601` category. Dedup must not collapse sibling leaves.
    const input = [
      line('601-04', 'revenue', 100),
      line('601-99', 'revenue', 50),
    ];
    const { kept, dropped } = dedupeParentRollups(input);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it('does not treat non-dash suffixes as children (721 vs 721A vs 72102)', () => {
    // Dash is the sole hierarchy separator. `721A` and `72102` are NOT
    // children of `721` — they're different codes that happen to start with
    // the same digits.
    const input = [
      line('721', 'expense', 500),
      line('721A', 'expense', 100),
      line('72102', 'expense', 50),
    ];
    const { kept, dropped, synthetic } = dedupeParentRollups(input);
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(0);
    expect(synthetic).toHaveLength(0);
  });

  it('is a no-op when only the parent exists (no leaves to sum)', () => {
    // Edge case: a workbook that only lists the parent (no children rows).
    // The parent IS the authoritative value here — keep it.
    const input = [line('721-02', 'expense', 679000)];
    const { kept, dropped, synthetic } = dedupeParentRollups(input);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
    expect(synthetic).toHaveLength(0);
  });

  it('isolates parents-with-children from parents-without-children in the same set', () => {
    // `721-02` has children → drop (after reconcile). `721-04` has no
    // children → keep as-is. Both must be handled in the same pass.
    const input = [
      line('721-02', 'expense', 500),
      line('721-02-01', 'expense', 500),
      line('721-04', 'expense', 150),
    ];
    const { kept, dropped } = dedupeParentRollups(input);
    expect(kept.map((l) => l.code).sort()).toEqual(['721-02-01', '721-04']);
    expect(dropped.map((l) => l.code)).toEqual(['721-02']);
  });

  it('reconciliation — children UNDER parent → inject synthetic __UNALLOCATED__ for the delta', () => {
    // Parent 1000, children sum 800 → delta 200 must be preserved as a
    // synthetic leaf so finance data isn't lost. 200/1000 = 20% > 1%
    // tolerance → triggers synthetic path.
    const input: ReturnType<typeof line>[] = [
      {
        code: '721-02',
        label: 'Personnel total',
        accountType: 'expense',
        plannedAnnual: 1000,
        perMonth: Array.from({ length: 12 }, () => 1000 / 12),
      },
      line('721-02-01', 'expense', 500),
      line('721-02-02', 'expense', 300),
    ];
    const { kept, dropped, synthetic } = dedupeParentRollups(input);
    // Parent dropped, 2 leaves kept, 1 synthetic leaf injected.
    expect(kept).toHaveLength(3);
    const synCode = '721-02-__UNALLOCATED__';
    expect(kept.map((l) => l.code).sort()).toEqual(['721-02-01', '721-02-02', synCode]);
    const syn = kept.find((l) => l.code === synCode)!;
    expect(syn.plannedAnnual).toBe(200);
    expect(syn.accountType).toBe('expense');
    expect(syn.label).toContain('unallocated');
    expect(syn.perMonth.reduce((s, v) => s + v, 0)).toBeCloseTo(200, 6);
    expect(dropped.map((l) => l.code)).toEqual(['721-02']);
    expect(synthetic.map((s) => s.code)).toEqual([synCode]);
  });

  it('reconciliation — children OVER parent → synthetic __UNALLOCATED__ captures the negative delta', () => {
    // Parent 800, children sum 1000 → delta -200. Finance-visible: children
    // list is larger than the parent stated, suggesting an over-budgeted
    // sub-line or a signed-amount workbook oddity. Preserve the -200.
    const input = [
      line('721-02', 'expense', 800),
      line('721-02-01', 'expense', 600),
      line('721-02-02', 'expense', 400),
    ];
    const { kept, synthetic } = dedupeParentRollups(input);
    const syn = kept.find((l) => l.code === '721-02-__UNALLOCATED__');
    expect(syn).toBeDefined();
    expect(syn!.plannedAnnual).toBe(-200);
    expect(synthetic).toHaveLength(1);
  });

  it('reconciliation — tiny rounding difference stays within tolerance (no synthetic)', () => {
    // Parent 100, children 99.995 — delta 0.005 is below max(1, 1%) = 1.
    // Safe to drop the parent.
    const input = [
      line('721-02', 'expense', 100),
      line('721-02-01', 'expense', 99.995),
    ];
    const { synthetic, dropped } = dedupeParentRollups(input);
    expect(synthetic).toHaveLength(0);
    expect(dropped.map((l) => l.code)).toEqual(['721-02']);
  });

  it('sparse hierarchy — grandparent without intermediate parent reconciles against leaf grandchild', () => {
    // Workbook lists `721` and `721-02-01` but NOT `721-02`. Without
    // topmost-descendant logic, `721` would reconcile against the transitive
    // sum (including both levels) and mis-trigger a synthetic row. Correct
    // behavior: `721-02-01` is the topmost descendant of `721` in this set,
    // so `721` reconciles against just that leaf.
    const input = [line('721', 'expense', 500), line('721-02-01', 'expense', 500)];
    const { kept, dropped, synthetic } = dedupeParentRollups(input);
    expect(kept.map((l) => l.code)).toEqual(['721-02-01']);
    expect(dropped.map((l) => l.code)).toEqual(['721']);
    expect(synthetic).toHaveLength(0);
  });
});

describe('parseSoplSheet — parent/child double-count dedup', () => {
  function makeWorkbook(aoa: (string | number | null)[][]): XLSX.WorkBook {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SOPL');
    return wb;
  }

  it('drops parent 721-02 when 721-02-01/02 leaves are present (LLS shape)', () => {
    // Header row shape mirrors the existing "LLS-shaped SOPL" test: col 3 is
    // the label column (`GƏLİR/XƏRC MADDƏLƏRİ`), code col defaults to
    // labelCol-2 = 1 via the fallback path.
    const aoa: (string | number | null)[][] = [
      [
        null, null, null, 'GƏLİR/XƏRC MADDƏLƏRİ', '46022',
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
        'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
      ],
      // Revenue leaf (no children)
      [null, '601-04', null, 'Satış', 0,
        100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
      ],
      // Parent rollup — sum equals children, would double-count
      [null, '721-02', null, 'Heyət xərcləri', 0,
        -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50,
      ],
      // Leaf child
      [null, '721-02-01', null, 'Əmək haqqı', 0,
        -40, -40, -40, -40, -40, -40, -40, -40, -40, -40, -40, -40,
      ],
      // Leaf child
      [null, '721-02-02', null, 'DSMF', 0,
        -10, -10, -10, -10, -10, -10, -10, -10, -10, -10, -10, -10,
      ],
    ];
    const wb = makeWorkbook(aoa);
    const result = parseSoplSheet(wb, 'SOPL', XLSX);

    const codes = result.lines.map((l) => l.code).sort();
    expect(codes).toEqual(['601-04', '721-02-01', '721-02-02']);
    expect(result.parentRollupsDropped).toHaveLength(1);
    expect(result.parentRollupsDropped[0].code).toBe('721-02');
    // Dropped rows count toward skippedRowCount so the script log matches
    // visible sheet rowcount.
    expect(result.skippedRowCount).toBeGreaterThanOrEqual(1);

    // OpEx sum = 40+10 = 50/month × 12 = 600, NOT 50+40+10 = 100/month (1200).
    const opexAnnual = result.lines
      .filter((l) => l.accountType === 'expense')
      .reduce((s, l) => s + l.plannedAnnual, 0);
    expect(opexAnnual).toBe(600);
  });
});
