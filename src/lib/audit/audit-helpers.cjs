/**
 * Pure helpers extracted from `scripts/audit-company.cjs` (F1 closure).
 *
 * The CLI script is top-level CJS with no exported surface — to unit-test
 * the drift/sanity-band logic we hoist the pure functions + tables here.
 * The script `require`s this module; tests `require` it from vitest.
 *
 * Keep CommonJS (`module.exports = ...`) so the script can stay CJS without
 * a compile step. Vitest + tsconfig (`allowJs`, `esModuleInterop`,
 * `moduleResolution: bundler`) resolves `.cjs` imports from `.ts` test files
 * without further configuration.
 */
const xlsx = require('xlsx');

// ── Sheet name resolution per child company code ────────────────────────────
const SHEET_MAP = {
  'AZSEKER-EDEN': 'PL_EDEN',
  'AZSEKER-AZSF': 'PLF_AZSF',
  'AZSEKER-CPC': 'PLF_CPC',
  'AZSEKER-FARM': 'PLF_Farm',
  'AZSEKER-HORIZON': null,
  'AAC-MAIN': null,
  'ATL-DBZ': null,
  'ATL-MRKZ': null,
  'ATL-PMZ': null,
  'ATL-TAZ': null,
  'SPARK-MAIN': null,
  'ZTP-MAIN': null,
  'LLS-MAIN': null,
};

// ── Industry-specific indicators we expect to exist ─────────────────────────
const INDICATORS_BY_INDUSTRY = {
  agro_crops: ['IND_REVENUE_TOTAL', 'IND_GROSS_MARGIN', 'IND_NET_MARGIN',
               'IND_OPEX_RATIO', 'IND_COGS_INTENSITY', 'IND_OPEX_TO_COGS',
               'IND_OPERATING_LEVERAGE', 'AGRO_YIELD', 'AGRO_DROUGHT_RISK',
               'AGRO_COMMODITY_VOL', 'AGRO_YIELD_PER_HA', 'AGRO_SUGAR_CONTENT'],
  food_processing: ['IND_REVENUE_TOTAL', 'IND_GROSS_MARGIN', 'IND_NET_MARGIN',
                    'IND_OPEX_RATIO', 'IND_COGS_INTENSITY', 'IND_OPEX_TO_COGS',
                    'IND_OPERATING_LEVERAGE', 'FP_YIELD_LOSS', 'FP_GROSS_MARGIN',
                    'FP_INVENTORY_TURNS', 'FP_OPEX_RATIO', 'FP_EXTRACTION_RATE'],
  services: ['IND_REVENUE_TOTAL', 'IND_GROSS_MARGIN', 'IND_NET_MARGIN',
             'IND_OPEX_RATIO', 'IND_COGS_INTENSITY', 'IND_OPEX_TO_COGS',
             'SVC_GROSS_MARGIN', 'SVC_NET_MARGIN', 'SVC_OPEX_RATIO',
             'SVC_COGS_INTENSITY', 'SVC_REVENUE_CONCENTRATION'],
  industrial: ['IND_REVENUE_TOTAL', 'IND_GROSS_MARGIN', 'IND_NET_MARGIN',
               'IND_OPEX_RATIO', 'IND_COGS_INTENSITY', 'IND_OPEX_TO_COGS',
               'IND_OPERATING_LEVERAGE'],
  hospitality: ['IND_REVENUE_TOTAL', 'IND_GROSS_MARGIN', 'IND_NET_MARGIN',
                'IND_OPEX_RATIO', 'HOSP_OCC', 'HOSP_REVPAR', 'HOSP_ADR',
                'HOSP_FX_EXPOSURE', 'HOSP_SOURCE_HHI'],
};

// ── Sanity bands per industry → indicator → expected range ─────────────────
const SANITY_BANDS = {
  agro_crops: {
    IND_GROSS_MARGIN: [5, 60],
    IND_NET_MARGIN: [-30, 40],
    IND_OPEX_RATIO: [10, 80],
    IND_COGS_INTENSITY: [40, 90],
  },
  food_processing: {
    IND_GROSS_MARGIN: [10, 50],
    IND_NET_MARGIN: [-20, 35],
    IND_OPEX_RATIO: [10, 60],
    IND_COGS_INTENSITY: [40, 85],
    FP_GROSS_MARGIN: [10, 50],
  },
  services: {
    IND_GROSS_MARGIN: [20, 90],
    IND_NET_MARGIN: [-10, 50],
    IND_OPEX_RATIO: [20, 90],
    SVC_GROSS_MARGIN: [20, 90],
  },
  industrial: {
    IND_GROSS_MARGIN: [5, 40],
    IND_NET_MARGIN: [-20, 30],
    IND_OPEX_RATIO: [10, 60],
    IND_COGS_INTENSITY: [40, 85],
  },
  hospitality: {
    IND_GROSS_MARGIN: [30, 85],
    HOSP_OCC: [20, 95],
  },
};

// ── PLF line definitions to extract from each entity sheet ──────────────────
const PLF_LINES = [
  { plfCode: 'PLF.01', label: 'REVENUE',                sign: +1 },
  { plfCode: 'PLF.02', label: 'COST OF GOODS SOLD',     sign: -1 },
  { plfCode: 'PLF.03', label: 'GROSS PROFIT',           sign: +1 },
  { plfCode: 'PLF.04', label: 'Sales & Marketing',      sign: -1 },
  { plfCode: 'PLF.05', label: 'Administrative',         sign: -1 },
  { plfCode: 'PLF.06', label: 'Other operating exp.',   sign: -1 },
  { plfCode: 'PLF.07', label: 'EBITDA',                 sign: +1 },
  { plfCode: 'PLF.08', label: 'D&A',                    sign: -1 },
  { plfCode: 'PLF.10', label: 'NET PROFIT (LOSS)',      sign: +1 },
];

// ── Drift classifier ────────────────────────────────────────────────────────
function classifyDrift(driftPct) {
  const abs = Math.abs(driftPct);
  if (abs < 0.01) return 'match';
  if (abs < 1.0) return 'drift_minor';
  return 'drift_major';
}

// ── Sanity band classifier ──────────────────────────────────────────────────
function classifySanityBand(industry, indicatorCode, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'missing_input';
  const bands = SANITY_BANDS[industry] && SANITY_BANDS[industry][indicatorCode];
  if (!bands) return 'no_band';
  const [low, high] = bands;
  if (value < low) return 'low_extreme';
  if (value > high) return 'high_extreme';
  return 'normal';
}

// ── xlsx extractor: 12-month sum for a given PLF code ──────────────────────
function extractAnnualFromSheet(sheet, plfCode) {
  if (!sheet || !sheet['!ref']) return null;
  const range = xlsx.utils.decode_range(sheet['!ref']);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (const codeCol of [0, 1]) {
      const cell = sheet[xlsx.utils.encode_cell({ r, c: codeCol })];
      if (cell && String(cell.v).trim() === plfCode) {
        let monthlySum = 0;
        for (let c = 3; c <= 14; c++) {
          const mc = sheet[xlsx.utils.encode_cell({ r, c })];
          if (mc && typeof mc.v === 'number') monthlySum += mc.v;
        }
        return Math.round(monthlySum * 100) / 100;
      }
    }
  }
  return null;
}

// ── Argument parsing ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

// ── Verdict resolver ────────────────────────────────────────────────────────
// Extracted from auditOne so the verdict ordering can be unit-tested without
// a live Prisma client / xlsx. `checks` is the array pushed inside auditOne;
// `sanity` is the result.sanity map keyed by indicator code.
function computeVerdict(checks, sanity) {
  const hasMajorDrift = checks.some((c) => c.class === 'drift_major');
  const hasMissingDb = checks.some((c) => c.class === 'db_missing');
  const hasSuspicious = Object.values(sanity).some(
    (v) => typeof v === 'object' && (v.band === 'low_extreme' || v.band === 'high_extreme'),
  );
  const hasMissingIv = Object.values(sanity).some((v) => v === 'missing_iv');
  if (hasMajorDrift) return 'drift_major';
  if (hasSuspicious) return 'suspicious';
  if (hasMissingDb || hasMissingIv) return 'partial';
  return 'verified';
}

module.exports = {
  SHEET_MAP,
  INDICATORS_BY_INDUSTRY,
  SANITY_BANDS,
  PLF_LINES,
  classifyDrift,
  classifySanityBand,
  extractAnnualFromSheet,
  parseArgs,
  computeVerdict,
};
