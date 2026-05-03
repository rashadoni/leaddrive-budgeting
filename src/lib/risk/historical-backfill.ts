/**
 * Phase 7.E phase 3 follow-up — sub-42 prerequisite #2 closure (sub-44).
 *
 * Pure helpers for the historical-IV backfill script
 * (`scripts/backfill-historical-ivs.ts`). Extracted here so the CLI
 * tail stays thin (parse-args → call helpers → call
 * `runRecomputeForCompanies`) and the load-bearing parsing logic is
 * unit-testable without a Prisma + LaunchAgent stack.
 *
 * The motivating use case: indicators like `IND_NET_MARGIN_VS_2025`
 * (formula: `... - fact("IND_NET_MARGIN", "2025")`) require the
 * referenced 2025 IND_NET_MARGIN IVs to exist in DB. Today's
 * recompute pipeline runs at the current period only; historical
 * periods need a one-shot CLI to populate the baseline.
 *
 * Pattern: the script translates `--years=2025,2024` into an
 * `affected: Array<{companyId, year}>` array (cartesian over
 * operational cos × requested years), then delegates to
 * `runRecomputeForCompanies(prisma, orgId, affected, logger)`. The
 * trigger handles industry-filtering + per-year scoping + parent-co
 * rollup (sub-44 prereq #1) automatically — the script doesn't
 * reimplement that logic.
 */

/**
 * Parse a CSV-of-years CLI arg into a sorted, dedupe'd, validated number[].
 *
 * Accepts:  "2025,2024"  →  [2024, 2025]
 *           "2025"       →  [2025]
 *           "  2025 , 2024  "  → trims whitespace
 *
 * Rejects: empty string, non-numeric tokens, years out of plausible
 *          range (1900..2200 — wide enough for fiscal-year edge cases
 *          + financial-history backfills, narrow enough to catch typos).
 *
 * Returns `{ ok: true, years }` on success, `{ ok: false, reason }` on
 * first parse failure. Strict layer-up (loud at CLI parse time) — runtime
 * recompute is downstream and would surface NaN periods as silent
 * status='unknown' otherwise.
 */
export type YearArgParseResult =
  | { ok: true; years: number[] }
  | { ok: false; reason: string };

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

export function parseYearArg(raw: string): YearArgParseResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: '--years requires a non-empty value (e.g. --years=2025 or --years=2025,2024)' };
  }
  const tokens = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (tokens.length === 0) {
    return { ok: false, reason: `--years="${raw}" parsed to zero tokens (only commas / whitespace)` };
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (const t of tokens) {
    // Strict integer parse — reject "2025.5" / "2025e3" / "0x07e9".
    if (!/^-?\d+$/.test(t)) {
      return { ok: false, reason: `--years token "${t}" is not a plain integer` };
    }
    const n = Number(t);
    if (!Number.isInteger(n)) {
      return { ok: false, reason: `--years token "${t}" did not parse as integer` };
    }
    if (n < MIN_YEAR || n > MAX_YEAR) {
      return {
        ok: false,
        reason: `--years token "${t}" out of plausible range [${MIN_YEAR}..${MAX_YEAR}]`,
      };
    }
    if (seen.has(n)) continue; // de-dupe silently — explicit duplicate is harmless
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return { ok: true, years: out };
}

/**
 * Parse a CSV-of-tokens CLI arg into a sorted, dedupe'd, trimmed string[].
 * Used for --companies and --codes filters.
 *
 * Accepts: "AAC-MAIN,ZTP-MAIN" → ["AAC-MAIN", "ZTP-MAIN"]
 *          "AAC-MAIN, , ZTP-MAIN ,AAC-MAIN" → trims whitespace, dedupes,
 *                                              skips empty tokens
 *
 * Returns `{ ok: true, tokens }` on success. Empty input parses to
 * `{ ok: true, tokens: [] }` rather than failing — callers interpret
 * `tokens.length === 0` as "no filter applied" (process all).
 *
 * Rejects only when the raw arg is non-string. A purely-comma-and-
 * whitespace string yields tokens=[] (silent no-op filter).
 */
export type CsvArgParseResult =
  | { ok: true; tokens: string[] }
  | { ok: false; reason: string };

export function parseCsvArg(raw: string | undefined): CsvArgParseResult {
  if (raw === undefined || raw === null) return { ok: true, tokens: [] };
  if (typeof raw !== 'string') {
    return {
      ok: false,
      reason: `expected string, got ${typeof raw}`,
    };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const t = part.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  out.sort();
  return { ok: true, tokens: out };
}

/**
 * Build the `affected: Array<{companyId, year}>` payload that
 * `runRecomputeForCompanies` consumes from a list of operational-co
 * IDs × requested years (cartesian). Order is companyId-then-year-
 * stable so logger output is reproducible across runs.
 *
 * Pure / no DB. Caller fetches the operational-co list (with optional
 * --companies filter applied) + supplies the parsed years; this
 * function just shapes the cartesian.
 */
export function buildAffectedFromCartesian(
  companyIds: readonly string[],
  years: readonly number[],
): Array<{ companyId: string; year: number }> {
  const out: Array<{ companyId: string; year: number }> = [];
  for (const id of companyIds) {
    for (const y of years) {
      out.push({ companyId: id, year: y });
    }
  }
  return out;
}

// ─── CLI arg-shape parser (extracted sub-44 prereq #2 cont'd architect ⚠️) ─
// Keeps the script thin (parse → fetch → delegate) and lets the input-
// validation surface get unit-test coverage without spawning the script.

/** Parsed CLI arg shape. `companiesRaw` / `codesRaw` are optional (filter
 *  modes); `dryRun` defaults to false. Raw strings are NOT yet validated —
 *  they pass through `parseYearArg` / `parseCsvArg` downstream. */
export interface BackfillCliArgs {
  orgSlug: string;
  yearsRaw: string;
  companiesRaw?: string;
  codesRaw?: string;
  dryRun: boolean;
}

export type BackfillCliParseResult =
  | { ok: true; args: BackfillCliArgs }
  | { ok: false; reason: string };

/**
 * Parse CLI argv (already sliced to drop `node` + script-path entries).
 *
 * Recognized flags:
 *   --org=<slug>            REQUIRED
 *   --years=<csv>           REQUIRED
 *   --companies=<csv>       optional
 *   --codes=<csv>           optional
 *   --dry-run               optional bool
 *
 * Failure modes — each returns `{ ok: false, reason }`:
 *   - any flag starting with `-` not in the known-flag set → "Unknown flag: ..."
 *     (catches typos like `--year=2025` instead of `--years=2025`)
 *   - missing `--org=` → "--org=<slug> is required"
 *   - missing `--years=` → "--years=<year[,year...]> is required"
 *
 * Positional args (no leading `-`) are silently ignored — keeps the parser
 * tolerant of a future `--` separator usage. Multi-occurrence of the same
 * flag uses last-wins (the loop overwrites). Empty `--org=` is accepted at
 * this layer but `.trim()`'d — empty-after-trim falls through to the
 * required-flag check.
 */
export function parseBackfillCli(argv: readonly string[]): BackfillCliParseResult {
  let orgSlug: string | undefined;
  let yearsRaw: string | undefined;
  let companiesRaw: string | undefined;
  let codesRaw: string | undefined;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--org=')) {
      orgSlug = arg.slice('--org='.length).trim();
    } else if (arg.startsWith('--years=')) {
      yearsRaw = arg.slice('--years='.length);
    } else if (arg.startsWith('--companies=')) {
      companiesRaw = arg.slice('--companies='.length);
    } else if (arg.startsWith('--codes=')) {
      codesRaw = arg.slice('--codes='.length);
    } else if (arg.startsWith('-')) {
      return { ok: false, reason: `Unknown flag: ${arg}` };
    }
  }
  if (!orgSlug) return { ok: false, reason: '--org=<slug> is required' };
  if (!yearsRaw) {
    return {
      ok: false,
      reason: '--years=<year[,year...]> is required (e.g. --years=2025 or --years=2025,2024)',
    };
  }
  return {
    ok: true,
    args: { orgSlug, yearsRaw, companiesRaw, codesRaw, dryRun },
  };
}

/**
 * Format a dry-run plan summary for stdout. Shape designed for ops
 * legibility — group counts on top, per-target sample below if the
 * cartesian is small enough to enumerate.
 *
 * Pure (no console.log) so callers can route the output (test capture,
 * file write, etc).
 */
export function formatDryRunPlan(input: {
  orgSlug: string;
  companies: ReadonlyArray<{ id: string; code: string }>;
  years: readonly number[];
  codes: readonly string[];
}): string {
  const { orgSlug, companies, years, codes } = input;
  const lines: string[] = [];
  lines.push('DRY-RUN: backfill-historical-ivs would compute:');
  lines.push(`  Org: ${orgSlug}`);
  lines.push(
    `  ${companies.length} operational ${companies.length === 1 ? 'company' : 'companies'} × ${years.length} year${years.length === 1 ? '' : 's'} = ${companies.length * years.length} (company × year) pair${companies.length * years.length === 1 ? '' : 's'}`,
  );
  lines.push(`  Years: ${years.join(', ')}`);
  if (codes.length === 0) {
    lines.push('  Indicator codes: (no filter — full catalog per industry)');
  } else {
    lines.push(`  Indicator codes filter: ${codes.join(', ')}`);
  }
  // Sample first 10 companies for visibility.
  if (companies.length > 0) {
    const sample = companies.slice(0, 10).map((c) => c.code).join(', ');
    const more = companies.length > 10 ? ` (+${companies.length - 10} more)` : '';
    lines.push(`  Companies: ${sample}${more}`);
  }
  lines.push('  No DB writes will occur. Drop --dry-run to execute.');
  return lines.join('\n');
}
