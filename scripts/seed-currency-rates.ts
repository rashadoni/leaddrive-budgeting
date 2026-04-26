/**
 * Phase A step 1 — seed Currency + CurrencyRateHistory for every organization.
 *
 * Idempotent:
 *   - AZN (base) / USD / EUR rows upserted in `Currency` if missing.
 *   - Three history points per non-base currency (latest / -30d / -90d) so
 *     the recompute pipeline has enough data to compute point-in-time rates
 *     and eventually draw a sparkline once the sparkline resolver lands.
 *
 * Run:
 *   npx tsx scripts/seed-currency-rates.ts
 *
 * Rates used are illustrative (2026 AZN peg ≈ 1.70 USD, ≈ 1.85 EUR). Tenants
 * can override via the CRM UI once the wizard is live — this script only
 * seeds a sane baseline.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type CurrencySeed = {
  code: string;
  name: string;
  symbol: string;
  isBase: boolean;
  // AZN → 1 unit of this currency conversion factor at three points in time.
  rateNow?: number;
  rate30dAgo?: number;
  rate90dAgo?: number;
};

const CURRENCIES: CurrencySeed[] = [
  {
    code: 'AZN',
    name: 'Azerbaijani Manat',
    symbol: '₼',
    isBase: true,
  },
  {
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    isBase: false,
    rateNow: 1.7,
    rate30dAgo: 1.7,
    rate90dAgo: 1.7,
  },
  {
    code: 'EUR',
    name: 'Euro',
    symbol: '€',
    isBase: false,
    rateNow: 1.85,
    rate30dAgo: 1.82,
    rate90dAgo: 1.8,
  },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
  });
  if (orgs.length === 0) {
    console.log('No organizations found — nothing to seed.');
    return;
  }
  console.log(`Seeding currencies + rates for ${orgs.length} organization(s).`);

  let currenciesTouched = 0;
  let historyRowsInserted = 0;

  for (const org of orgs) {
    for (const seed of CURRENCIES) {
      // Upsert Currency row. Base currency keeps rate=1 always.
      await prisma.currency.upsert({
        where: {
          organizationId_code: { organizationId: org.id, code: seed.code },
        },
        create: {
          organizationId: org.id,
          code: seed.code,
          name: seed.name,
          symbol: seed.symbol,
          exchangeRate: seed.isBase ? 1 : (seed.rateNow ?? 1),
          isBase: seed.isBase,
          isActive: true,
        },
        update: {
          name: seed.name,
          symbol: seed.symbol,
          isBase: seed.isBase,
          isActive: true,
          // Don't clobber a user-edited exchangeRate if non-base; only
          // refresh base to stay at 1.
          ...(seed.isBase ? { exchangeRate: 1 } : {}),
        },
      });
      currenciesTouched += 1;

      if (seed.isBase) continue;

      // History: 3 points if not already present for that exact (code, date).
      const points: Array<{ rate: number; rateDate: Date }> = [
        { rate: seed.rateNow!, rateDate: daysAgo(0) },
        { rate: seed.rate30dAgo!, rateDate: daysAgo(30) },
        { rate: seed.rate90dAgo!, rateDate: daysAgo(90) },
      ];
      for (const p of points) {
        const existing = await prisma.currencyRateHistory.findFirst({
          where: {
            organizationId: org.id,
            currencyCode: seed.code,
            rateDate: p.rateDate,
          },
          select: { id: true },
        });
        if (existing) continue;
        await prisma.currencyRateHistory.create({
          data: {
            organizationId: org.id,
            currencyCode: seed.code,
            rate: p.rate,
            rateDate: p.rateDate,
          },
        });
        historyRowsInserted += 1;
      }
    }
    console.log(`  ~ ${org.name.padEnd(32)} processed`);
  }

  console.log('');
  console.log(
    `Done. Currency upserts: ${currenciesTouched}. History rows inserted: ${historyRowsInserted}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
