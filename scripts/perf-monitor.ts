#!/usr/bin/env tsx
/**
 * DB query latency monitor (2026-06-29).
 *
 * What this is
 * ────────────
 * A read-only latency probe for the Prisma/Postgres layer. It issues two
 * classes of representative queries — LIGHT (single-row indexed lookups,
 * simple counts) and MEDIUM (the findMany/groupBy reads that the P&L,
 * indicator-matrix and smoke-test paths actually run) — times each over
 * N iterations, and compares the measured average against an expected
 * budget per query.
 *
 * Why these queries
 * ─────────────────
 * The shapes mirror production hot paths so the numbers mean something:
 *   • MEDIUM "pnl-budget-lines"  → src/app/api/budgeting/pnl/route.ts:146
 *   • MEDIUM "matrix-ivs"        → src/app/api/indicators/matrix/route.ts:77
 *   • MEDIUM "intel-groupby"     → scripts/pre-demo-smoke.ts checkStaleAdapters
 *   • MEDIUM "readiness-n+1"     → scripts/pre-demo-smoke.ts checkLowReadiness
 *   • LIGHT  "plan-findfirst"    → src/app/api/budgeting/pnl/route.ts:82
 *
 * Budgets are tuned for a LOCAL Postgres on this dataset size. They are a
 * health band, not an SLA: avg over budget = 🟡, p95 over 2× budget = 🔴.
 *
 * Usage
 * ─────
 *   npx tsx scripts/perf-monitor.ts
 *   npx tsx scripts/perf-monitor.ts --iter=50          # more samples
 *   npx tsx scripts/perf-monitor.ts --period=2026 --org=<id>
 *
 * Read-only. Never writes. Exit code: 0 green / 1 yellow / 2 red.
 */
import { PrismaClient, Prisma } from "@prisma/client"
const prisma = new PrismaClient()

// ─── config ──────────────────────────────────────────────────────────────────
const ITER =
  Number(process.argv.find((a) => a.startsWith("--iter="))?.split("=")[1]) || 25
const WARMUP = 3
const PERIOD =
  process.argv.find((a) => a.startsWith("--period="))?.split("=")[1] ??
  String(new Date().getUTCFullYear())
const ORG_ARG = process.argv.find((a) => a.startsWith("--org="))?.split("=")[1]

type Klass = "LIGHT" | "MEDIUM"
interface Probe {
  name: string
  klass: Klass
  /** expected average latency in ms (the "should take" budget) */
  budgetMs: number
  run: () => Promise<unknown>
}

// Mirror of src/app/api/budgeting/pnl/route.ts BUDGET_LINE_SELECT.
const BUDGET_LINE_SELECT = {
  companyId: true,
  department: true,
  lineType: true,
  sortOrder: true,
  monthIndex: true,
  plannedAmount: true,
  account: { select: { code: true, name: true, accountType: true } },
} satisfies Prisma.BudgetLineSelect

interface Stat {
  name: string
  klass: Klass
  budgetMs: number
  min: number
  avg: number
  p50: number
  p95: number
  max: number
  rows: number
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

async function time(fn: () => Promise<unknown>): Promise<[number, number]> {
  const t0 = performance.now()
  const out = await fn()
  const dt = performance.now() - t0
  const rows = Array.isArray(out) ? out.length : out == null ? 0 : 1
  return [dt, rows]
}

async function measure(p: Probe): Promise<Stat> {
  for (let i = 0; i < WARMUP; i++) await p.run() // warm pool + plan cache
  const samples: number[] = []
  let rows = 0
  for (let i = 0; i < ITER; i++) {
    const [dt, r] = await time(p.run)
    samples.push(dt)
    rows = r
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length
  return {
    name: p.name,
    klass: p.klass,
    budgetMs: p.budgetMs,
    min: sorted[0],
    avg,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    max: sorted[sorted.length - 1],
    rows,
  }
}

async function main(): Promise<number> {
  const org = ORG_ARG
    ? { id: ORG_ARG }
    : await prisma.organization.findFirst({ select: { id: true } })
  if (!org) throw new Error("No organization in DB. Pass --org=<id>.")
  const orgId = org.id

  // Pick the plan with the most live budget lines — that's the realistic
  // P&L target, not an empty plan.
  const planAgg = await prisma.budgetLine.groupBy({
    by: ["planId"],
    where: { organizationId: orgId, deletedAt: null },
    _count: { _all: true },
    orderBy: { _count: { planId: "desc" } },
    take: 1,
  })
  const planId = planAgg[0]?.planId ?? null

  const probes: Probe[] = [
    // ─── LIGHT ───────────────────────────────────────────────────────────────
    {
      name: "org.findFirst(id)",
      klass: "LIGHT",
      budgetMs: 8,
      run: () => prisma.organization.findFirst({ select: { id: true } }),
    },
    {
      name: "company.count(org)",
      klass: "LIGHT",
      budgetMs: 8,
      run: () => prisma.company.count({ where: { organizationId: orgId } }),
    },
    {
      name: "plan.findFirst(id) [pnl:82]",
      klass: "LIGHT",
      budgetMs: 10,
      run: () =>
        prisma.budgetPlan.findFirst({
          where: { id: planId ?? "none", organizationId: orgId, deletedAt: null },
          select: { year: true },
        }),
    },
    {
      name: "indicatorValue.count(org,period)",
      klass: "LIGHT",
      budgetMs: 12,
      run: () =>
        prisma.indicatorValue.count({
          where: { organizationId: orgId, period: PERIOD },
        }),
    },
    {
      name: "company.findMany(org) small-select",
      klass: "LIGHT",
      budgetMs: 12,
      run: () =>
        prisma.company.findMany({
          where: { organizationId: orgId },
          select: { id: true, code: true, name: true, level: true, status: true },
        }),
    },
    // ─── MEDIUM ──────────────────────────────────────────────────────────────
    {
      name: "budgetLine.findMany [pnl:146] +account",
      klass: "MEDIUM",
      budgetMs: 70,
      run: () =>
        prisma.budgetLine.findMany({
          where: { organizationId: orgId, planId: planId ?? "none", deletedAt: null },
          select: BUDGET_LINE_SELECT,
        }),
    },
    {
      name: "indicatorValue.findMany [matrix:77] +joins",
      klass: "MEDIUM",
      budgetMs: 80,
      run: () =>
        prisma.indicatorValue.findMany({
          where: { organizationId: orgId, period: PERIOD },
          select: {
            value: true,
            status: true,
            company: { select: { code: true } },
            indicator: { select: { code: true, unit: true, direction: true } },
          },
        }),
    },
    {
      name: "intelDataPoint.groupBy(sourceCode) [smoke:242]",
      klass: "MEDIUM",
      budgetMs: 50,
      run: () =>
        prisma.intelDataPoint.groupBy({
          by: ["sourceCode"],
          where: { organizationId: orgId },
          _max: { fetchedAt: true },
        }),
    },
    {
      name: "budgetActual.findMany [pnl:153]",
      klass: "MEDIUM",
      budgetMs: 50,
      run: () =>
        prisma.budgetActual.findMany({
          where: { organizationId: orgId, planId: planId ?? "none" },
          select: {
            category: true,
            department: true,
            lineType: true,
            actualAmount: true,
            expenseDate: true,
          },
        }),
    },
    {
      name: "readiness N+1 (company + per-co BL.count) [smoke:307]",
      klass: "MEDIUM",
      budgetMs: 90,
      run: async () => {
        const companies = await prisma.company.findMany({
          where: {
            organizationId: orgId,
            isActive: true,
            status: { notIn: ["pending", "archived"] },
            level: { gt: 1 },
          },
          select: { id: true, code: true },
        })
        return Promise.all(
          companies.map((c) =>
            prisma.budgetLine.count({
              where: { companyId: c.id, deletedAt: null },
            }),
          ),
        )
      },
    },
  ]

  const HR = "─".repeat(96)
  console.log(HR)
  console.log(
    `DB latency monitor · org=${orgId} · period=${PERIOD} · plan=${planId ?? "—"} · iter=${ITER} (+${WARMUP} warmup)`,
  )
  console.log(HR)

  const stats: Stat[] = []
  for (const p of probes) stats.push(await measure(p))

  // Table
  const head = `${"query".padEnd(50)}${"rows".padStart(6)}${"should".padStart(9)}${"avg".padStart(9)}${"p50".padStart(9)}${"p95".padStart(9)}${"max".padStart(9)}  verdict`
  let lastKlass = ""
  let worst: 0 | 1 | 2 = 0
  const fmt = (n: number) => `${n.toFixed(1)}ms`
  for (const s of stats) {
    if (s.klass !== lastKlass) {
      console.log("\n" + s.klass)
      console.log(head)
      lastKlass = s.klass
    }
    // verdict: avg within budget = green; avg over budget = yellow;
    // p95 over 2× budget OR avg over 2× budget = red.
    let v: 0 | 1 | 2 = 0
    if (s.avg > s.budgetMs) v = 1
    if (s.avg > s.budgetMs * 2 || s.p95 > s.budgetMs * 2) v = 2
    worst = Math.max(worst, v) as 0 | 1 | 2
    const icon = v === 0 ? "🟢" : v === 1 ? "🟡" : "🔴"
    console.log(
      s.name.padEnd(50) +
        String(s.rows).padStart(6) +
        fmt(s.budgetMs).padStart(9) +
        fmt(s.avg).padStart(9) +
        fmt(s.p50).padStart(9) +
        fmt(s.p95).padStart(9) +
        fmt(s.max).padStart(9) +
        `  ${icon}`,
    )
  }

  // Per-class roll-up
  console.log("\n" + HR)
  for (const k of ["LIGHT", "MEDIUM"] as Klass[]) {
    const g = stats.filter((s) => s.klass === k)
    const budget = g.reduce((a, s) => a + s.budgetMs, 0) / g.length
    const avg = g.reduce((a, s) => a + s.avg, 0) / g.length
    console.log(
      `${k.padEnd(8)} expected avg ≈ ${fmt(budget)}  ·  actual avg = ${fmt(avg)}  ·  ${
        avg <= budget ? "within budget 🟢" : avg <= budget * 2 ? "over budget 🟡" : "well over 🔴"
      }`,
    )
  }
  console.log(HR)
  const verdict = worst === 0 ? "🟢 GREEN" : worst === 1 ? "🟡 YELLOW" : "🔴 RED"
  console.log(`Overall: ${verdict}`)
  console.log(HR)
  return worst
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (e) => {
    console.error("[perf-monitor] failed:", e)
    await prisma.$disconnect()
    process.exit(3)
  })
