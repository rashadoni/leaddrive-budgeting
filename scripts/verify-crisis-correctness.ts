/**
 * Task 8 — financial-correctness verification (live DB, read-only, NO writes).
 * Runs simulateByDrivers for the 3 flagships and prints the holding swing +
 * per-company deltas so we can eyeball that the numbers are economically sane.
 *
 * Run: (sandbox off) set -a; source .env; set +a; npx tsx scripts/verify-crisis-correctness.ts
 */
import { prisma } from '@/lib/prisma'
import { createPrismaDataSource } from '@/lib/risk/recompute'
import { simulateByDrivers } from '@/lib/risk/scenario-rederive'
import { readShock } from '@/lib/risk/scenario-shock'
import { resolveFeedShock, resolveFeedContext, FEED_STALE_DAYS, type FeedSnapshot } from '@/lib/risk/scenario-feed-context'

const PERIOD = '2026'
const FLAGSHIPS = ['INPUT_COST_30', 'DROUGHT_2026', 'AZN_DEVAL_20', 'SUGAR_PRICE_TO_70', 'BRENT_TO_140']

async function buildFeedSnapshot(orgId: string): Promise<FeedSnapshot> {
  const [fx, intel] = await Promise.all([
    prisma.currencyRateHistory.findMany({ where: { organizationId: orgId }, orderBy: [{ currencyCode: 'asc' }, { rateDate: 'desc' }], distinct: ['currencyCode'], select: { currencyCode: true, rate: true, rateDate: true } }),
    prisma.intelDataPoint.findMany({ where: { organizationId: orgId, metric: { in: ['BRENT_USD_BBL', 'FAO_SUGAR_INDEX', 'FAO_CEREAL_INDEX'] } }, orderBy: [{ metric: 'asc' }, { datetime: 'desc' }], distinct: ['metric'], select: { metric: true, value: true, datetime: true } }),
  ])
  const nowMs = Date.now()
  const staleMs = FEED_STALE_DAYS * 86_400_000
  const snap: FeedSnapshot = {}
  for (const r of fx) snap[`AZN_${r.currencyCode}`] = { value: r.rate, asOf: r.rateDate.toISOString().slice(0, 10), stale: nowMs - r.rateDate.getTime() > staleMs }
  for (const r of intel) snap[r.metric] = { value: r.value, asOf: r.datetime.toISOString().slice(0, 10), stale: nowMs - r.datetime.getTime() > staleMs }
  return snap
}

async function load(orgId: string, code: string) {
  const scenario = await prisma.scenario.findFirstOrThrow({ where: { organizationId: orgId, code } })
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId },
    select: { id: true, code: true, name: true, parentCompanyId: true, industry: true },
  })
  const indicators = (
    await prisma.indicatorDefinition.findMany({
      where: { isActive: true },
      select: { id: true, code: true, formula: true, thresholds: true, requiredInputs: true, weight: true },
    })
  ).map((i) => ({ ...i, requiredInputs: i.requiredInputs ?? [], weight: i.weight ?? null }))
  const rows = await prisma.indicatorValue.findMany({
    where: { organizationId: orgId, period: PERIOD },
    select: { companyId: true, indicatorId: true, value: true, status: true, inputs: true },
  })
  const revByCo = new Map<string, number>()
  for (const r of rows) {
    const rev = (r.inputs as { resolved?: { revenue?: unknown } } | null)?.resolved?.revenue
    if (typeof rev === 'number' && rev > (revByCo.get(r.companyId) ?? -Infinity)) revByCo.set(r.companyId, rev)
  }
  return {
    scenario,
    companies: companies.map((c) => ({ ...c, code: c.code ?? c.id, revenue: revByCo.get(c.id) ?? 0 })),
    indicators,
    baselineIVs: rows.map((iv) => ({ companyId: iv.companyId, indicatorId: iv.indicatorId, value: iv.value, status: iv.status as never })),
  }
}

async function main() {
  const org = await prisma.organization.findFirstOrThrow()
  const ds = createPrismaDataSource(prisma)

  // Pre-count IVs for the no-writes proof.
  const ivCountBefore = await prisma.indicatorValue.count({ where: { organizationId: org.id, period: PERIOD } })
  const feedSnapshot = await buildFeedSnapshot(org.id)

  for (const code of FLAGSHIPS) {
    const { scenario, companies, indicators, baselineIVs } = await load(org.id, code)
    // Mirror the route: resolve any absolute target → fraction from the live feed.
    const rawShock = readShock(scenario.overrides)
    const resolvedShock = rawShock ? resolveFeedShock(rawShock, feedSnapshot) : null
    const anchors = rawShock ? resolveFeedContext(rawShock, feedSnapshot) : []
    const r = await simulateByDrivers(ds, {
      organizationId: org.id,
      scenario: { code: scenario.code, overrides: resolvedShock ? { shock: resolvedShock } : scenario.overrides },
      period: PERIOD,
      companies,
      indicators,
      baselineIVs,
    })
    console.log(`\n══════════ ${code} ══════════`)
    if (anchors.length) console.log(`feed anchors: ${anchors.map((a) => `${a.label} ${a.currentValue}→${a.scenarioValue} ${a.unit} (${a.asOf}${a.stale ? ' STALE' : ''})`).join(' · ')}`)
    console.log(`holding composite:  ${r.holdingBaselineScore} → ${r.holdingScenarioScore}  (Δ ${r.holdingScenarioScore != null && r.holdingBaselineScore != null ? r.holdingScenarioScore - r.holdingBaselineScore : 'n/a'})`)
    console.log(`financial health:   ${r.financialHoldingBaselineScore} → ${r.financialHoldingScenarioScore}  (Δ ${r.financialHoldingScenarioScore != null && r.financialHoldingBaselineScore != null ? r.financialHoldingScenarioScore - r.financialHoldingBaselineScore : 'n/a'})`)
    console.log(`indicators changed: ${r.changed}  (worsened ${r.worsened}, improved ${r.improved})`)
    console.log(`drift: attempted ${r.driftSummary.pairsAttempted}, errored ${r.driftSummary.pairsErrored}${r.driftSummary.lastError ? ` (last: ${r.driftSummary.lastError})` : ''}`)
    console.log('per-company composite swing:')
    for (const b of r.byCompany) {
      if (b.baselineScore == null && b.scenarioScore == null) continue
      const arrow = b.baselineScore != null && b.scenarioScore != null && b.scenarioScore !== b.baselineScore ? '  ←' : ''
      console.log(`   ${b.companyCode.padEnd(18)} ${b.baselineScore ?? '—'} → ${b.scenarioScore ?? '—'}${arrow}`)
    }
    const worsenedDeltas = r.deltas
      .filter((d) => d.changed && d.baselineStatus && d.scenarioStatus)
      .slice(0, 8)
    console.log('sample status changes (worst-first sample):')
    for (const d of worsenedDeltas) {
      console.log(`   ${d.companyCode}/${d.code}: ${d.baselineValue?.toFixed(2)} (${d.baselineStatus}) → ${d.scenarioValue?.toFixed(2)} (${d.scenarioStatus})`)
    }
  }

  const ivCountAfter = await prisma.indicatorValue.count({ where: { organizationId: org.id, period: PERIOD } })
  console.log(`\n── no-writes proof: IndicatorValue count ${ivCountBefore} → ${ivCountAfter} (${ivCountBefore === ivCountAfter ? 'UNCHANGED ✓' : 'CHANGED ✗'})`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
