// One-shot fixture generator — produces a minimal valid xlsx for E2E.
// Hidden filename (`.gen-fixture.ts`) so vitest's testMatch + Next.js
// route discovery both ignore it. Run via:
//   npx tsx e2e/fixtures/.gen-fixture.ts
// Re-run only when fixture content needs to change.
import * as XLSX from 'xlsx';
import * as path from 'node:path';

const data = [
  ['Code', 'Label', 'Total', 'Plan', 'Actual'],
  ['601-04', 'Revenue — Sales', 1000000, 1100000, 1050000],
  ['701-01', 'COGS — Materials', -400000, -440000, -420000],
  ['801-01', 'OpEx — Salaries', -200000, -220000, -210000],
  ['801-02', 'OpEx — Rent', -50000, -55000, -52000],
];
const ws = XLSX.utils.aoa_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'P&L');
const out = path.resolve(__dirname, 'test-budget.xlsx');
XLSX.writeFile(wb, out);
console.log('Wrote', out);
