/**
 * AI Data Mapper — CLI proof-of-concept.
 *
 * Usage:
 *   npx tsx scripts/test-ai-mapper.ts <file.xlsx> [sheetName] [--industry=<code>]
 *
 * Example:
 *   npx tsx scripts/test-ai-mapper.ts \
 *     "/Users/rashadrahimov/Documents/budgets azmade/rev6 - 2026 Budget - LLS.xlsx" \
 *     SOPL --industry=services
 *
 *   npx tsx scripts/test-ai-mapper.ts \
 *     "/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx" \
 *     "P&L" --industry=industrial
 *
 * Reads xlsx, extracts columns + samples, calls Anthropic Claude, prints
 * the proposed mapping + anomalies. Does NOT write to DB. Pure POC.
 *
 * Requires `ANTHROPIC_API_KEY` in env.
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import { extractMapperInput } from '../src/lib/onboarding/ai-mapper/extract';
import { runMapper } from '../src/lib/onboarding/ai-mapper/mapper';
import { hasAnthropicKey } from '../src/lib/ai/client';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error(
      'Usage: npx tsx scripts/test-ai-mapper.ts <file.xlsx> [sheetName] [--industry=<code>]',
    );
    process.exit(1);
  }

  if (!hasAnthropicKey()) {
    console.error(
      'ANTHROPIC_API_KEY not set. Add to .env or export it before running.',
    );
    process.exit(1);
  }

  const filePath = args[0];
  let sheetName: string | undefined;
  let industry: string | undefined;
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--industry=')) {
      industry = arg.slice('--industry='.length);
    } else if (!arg.startsWith('--')) {
      sheetName = arg;
    }
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  if (!fs.statSync(filePath).isFile()) {
    console.error(`Not a regular file: ${filePath}`);
    process.exit(1);
  }

  console.log(`\nReading workbook: ${filePath}`);
  const wb = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false });
  const targetSheet = sheetName ?? wb.SheetNames[0];
  if (!wb.SheetNames.includes(targetSheet)) {
    console.error(
      `Sheet "${targetSheet}" not found. Available: ${wb.SheetNames.join(', ')}`,
    );
    process.exit(1);
  }
  console.log(`Target sheet: "${targetSheet}"`);
  console.log(`Industry context: ${industry ?? '<none>'}\n`);

  const inputResult = extractMapperInput(wb, targetSheet, XLSX, {
    sourceFile: path.basename(filePath),
    companyName: path.basename(filePath, path.extname(filePath)),
    industry,
  });
  if ('error' in inputResult) {
    console.error(`Extraction failed: ${inputResult.error}`);
    process.exit(1);
  }

  console.log(
    `Extracted ${inputResult.columns.length} columns, ${inputResult.sampleRows.length} sample rows.`,
  );
  console.log('Calling Claude…\n');

  const t0 = Date.now();
  let proposal;
  try {
    proposal = await runMapper(inputResult);
  } catch (err) {
    console.error(`AI Mapper failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`╔══ AI MAPPER PROPOSAL ════════════════════════════════════════╗`);
  console.log(`Time: ${elapsed}s`);
  if (proposal.usage) {
    console.log(`Tokens: in=${proposal.usage.inputTokens} out=${proposal.usage.outputTokens}`);
  }
  console.log(`Overall confidence: ${proposal.overallConfidence.toFixed(2)}`);
  console.log(`\nSummary:\n  ${proposal.summary}`);

  console.log(`\n── Column mapping (${proposal.columns.length} cols) ──`);
  for (const c of proposal.columns) {
    const conf = c.confidence.toFixed(2);
    const flag = c.confidence < 0.6 ? ' ⚠️ ' : '   ';
    console.log(
      `${flag}Col ${String(c.sourceIndex).padStart(2)} → ${c.role.padEnd(18)} (${conf}) — ${c.reasoning}`,
    );
  }

  if (proposal.accountTypeOverrides && proposal.accountTypeOverrides.length > 0) {
    console.log(`\n── Account-type overrides (${proposal.accountTypeOverrides.length}) ──`);
    for (const a of proposal.accountTypeOverrides.slice(0, 10)) {
      console.log(
        `  ${a.code.padEnd(14)} → ${a.accountType.padEnd(10)} (${a.confidence.toFixed(2)}) — ${a.reasoning}`,
      );
    }
    if (proposal.accountTypeOverrides.length > 10) {
      console.log(`  …(+${proposal.accountTypeOverrides.length - 10} more)`);
    }
  }

  console.log(`\n── Anomalies (${proposal.anomalies.length}) ──`);
  if (proposal.anomalies.length === 0) {
    console.log('  ✓ No anomalies flagged');
  } else {
    for (const a of proposal.anomalies) {
      const sev = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : 'ℹ️ ';
      const rowStr = a.row !== null ? `R${a.row}` : 'sheet';
      console.log(`  ${sev} [${rowStr}] ${a.category}: ${a.description}`);
    }
  }

  console.log(`\n╚══════════════════════════════════════════════════════════════╝\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
