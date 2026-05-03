/**
 * Phase 7.E phase 3 follow-up — sub-42 prerequisite #2 closure (sub-44).
 *
 * Drives `runRecomputeForCompanies` for HISTORICAL periods to populate
 * the IVs that `fact()`-using indicators reference.
 *
 * Motivating use case: indicator `IND_NET_MARGIN_VS_2025` (formula:
 * `(net_income / revenue * 100) - fact("IND_NET_MARGIN", "2025")`) needs
 * the referenced 2025 IND_NET_MARGIN IVs to exist in DB. The live
 * recompute pipeline runs at the current period only — without this
 * script the indicator returns NaN forever.
 *
 * Pattern: the script translates `--years=2025,2024` into a per-year
 * `affected: Array<{companyId, year}>` payload, then delegates to
 * `runRecomputeForCompanies`. The trigger handles industry-filtering +
 * per-year scoping + parent-co rollup (sub-44 prereq #1) automatically.
 *
 * Usage:
 *   npx tsx scripts/backfill-historical-ivs.ts --org=azmade --years=2025
 *   npx tsx scripts/backfill-historical-ivs.ts --org=azmade --years=2025,2024
 *   npx tsx scripts/backfill-historical-ivs.ts --org=azmade --years=2025 --dry-run
 *   npx tsx scripts/backfill-historical-ivs.ts --org=azmade --years=2025 --companies=AAC-MAIN,ZTP-MAIN
 *
 * Cost shape: same as a full live recompute pass per year. AZMADE
 * current scale (44 cos × ~9 indicators each ≈ 400 pairs) finishes in
 * ~30 seconds against local Postgres per year. At Phase F (60 cos × ~80
 * indicators ≈ 4800 pairs) projected ~5 min per year sequential.
 *
 * Side effects: writes IndicatorValue rows for each (company × indicator
 * × year) tuple. Idempotent (upsert semantics via the engine). Audit-
 * logging is already built into `runRecomputeForCompanies` callers; this
 * script's run path mirrors `scripts/import-azmade-budgets.ts` and
 * inherits the same audit profile (none for the script itself — these
 * are admin-driven backfills, not user-attributable events).
 *
 * Phase 7.G follow-up (per CARRYOVER 🔄): wrap into a BullMQ recurring
 * job once Redis infra lands. Today: invoked manually after data
 * migrations / when seeding new fact()-using indicators that need
 * historical baselines.
 */

import { PrismaClient } from '@prisma/client';
import { runRecomputeForCompanies } from '../src/lib/risk/recompute-trigger';
import {
  parseYearArg,
  parseCsvArg,
  buildAffectedFromCartesian,
  formatDryRunPlan,
} from '../src/lib/risk/historical-backfill';

interface CliArgs {
  orgSlug: string;
  yearsRaw: string;
  companiesRaw?: string;
  codesRaw?: string;
  dryRun: boolean;
}

function parseCli(argv: readonly string[]): { ok: true; args: CliArgs } | { ok: false; reason: string } {
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

async function main(): Promise<void> {
  // Drop the `node`+`tsx`+script-path entries — argv[0] = node, argv[1] =
  // script path; pass the rest. Works with both `npx tsx` and `node --loader`.
  const cliResult = parseCli(process.argv.slice(2));
  if (!cliResult.ok) {
    console.error(`✗ ${cliResult.reason}`);
    console.error('');
    console.error('Usage:');
    console.error('  npx tsx scripts/backfill-historical-ivs.ts --org=<slug> --years=<year[,year...]>');
    console.error('    [--dry-run] [--companies=<code[,code...]>] [--codes=<code[,code...]>]');
    process.exit(1);
  }
  const { orgSlug, yearsRaw, companiesRaw, codesRaw, dryRun } = cliResult.args;

  // Parse + validate args via pure helpers — fail loud at CLI time
  // before any DB hit.
  const yearsResult = parseYearArg(yearsRaw);
  if (!yearsResult.ok) {
    console.error(`✗ ${yearsResult.reason}`);
    process.exit(1);
  }
  const companiesResult = parseCsvArg(companiesRaw);
  if (!companiesResult.ok) {
    console.error(`✗ --companies parse error: ${companiesResult.reason}`);
    process.exit(1);
  }
  const codesResult = parseCsvArg(codesRaw);
  if (!codesResult.ok) {
    console.error(`✗ --codes parse error: ${codesResult.reason}`);
    process.exit(1);
  }
  const years = yearsResult.years;
  const companyFilter = companiesResult.tokens;
  const codeFilter = codesResult.tokens;

  const prisma = new PrismaClient();
  try {
    // Resolve org by slug.
    const org = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, slug: true },
    });
    if (!org) {
      console.error(`✗ Organization not found by slug: ${orgSlug}`);
      process.exit(1);
    }

    // Fetch operational cos (level=2 + isActive). The recompute trigger
    // applies its own `filterOperationalCompanies` filter inside, but
    // we pre-filter here so the dry-run plan can show ops-cos-only.
    const operationalCos = await prisma.company.findMany({
      where: {
        organizationId: org.id,
        isActive: true,
        level: 2,
        ...(companyFilter.length > 0 && { code: { in: companyFilter } }),
      },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });

    if (operationalCos.length === 0) {
      console.error(
        `✗ No operational companies found for org=${orgSlug}` +
          (companyFilter.length > 0
            ? ` matching --companies=${companyFilter.join(',')}`
            : ''),
      );
      process.exit(1);
    }

    if (dryRun) {
      console.log(
        formatDryRunPlan({
          orgSlug: org.slug,
          companies: operationalCos,
          years,
          codes: codeFilter,
        }),
      );
      // The --codes filter is honored by the trigger's
      // `preferOrgScopedDefinitions` step (selects all defs, then the
      // engine narrows). Surfacing in the plan is for ops visibility;
      // the trigger doesn't accept a code-filter arg today, so this is
      // a future v2 hook (the script could fetch defs + filter manually
      // and pass via a forthcoming `runRecomputeForCompanies({codes})`
      // option). Document the limitation:
      if (codeFilter.length > 0) {
        console.log(
          '  ℹ NOTE: --codes filter is informational only in v1 — runRecomputeForCompanies fetches the full per-industry catalog. Future v2 will plumb the filter through.',
        );
      }
      return;
    }

    // Build the per-year affected payload + delegate to the trigger.
    const affected = buildAffectedFromCartesian(
      operationalCos.map((c) => c.id),
      years,
    );
    console.log(
      `Backfill: ${operationalCos.length} cos × ${years.length} year${years.length === 1 ? '' : 's'} = ${affected.length} (co × year) pairs ` +
        `for org=${org.slug}` +
        (companyFilter.length > 0 ? ` (--companies filter: ${companyFilter.join(',')})` : '') +
        (codeFilter.length > 0 ? ` (--codes informational only in v1)` : ''),
    );

    const result = await runRecomputeForCompanies(prisma, org.id, affected, {
      start: (m) => console.log(`  ${m}`),
      pairError: (label, err) => console.error(`  ✗ ${label}: ${err instanceof Error ? err.message : String(err)}`),
      done: (m) => console.log(`  ${m}`),
      noop: (m) => console.log(`  ⚠ ${m}`),
    });
    console.log(
      `✓ Backfill complete: ok=${result.ok} unknown=${result.unknown} failed=${result.failed} (over ${result.targets} targets)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('✗ Fatal error in backfill-historical-ivs:', err);
  process.exit(1);
});
