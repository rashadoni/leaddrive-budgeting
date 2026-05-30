/**
 * Task 8 — financial-correctness integration test (LIVE DB).
 *
 * Opt-in via RUN_DB_INTEGRATION=1 (NOT DATABASE_URL — vitest auto-loads .env,
 * so DATABASE_URL is always set; gating on it would run this under the
 * sandboxed test-gate where localhost:5432 is unreachable and break the gate).
 * Run: set -a; source .env; set +a; RUN_DB_INTEGRATION=1 npx vitest run \
 *   src/lib/risk/scenario-rederive.integration.test.ts
 *
 * Asserts STRUCTURAL invariants (robust to data drift), not exact numbers:
 *   - simulateByDrivers performs NO DB writes (period IV count unchanged)
 *   - INPUT_COST_30 worsens ≥1 indicator + does NOT improve the holding
 *   - baseline values equal the persisted on-screen IV values
 */
import { describe, it, expect } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createPrismaDataSource } from '@/lib/risk/recompute'
import { simulateByDrivers } from '@/lib/risk/scenario-rederive'

const RUN = process.env.RUN_DB_INTEGRATION === '1'
const d = RUN ? describe : describe.skip

d('simulateByDrivers — financial correctness (live DB)', () => {
  const prisma = new PrismaClient()
  const period = '2026'

  async function load(code: string) {
    const org = await prisma.organization.findFirstOrThrow()
    const scenario = await prisma.scenario.findFirstOrThrow({ where: { organizationId: org.id, code } })
    const companies = await prisma.company.findMany({
      where: { organizationId: org.id },
      select: { id: true, code: true, name: true, parentCompanyId: true, industry: true },
    })
    const indicators = (
      await prisma.indicatorDefinition.findMany({
        where: { isActive: true },
        select: { id: true, code: true, formula: true, thresholds: true, requiredInputs: true, weight: true },
      })
    ).map((i) => ({ ...i, requiredInputs: i.requiredInputs ?? [], weight: i.weight ?? null }))
    const rows = await prisma.indicatorValue.findMany({
      where: { organizationId: org.id, period },
      select: { companyId: true, indicatorId: true, value: true, status: true, inputs: true },
    })
    const revByCo = new Map<string, number>()
    for (const r of rows) {
      const rev = (r.inputs as { resolved?: { revenue?: unknown } } | null)?.resolved?.revenue
      if (typeof rev === 'number' && rev > (revByCo.get(r.companyId) ?? -Infinity)) revByCo.set(r.companyId, rev)
    }
    return {
      org,
      scenario,
      companies: companies.map((c) => ({ ...c, code: c.code ?? c.id, revenue: revByCo.get(c.id) ?? 0 })),
      indicators,
      baselineIVs: rows.map((iv) => ({ companyId: iv.companyId, indicatorId: iv.indicatorId, value: iv.value, status: iv.status as never })),
    }
  }

  it('INPUT_COST_30: NO writes, worsens ≥1, holding does not improve, baseline==persisted', async () => {
    const { org, scenario, companies, indicators, baselineIVs } = await load('INPUT_COST_30')
    const countBefore = await prisma.indicatorValue.count({ where: { organizationId: org.id, period } })

    const r = await simulateByDrivers(createPrismaDataSource(prisma), {
      organizationId: org.id,
      scenario: { code: scenario.code, overrides: scenario.overrides },
      period,
      companies,
      indicators,
      baselineIVs,
    })

    const countAfter = await prisma.indicatorValue.count({ where: { organizationId: org.id, period } })
    expect(countAfter).toBe(countBefore) // NO DB writes

    expect(r.worsened).toBeGreaterThan(0)
    if (r.holdingBaselineScore != null && r.holdingScenarioScore != null) {
      expect(r.holdingScenarioScore).toBeLessThanOrEqual(r.holdingBaselineScore + 1) // +1 rounding tolerance
      expect(r.holdingBaselineScore - r.holdingScenarioScore).toBeLessThanOrEqual(40) // material but not absurd
    }

    // baseline == persisted on-screen value (delta starts from the real number)
    const byKey = new Map(baselineIVs.map((iv) => [`${iv.companyId}:${iv.indicatorId}`, iv.value]))
    for (const dlt of r.deltas.slice(0, 50)) {
      const persisted = byKey.get(`${dlt.companyId}:${dlt.indicatorId}`)
      if (persisted != null && dlt.baselineValue != null) expect(dlt.baselineValue).toBeCloseTo(persisted, 6)
    }
  }, 180_000)

  it('AZN_DEVAL_20: NO writes + holding does not improve', async () => {
    const { org, scenario, companies, indicators, baselineIVs } = await load('AZN_DEVAL_20')
    const countBefore = await prisma.indicatorValue.count({ where: { organizationId: org.id, period } })
    const r = await simulateByDrivers(createPrismaDataSource(prisma), {
      organizationId: org.id,
      scenario: { code: scenario.code, overrides: scenario.overrides },
      period,
      companies,
      indicators,
      baselineIVs,
    })
    const countAfter = await prisma.indicatorValue.count({ where: { organizationId: org.id, period } })
    expect(countAfter).toBe(countBefore)
    if (r.holdingBaselineScore != null && r.holdingScenarioScore != null) {
      expect(r.holdingScenarioScore).toBeLessThanOrEqual(r.holdingBaselineScore + 1)
    }
  }, 180_000)
})
