/**
 * Phase B2 (Bloomberg uplift plan) — sparkline batch computation worker.
 *
 * Iterates every existing IndicatorValue row, computes a 12-slot
 * trailing-month sparkline using the same `buildContext` resolver
 * pipeline as live recompute, and updates the row's `sparkline` JSON
 * column. Idempotent — re-running produces identical output (modulo
 * underlying budget/booking changes).
 *
 * --- Phase 7.E phase 2 (2026-04-30) -----------------------------------------
 * `recomputeIndicator()` now also wires `computeSparkline` inline when called
 * with `withSparkline:true` (single-IV interactive recomputes via
 * `POST /api/indicators` with both `companyId` + `indicatorCode`). This
 * script remains the canonical refresher for two paths:
 *   1. Backfill of IVs created BEFORE phase 2 (sparkline=[] from the original
 *      first-write default).
 *   2. Bulk holding-wide refresh — period-only recomputes + xlsx-import
 *      follow-up (recompute-trigger.ts) intentionally skip inline sparkline
 *      to fit the 60s function budget; this script catches them up.
 *
 * Usage:
 *   npx tsx scripts/compute-sparklines.ts                 # all orgs, current state
 *   npx tsx scripts/compute-sparklines.ts --orgSlug=azmade
 *   npx tsx scripts/compute-sparklines.ts --orgSlug=azmade --indicatorCode=IND_NET_MARGIN
 *   npx tsx scripts/compute-sparklines.ts --dry-run       # compute, don't persist
 *
 * Phase F follow-up (per CARRYOVER 🔄): wrap this into a BullMQ recurring
 * job (or Postgres pg_cron) once Redis infra lands. Today: invoked
 * manually OR via `npm run sparklines:refresh` shortcut after large
 * imports.
 *
 * Cost shape: each indicator × company × 12 months = 12 buildContext()
 * round-trips. At AZMADE current scale (46 IVs × 12 = 552 evaluations)
 * runs in ~4 seconds against local Postgres. At Phase F target (60 cos ×
 * ~80 indicators ≈ 4800 IVs × 12 = 57.6k evaluations) projected
 * ~30-60 minutes sequential. Acceptable for an idempotent batch job
 * that runs after large imports OR on a nightly cron. If runtime
 * becomes a constraint, swap the IV loop for chunked `Promise.all`
 * (chunks of 16 give ~16× speed-up against local Postgres without
 * triggering connection-pool saturation).
 */

import { PrismaClient } from '@prisma/client';
import {
  buildContext,
  createPrismaDataSource,
  type IndicatorDefinitionLike,
} from '../src/lib/risk/recompute';
import { parsePeriod } from '../src/lib/risk/periods';
import {
  computeSparkline,
  SPARKLINE_LENGTH,
  type IndicatorForSparkline,
} from '../src/lib/risk/sparkline';

interface CliArgs {
  orgSlug?: string;
  companyCode?: string;
  indicatorCode?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    const key = raw.slice(2, eq);
    const value = raw.slice(eq + 1);
    if (key === 'orgSlug') args.orgSlug = value;
    else if (key === 'companyCode') args.companyCode = value;
    else if (key === 'indicatorCode') args.indicatorCode = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const prisma = new PrismaClient();
  const ds = createPrismaDataSource(prisma);

  // Adapter: sparkline.ts buildContext takes period:string, recompute's
  // buildContext takes Period — bridge here.
  const adaptedBuildContext = async (a: {
    ds: typeof ds;
    organizationId: string;
    companyId: string;
    period: string;
    requiredInputs: string[];
  }) => {
    const period = parsePeriod(a.period);
    const { context } = await buildContext(a.ds, {
      organizationId: a.organizationId,
      companyId: a.companyId,
      period,
      requiredInputs: a.requiredInputs,
    });
    return { context };
  };

  // Resolve org filter — IndicatorValue has only `organizationId` scalar,
  // no `organization` relation, so look up the id first if `--orgSlug`
  // was supplied.
  let organizationId: string | undefined;
  if (args.orgSlug) {
    const org = await prisma.organization.findUnique({
      where: { slug: args.orgSlug },
      select: { id: true },
    });
    if (!org) {
      console.error(`[sparklines] org slug "${args.orgSlug}" not found`);
      await prisma.$disconnect();
      process.exit(1);
    }
    organizationId = org.id;
  }

  // Pull every IV that matches filters; join in indicator + company
  // metadata so the loop has everything it needs without N+1 fetches.
  const ivs = await prisma.indicatorValue.findMany({
    where: {
      ...(organizationId && { organizationId }),
      ...(args.companyCode && { company: { code: args.companyCode } }),
      ...(args.indicatorCode && { indicator: { code: args.indicatorCode } }),
    },
    include: {
      indicator: {
        select: {
          id: true,
          code: true,
          formula: true,
          sparklineFormula: true,
          requiredInputs: true,
        },
      },
      company: { select: { id: true, code: true } },
    },
    orderBy: [{ companyId: 'asc' }, { indicatorId: 'asc' }],
  });

  console.log(
    `[sparklines] processing ${ivs.length} IndicatorValue rows (dryRun=${args.dryRun}, sparklineLength=${SPARKLINE_LENGTH})`,
  );

  let computed = 0;
  let persisted = 0;
  let errors = 0;
  const startTime = Date.now();

  for (const iv of ivs) {
    try {
      const definition: IndicatorForSparkline = {
        id: iv.indicator.id,
        formula: iv.indicator.formula,
        sparklineFormula: iv.indicator.sparklineFormula,
        requiredInputs: iv.indicator.requiredInputs,
      };
      const sparkline = await computeSparkline(ds, {
        organizationId: iv.organizationId,
        companyId: iv.companyId,
        definition,
        anchorPeriod: iv.period,
        buildContext: adaptedBuildContext,
      });
      computed++;

      if (!args.dryRun) {
        await prisma.indicatorValue.update({
          where: { id: iv.id },
          data: { sparkline },
        });
        persisted++;
      }

      if (computed % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(
          `[sparklines] progress: ${computed}/${ivs.length} (${elapsed}s elapsed, ${errors} errors)`,
        );
      }
    } catch (err) {
      errors++;
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[sparklines] error on iv=${iv.id} co=${iv.company.code} ind=${iv.indicator.code}: ${reason}`,
      );
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[sparklines] DONE — computed=${computed}, persisted=${persisted}, errors=${errors}, elapsed=${elapsed}s`,
  );

  await prisma.$disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[sparklines] FATAL:', err);
  process.exit(2);
});
