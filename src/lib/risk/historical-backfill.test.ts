/**
 * Phase 7.E phase 3 follow-up — sub-42 prerequisite #2 closure (sub-44).
 *
 * Tests for `historical-backfill.ts` pure helpers driving the
 * `scripts/backfill-historical-ivs.ts` CLI. Covers: --years arg parsing
 * (happy path + 6 failure modes); --companies/--codes CSV parsing
 * (happy path + dedupe + empty + non-string); cartesian builder
 * (shape + ordering); dry-run plan formatter (no-codes-filter +
 * codes-filter + sample-truncation branches).
 *
 * Why this file matters: the CLI wraps `runRecomputeForCompanies`
 * (sub-44 prereq #1 trigger) for historical periods. Without these
 * tests, a typo in --years parsing could silently expand to ALL years
 * the validator accepts (2000-2200) → 200× recompute cost, OR collapse
 * to zero years → silent no-op the user thinks succeeded. Both failure
 * modes are loud at script-CLI time when the parsing helpers throw.
 */

import { describe, it, expect } from 'vitest';
import {
  parseBackfillCli,
  parseYearArg,
  parseCsvArg,
  buildAffectedFromCartesian,
  formatDryRunPlan,
} from './historical-backfill';

describe('parseYearArg (sub-42 prereq #2)', () => {
  it('parses single year', () => {
    expect(parseYearArg('2025')).toEqual({ ok: true, years: [2025] });
  });

  it('parses CSV of years and returns sorted ascending', () => {
    expect(parseYearArg('2025,2024,2026')).toEqual({
      ok: true,
      years: [2024, 2025, 2026],
    });
  });

  it('trims whitespace around tokens', () => {
    expect(parseYearArg('  2025 , 2024  ')).toEqual({
      ok: true,
      years: [2024, 2025],
    });
  });

  it('dedupes silently (explicit duplicate is harmless)', () => {
    expect(parseYearArg('2025,2025,2024')).toEqual({
      ok: true,
      years: [2024, 2025],
    });
  });

  it('rejects empty string', () => {
    const r = parseYearArg('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/non-empty/);
  });

  it('rejects pure-comma input (zero tokens after split+trim)', () => {
    const r = parseYearArg(', , ,');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/zero tokens/);
  });

  it('rejects non-integer tokens (decimal)', () => {
    const r = parseYearArg('2025.5');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not a plain integer/);
  });

  it('rejects non-integer tokens (alpha)', () => {
    const r = parseYearArg('twentytwentyfive');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not a plain integer/);
  });

  it('rejects non-integer tokens (scientific notation)', () => {
    // "2e3" looks integer-ish but tests the strict regex gate. Without
    // the gate, Number("2e3") === 2000, which would silently backfill
    // year 2000 instead of erroring on the typo.
    const r = parseYearArg('2e3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not a plain integer/);
  });

  it('rejects out-of-range years', () => {
    const tooLow = parseYearArg('1899');
    expect(tooLow.ok).toBe(false);
    const tooHigh = parseYearArg('2201');
    expect(tooHigh.ok).toBe(false);
    if (!tooLow.ok) expect(tooLow.reason).toMatch(/out of plausible range/);
  });

  it('first-failure short-circuit — does NOT bury later errors', () => {
    // Locks "fails on first bad token" semantic — if the helper
    // accumulated all errors, ops would have to scroll past good years
    // to find the bad one. First-failure-loud is the expected UX.
    const r = parseYearArg('2025,bogus,2024');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('bogus');
  });
});

describe('parseCsvArg (sub-42 prereq #2)', () => {
  it('parses CSV of tokens and returns sorted+dedupe', () => {
    expect(parseCsvArg('AAC-MAIN,ZTP-MAIN')).toEqual({
      ok: true,
      tokens: ['AAC-MAIN', 'ZTP-MAIN'],
    });
  });

  it('trims whitespace + drops empties + dedupes', () => {
    expect(parseCsvArg('AAC-MAIN, , ZTP-MAIN ,AAC-MAIN')).toEqual({
      ok: true,
      tokens: ['AAC-MAIN', 'ZTP-MAIN'],
    });
  });

  it('returns empty tokens for undefined (no-filter sentinel)', () => {
    expect(parseCsvArg(undefined)).toEqual({ ok: true, tokens: [] });
  });

  it('returns empty tokens for purely-whitespace input', () => {
    expect(parseCsvArg('  , ,  ')).toEqual({ ok: true, tokens: [] });
  });

  it('rejects non-string input (defensive against caller passing parsed Number)', () => {
    const r = parseCsvArg(42 as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expected string/);
  });
});

describe('buildAffectedFromCartesian (sub-42 prereq #2)', () => {
  it('produces (companyId × year) cartesian, companyId-then-year-stable order', () => {
    const out = buildAffectedFromCartesian(['co_a', 'co_b'], [2025, 2026]);
    expect(out).toEqual([
      { companyId: 'co_a', year: 2025 },
      { companyId: 'co_a', year: 2026 },
      { companyId: 'co_b', year: 2025 },
      { companyId: 'co_b', year: 2026 },
    ]);
  });

  it('returns [] when companies is empty', () => {
    expect(buildAffectedFromCartesian([], [2025])).toEqual([]);
  });

  it('returns [] when years is empty', () => {
    expect(buildAffectedFromCartesian(['co_a'], [])).toEqual([]);
  });

  it('preserves caller-provided iteration order (no resort) for determinism', () => {
    // Caller has full control over per-company ordering; the helper
    // doesn't touch it. Ops can prioritize specific cos (e.g.
    // industrial first) by ordering the input.
    const out = buildAffectedFromCartesian(['z_last', 'a_first'], [2024]);
    expect(out.map((p) => p.companyId)).toEqual(['z_last', 'a_first']);
  });
});

describe('formatDryRunPlan (sub-42 prereq #2)', () => {
  it('renders header + counts + years + companies sample (no-codes-filter branch)', () => {
    const plan = formatDryRunPlan({
      orgSlug: 'azmade',
      companies: [
        { id: 'co_a', code: 'A-CO' },
        { id: 'co_b', code: 'B-CO' },
      ],
      years: [2025, 2026],
      codes: [],
    });
    expect(plan).toContain('DRY-RUN');
    expect(plan).toContain('Org: azmade');
    expect(plan).toContain('2 operational companies × 2 years = 4 (company × year) pairs');
    expect(plan).toContain('Years: 2025, 2026');
    expect(plan).toContain(
      'Indicator codes: (no filter — full catalog per industry)',
    );
    expect(plan).toContain('Companies: A-CO, B-CO');
    expect(plan).toContain('No DB writes');
  });

  it('renders codes-filter line when codes provided', () => {
    const plan = formatDryRunPlan({
      orgSlug: 'azmade',
      companies: [{ id: 'co_a', code: 'A-CO' }],
      years: [2025],
      codes: ['IND_NET_MARGIN', 'IND_GROSS_MARGIN'],
    });
    expect(plan).toContain(
      'Indicator codes filter: IND_NET_MARGIN, IND_GROSS_MARGIN',
    );
    // No-filter copy MUST NOT appear when codes are supplied.
    expect(plan).not.toContain('(no filter');
  });

  it('truncates company sample to 10 entries with "+N more" suffix', () => {
    const companies = Array.from({ length: 15 }, (_, i) => ({
      id: `co_${i}`,
      code: `C${String(i).padStart(2, '0')}`,
    }));
    const plan = formatDryRunPlan({
      orgSlug: 'azmade',
      companies,
      years: [2025],
      codes: [],
    });
    expect(plan).toContain('C00, C01, C02, C03, C04, C05, C06, C07, C08, C09 (+5 more)');
    // Ensure the C10..C14 entries did NOT leak into the rendered list
    // (otherwise the truncation is a lie).
    expect(plan).not.toContain('C14');
  });

  it('singular grammar branches — 1 company × 1 year = 1 pair (no plural s)', () => {
    const plan = formatDryRunPlan({
      orgSlug: 'azmade',
      companies: [{ id: 'co_a', code: 'A' }],
      years: [2025],
      codes: [],
    });
    expect(plan).toContain('1 operational company × 1 year = 1 (company × year) pair');
    // Double-check NO trailing plural "s" leaked through
    expect(plan).not.toContain('1 operational companies');
    expect(plan).not.toContain('× 1 years');
    expect(plan).not.toContain('= 1 (company × year) pairs');
  });
});

// ─── Sub-44 prereq #2 cont'd — parseBackfillCli architect ⚠️ closure ─────
// The CLI parser is a pure fn; previously inlined in the script (uncovered).
// These tests lock the input-validation surface so a typo in --years vs
// --year (no s) or a missing required arg fails LOUD at CLI time instead
// of silently no-op'ing.

describe("parseBackfillCli (sub-44 prereq #2 cont'd)", () => {
  it('parses minimal required args: --org + --years', () => {
    const r = parseBackfillCli(['--org=azmade', '--years=2025']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.args.orgSlug).toBe('azmade');
      expect(r.args.yearsRaw).toBe('2025');
      expect(r.args.companiesRaw).toBeUndefined();
      expect(r.args.codesRaw).toBeUndefined();
      expect(r.args.dryRun).toBe(false);
    }
  });

  it('parses all flags together — --org + --years + --companies + --codes + --dry-run', () => {
    const r = parseBackfillCli([
      '--org=azmade',
      '--years=2025,2024',
      '--companies=AAC-MAIN,ZTP-MAIN',
      '--codes=IND_NET_MARGIN,IND_GROSS_MARGIN',
      '--dry-run',
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.args).toEqual({
        orgSlug: 'azmade',
        yearsRaw: '2025,2024',
        companiesRaw: 'AAC-MAIN,ZTP-MAIN',
        codesRaw: 'IND_NET_MARGIN,IND_GROSS_MARGIN',
        dryRun: true,
      });
    }
  });

  it('flag order does not matter (--dry-run can appear before --org)', () => {
    const r = parseBackfillCli(['--dry-run', '--years=2025', '--org=azmade']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.dryRun).toBe(true);
  });

  it('rejects missing --org with explicit reason', () => {
    const r = parseBackfillCli(['--years=2025']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/--org=<slug> is required/);
  });

  it('rejects missing --years with explicit reason', () => {
    const r = parseBackfillCli(['--org=azmade']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/--years=/);
  });

  it('rejects unknown flag — load-bearing typo guard (--year vs --years)', () => {
    // The architect-flagged case: a caller writing `--year=2025` (no s)
    // instead of `--years=2025` MUST fail loudly. Without the unknown-
    // flag check, this would land as silent "missing --years".
    const r = parseBackfillCli(['--org=azmade', '--year=2025']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Unknown flag/);
      expect(r.reason).toContain('--year=2025');
    }
  });

  it('rejects unknown flag with leading dash but no value (--frobnicate)', () => {
    const r = parseBackfillCli(['--org=azmade', '--years=2025', '--frobnicate']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('--frobnicate');
  });

  it('trims --org= value (whitespace tolerance)', () => {
    const r = parseBackfillCli(['--org=  azmade  ', '--years=2025']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.orgSlug).toBe('azmade');
  });

  it('treats empty --org= as missing (whitespace-only after trim)', () => {
    // Edge case: `--org=` with empty value should be the same as not
    // providing it at all. Without this, the script could fetch with
    // slug=='' and silently fail at the org lookup with a less specific
    // error.
    const r = parseBackfillCli(['--org=   ', '--years=2025']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/--org=<slug> is required/);
  });

  it('rejects empty --years= the same as missing --years (no semantic gap)', () => {
    // `!yearsRaw` catches both `undefined` (flag not present) and `''`
    // (flag present with empty value). Functionally equivalent — the
    // user gave no year info either way. Locks the no-semantic-gap
    // invariant so a future refactor that switches to `yearsRaw ===
    // undefined` doesn't accidentally let `--years=` slip through to
    // parseYearArg with a less helpful error message.
    const r = parseBackfillCli(['--org=azmade', '--years=']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/--years=/);
  });

  it('multi-occurrence of same flag uses last-wins (documented behavior)', () => {
    const r = parseBackfillCli([
      '--org=first-org',
      '--years=2025',
      '--org=last-org',
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.orgSlug).toBe('last-org');
  });

  it('positional args without leading dash are silently ignored', () => {
    // Tolerant of stray tokens — e.g. shell passing through a space-
    // separated value after `--years=2025`. They land here as
    // positional. Silently skip rather than rejecting (no CLI we
    // forward to today, so positional has no semantic).
    const r = parseBackfillCli(['--org=azmade', 'random-positional', '--years=2025']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.orgSlug).toBe('azmade');
  });

  it('empty argv returns missing-org error first (consistent ordering)', () => {
    const r = parseBackfillCli([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/--org=/);
  });
});
