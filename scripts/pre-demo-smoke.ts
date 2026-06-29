#!/usr/bin/env tsx
/**
 * Phase 7.M Step 3 (2026-05-18) — pre-demo smoke test.
 *
 * What this is
 * ────────────
 * A read-only audit you run BEFORE any meeting with a client where
 * the Risk Terminal is on screen. It scans the DB for the six bug
 * classes that have surfaced as embarrassments in the past:
 *
 *   1. Extreme-magnitude IV values (the −$23B trade-balance class).
 *   2. Status=red on value=0 (false negatives — the threshold-classifier
 *      painted "danger" on a row where the formula returned literal 0).
 *   3. Macro-broadcast indicators where the same value appears across
 *      ≥3 companies — these dominate Top-3 Worst panels with cloned
 *      noise instead of per-company signals.
 *   4. Stale adapters — sourceCodes whose most recent fetchedAt is
 *      older than 30 days. Their IVs will look "current" on the
 *      HeatMap but are running on month-old (or older) inputs.
 *   5. Low-readiness companies (active, not pending/archived) that
 *      have <50 budget_lines. AI Variance Explainer will hallucinate
 *      on these — better to know in advance so you can either skip
 *      them in the demo or warn the client.
 *   6. Zombie cells — IV with value=0 AND status ∈ green/amber. The
 *      zombie-row guard added in Phase 7.L should keep this at 0;
 *      if it grows, the guard is leaking.
 *
 * Output
 * ──────
 *   • Per check: 🟢 OK / 🟡 warn / 🔴 critical with the offending
 *     sample rows.
 *   • Overall verdict at the bottom (worst-of all checks).
 *   • Exit code: 0 (green) / 1 (yellow) / 2 (red) so CI / scheduler
 *     can gate on it.
 *
 * Usage
 * ─────
 *   npm run smoke-test
 *   # or, for a specific org / period:
 *   DATABASE_URL=postgresql://... npx tsx scripts/pre-demo-smoke.ts \
 *     --org=<orgId> --period=2026
 *
 * The script never writes to the DB — safe to run any time.
 */
// Direct import (not `@/lib/prisma`) because the project's shared
// client re-exports as `any` to absorb a chicken-and-egg generate-
// before-deps boot scenario. For a typed script, we want the strict
// generated client.
import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

interface CheckResult {
  id: string
  title: string
  severity: "green" | "yellow" | "red"
  count: number
  message: string
  samples?: string[]
}

const NL = "\n"
const HR = "─".repeat(72)
const ICON: Record<CheckResult["severity"], string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
}

function parseArgs(): { orgId?: string; period: string } {
  const orgId = process.argv.find((a) => a.startsWith("--org="))?.split("=")[1]
  const period =
    process.argv.find((a) => a.startsWith("--period="))?.split("=")[1] ??
    String(new Date().getUTCFullYear())
  return { orgId, period }
}

async function pickOrg(explicit?: string): Promise<string> {
  if (explicit) return explicit
  const org = await prisma.organization.findFirst({ select: { id: true } })
  if (!org) throw new Error("No organization in DB. Pass --org=<id>.")
  return org.id
}

// ─── Check 1: extreme magnitudes ─────────────────────────────────────────────
async function checkExtremeMagnitudes(
  orgId: string,
  period: string,
): Promise<CheckResult> {
  // Anything whose absolute value exceeds 1e9 in an indicator denominated
  // in % / ratio / count is suspicious. Pure $-value indicators (revenue,
  // trade balance) get a higher threshold of 1e11.
  const all = await prisma.indicatorValue.findMany({
    where: { organizationId: orgId, period },
    select: {
      value: true,
      company: { select: { code: true } },
      indicator: { select: { code: true, unit: true } },
    },
  })
  const offenders = all.filter((r) => {
    const abs = Math.abs(r.value)
    if (!Number.isFinite(abs)) return true
    const unit = (r.indicator.unit ?? "").toUpperCase()
    const isMoney = /USD|AZN|EUR|MM\$|\$/.test(unit)
    return isMoney ? abs > 1e11 : abs > 1e9
  })
  return {
    id: "extreme-magnitudes",
    title: "Extreme-magnitude IV values (−$23B trade-balance class)",
    severity: offenders.length === 0 ? "green" : "red",
    count: offenders.length,
    message:
      offenders.length === 0
        ? "All IV values within plausible magnitude bands."
        : `${offenders.length} IV row(s) carry implausible magnitude — investigate before demo.`,
    samples: offenders
      .slice(0, 5)
      .map(
        (r) =>
          `  ${r.company.code.padEnd(20)} ${r.indicator.code.padEnd(34)} ${r.value.toExponential(2)} ${r.indicator.unit ?? ""}`,
      ),
  }
}

// ─── Check 2: status=red on value=0 (false negatives) ────────────────────────
async function checkFalseNegatives(
  orgId: string,
  period: string,
): Promise<CheckResult> {
  // Phase 7.M Step 4 follow-up (2026-05-19) — only flag lower_better
  // indicators. For higher_better (revenue, ESG score, NPS), value=0
  // legitimately means "worst possible" and red is the correct status —
  // not a misfire. The original check was over-eager and double-
  // counted cap-floored composite indicators.
  //
  // For lower_better (FX exposure, cost ratio, drought risk), value=0
  // means "best possible" and red would indeed contradict the data —
  // those are the real false negatives.
  const rows = await prisma.indicatorValue.findMany({
    where: { organizationId: orgId, period, value: 0, status: "red" },
    select: {
      company: { select: { code: true } },
      indicator: { select: { code: true, direction: true } },
    },
  })
  const trueFalseNegatives = rows.filter(
    (r) => r.indicator.direction === "lower_better",
  )
  return {
    id: "false-negatives",
    title: "Status=red on value=0 for lower_better (true false negative)",
    severity:
      trueFalseNegatives.length === 0
        ? "green"
        : trueFalseNegatives.length < 5
          ? "yellow"
          : "red",
    count: trueFalseNegatives.length,
    message:
      trueFalseNegatives.length === 0
        ? "No lower_better red cells with literal-zero value."
        : `${trueFalseNegatives.length} red cell(s) with value=0 on a lower_better indicator — threshold or formula is misclassifying missing data as danger.`,
    samples: trueFalseNegatives
      .slice(0, 5)
      .map((r) => `  ${r.company.code.padEnd(20)} ${r.indicator.code}`),
  }
}

// ─── Check 3: macro-broadcast pollution ──────────────────────────────────────
async function checkBroadcastPollution(
  orgId: string,
  period: string,
): Promise<CheckResult> {
  // Group IVs by (indicatorCode, value-rounded-to-6sf). Flag any bucket
  // that has ≥3 companies sharing the same value AND the value is
  // non-zero AND non-trivial (abs > 1).
  //
  // Phase 7.M Step 4 follow-up (2026-05-19) — when the rows behind a
  // bucket are ALL tagged `valueSource='macro'`, the indicator is
  // *legitimately* a country-wide broadcast (FAO, Brent, climate score,
  // etc.). The HeatMap picker already filters those out of the Top-3
  // Worst panel via `detectBroadcastIndicators` in `TodayBrief.tsx`
  // (Phase 7.L). The smoke test pre-dated that fix and was double-
  // flagging known-good macros — exclude them so the check only
  // catches *unexpected* broadcasts (indicators that broadcast
  // identical value without the `macro` tag).
  const rows = await prisma.indicatorValue.findMany({
    where: { organizationId: orgId, period },
    select: {
      value: true,
      valueSource: true,
      indicator: { select: { code: true, category: true } },
    },
  })
  const buckets = new Map<
    string,
    { count: number; sample: number; allMacro: boolean }
  >()
  for (const r of rows) {
    if (!Number.isFinite(r.value)) continue
    if (Math.abs(r.value) < 1) continue
    if (r.indicator.category === "internal") continue
    const key = `${r.indicator.code}::${r.value.toPrecision(6)}`
    const cur = buckets.get(key)
    const isMacro = r.valueSource === "macro"
    if (cur) {
      cur.count += 1
      cur.allMacro = cur.allMacro && isMacro
    } else {
      buckets.set(key, { count: 1, sample: r.value, allMacro: isMacro })
    }
  }
  const offenders: Array<{ key: string; count: number; sample: number }> = []
  for (const [key, v] of buckets) {
    // Skip bucket entirely when every IV behind it is already correctly
    // labelled as a macro broadcast — that's the expected shape, not a
    // bug.
    if (v.count >= 3 && !v.allMacro) {
      offenders.push({ key, count: v.count, sample: v.sample })
    }
  }
  offenders.sort((a, b) => b.count - a.count)
  return {
    id: "broadcast-pollution",
    title: "Untagged macro-broadcast indicators (same value on ≥3 companies, valueSource ≠ 'macro')",
    severity:
      offenders.length === 0 ? "green" : offenders.length < 3 ? "yellow" : "red",
    count: offenders.length,
    message:
      offenders.length === 0
        ? "No untagged broadcast indicators detected."
        : `${offenders.length} indicator(s) broadcast identical value across multiple companies but are NOT tagged 'macro' — either tag them or fix the formula to produce per-company values.`,
    samples: offenders
      .slice(0, 5)
      .map((o) => `  ${o.key.replace("::", " · ")}  (${o.count} companies)`),
  }
}

// ─── Check 4: stale adapters ─────────────────────────────────────────────────
async function checkStaleAdapters(orgId: string): Promise<CheckResult> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const groups = await prisma.intelDataPoint.groupBy({
    by: ["sourceCode"],
    where: { organizationId: orgId },
    _max: { fetchedAt: true },
  })
  const stale = groups.filter(
    (g) => g._max.fetchedAt && g._max.fetchedAt < cutoff,
  )
  return {
    id: "stale-adapters",
    title: "Adapters not refreshed in 30+ days",
    severity:
      stale.length === 0 ? "green" : stale.length < 3 ? "yellow" : "red",
    count: stale.length,
    message:
      stale.length === 0
        ? "All adapters fresh within 30 days."
        : `${stale.length} adapter(s) stale — schedule a re-fetch before demo.`,
    samples: stale
      .slice(0, 8)
      .map(
        (g) =>
          `  ${g.sourceCode.padEnd(28)} last fetched ${g._max.fetchedAt!.toISOString().slice(0, 10)}`,
      ),
  }
}

// ─── Check 5: low-readiness companies ────────────────────────────────────────
async function checkLowReadiness(orgId: string): Promise<CheckResult> {
  // Filter out rollup parents (level=1) — they're aggregators by design
  // and inherit their data from children via rollup() formulas. Counting
  // their own budget_lines is a false positive.
  //
  // Phase 7.M Tier 5 — also skip sales-only entities (have substantial
  // operational_facts but no P&L by design; e.g. AZSEKER-PROMALT —
  // Promalt MMC sells beer, full P&L is managed outside this workbook).
  // Threshold: ≥50 operational_facts treated as "has data, just not via
  // budget_lines" — same scale as the P&L threshold so AI Variance
  // Explainer still has enough context.
  const SALES_ONLY_OPS_THRESHOLD = 50
  const companies = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      status: { notIn: ["pending", "archived"] },
      level: { gt: 1 },
    },
    select: {
      id: true,
      code: true,
      _count: {
        select: {
          // OperationalFact has no deletedAt → _count is accurate.
          operationalFacts: true,
        },
      },
    },
  })
  // 2026-06-29 fix — count LIVE budget lines (deletedAt IS NULL), NOT the
  // Prisma `_count.budgetLines` relation aggregate. `_count` does NOT honor
  // the soft-delete filter, so a company whose lines were all archived by a
  // reset/re-import cycle (10k+ soft-deleted rows, 0 live) counted as
  // "has data" and passed — exactly the half-imported state that leaves its
  // P&L empty. The P&L / analytics / recompute readers all filter
  // `deletedAt: null`, so the readiness check must too.
  const withLive = await Promise.all(
    companies.map(async (c) => ({
      ...c,
      liveBudgetLines: await prisma.budgetLine.count({
        where: { companyId: c.id, deletedAt: null },
      }),
    })),
  )
  const low = withLive.filter(
    (c) =>
      c.liveBudgetLines < 50 &&
      c._count.operationalFacts < SALES_ONLY_OPS_THRESHOLD,
  )
  return {
    id: "low-readiness",
    title: "Companies with <50 budget_lines AND <50 operational_facts (AI may hallucinate)",
    severity: low.length === 0 ? "green" : low.length < 3 ? "yellow" : "red",
    count: low.length,
    message:
      low.length === 0
        ? "All active companies have ≥50 budget_lines or ≥50 operational_facts (sales-only entities OK)."
        : `${low.length} active companies have thin data — consider hiding from demo or labelling as 'preview'.`,
    samples: low
      .slice(0, 8)
      .map(
        (c) =>
          `  ${c.code.padEnd(22)} ${c.liveBudgetLines} live budget_lines · ${c._count.operationalFacts} ops_facts`,
      ),
  }
}

// ─── Check 7: orphaned actuals (half-imported state) ─────────────────────────
// Catches the 2026-06-29 failure class: a reset/re-import cycle soft-deleted a
// company's budget lines but never re-inserted live ones, so the company has
// archived rows yet 0 live lines. The P&L / analytics / recompute readers all
// filter `deletedAt: null`, so this renders an EMPTY financial layer for that
// company (e.g. ESG composite degenerates to a fake 100 when revenue=0).
// checkLowReadiness alone can flag the symptom only if ops_facts are also thin;
// this check fires regardless, because archived-but-not-reinserted is always a
// bug — never an intentional "sales-only" shape.
async function checkOrphanedActuals(orgId: string): Promise<CheckResult> {
  const companies = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      status: { notIn: ["pending", "archived"] },
      level: { gt: 1 },
    },
    select: { id: true, code: true },
  })
  const orphaned: string[] = []
  for (const c of companies) {
    const live = await prisma.budgetLine.count({
      where: { companyId: c.id, deletedAt: null },
    })
    if (live > 0) continue
    const archived = await prisma.budgetLine.count({
      where: { companyId: c.id, deletedAt: { not: null } },
    })
    if (archived > 0) orphaned.push(`  ${c.code.padEnd(22)} 0 live · ${archived} archived`)
  }
  return {
    id: "orphaned-actuals",
    title: "Orphaned actuals (company has archived budget lines but 0 live — half-imported)",
    severity: orphaned.length === 0 ? "green" : "red",
    count: orphaned.length,
    message:
      orphaned.length === 0
        ? "No orphaned companies — every active leaf with archived lines also has live ones."
        : `${orphaned.length} active companies were archived by a reset/re-import but never re-inserted — their P&L / analytics / indicators are EMPTY. Complete the re-import before demo.`,
    samples: orphaned.slice(0, 8),
  }
}

// ─── Check 6: zombie cells (post-Phase-7.L guard validation) ─────────────────
async function checkZombies(
  orgId: string,
  period: string,
): Promise<CheckResult> {
  const rows = await prisma.indicatorValue.findMany({
    where: {
      organizationId: orgId,
      period,
      value: 0,
      status: { in: ["green", "amber"] },
    },
    select: {
      company: { select: { code: true } },
      indicator: { select: { code: true, category: true, direction: true } },
    },
  })
  // Filter:
  //   1. Internal-only indicators (IND_HOLDING_REVENUE / IND_REVENUE_TOTAL)
  //      are by design 0=green on leaves; HeatMap filters them out.
  //   2. Phase 7.M Step 4 follow-up (2026-05-19) — `lower_better`
  //      indicators with value=0 are CORRECTLY green (0 = best
  //      possible). E.g. a services entity with 0 COGS is performing
  //      ideally on SVC_COGS_INTENSITY. Skip those — they're not
  //      zombies, they're the metric working as designed.
  const userFacing = rows.filter(
    (r) =>
      r.indicator.category !== "internal" &&
      r.indicator.direction !== "lower_better",
  )
  return {
    id: "zombies",
    title: "Zombie cells (value=0 with green/amber status, user-facing)",
    severity:
      userFacing.length === 0
        ? "green"
        : userFacing.length < 10
          ? "yellow"
          : "red",
    count: userFacing.length,
    message:
      userFacing.length === 0
        ? "No zombie cells — Phase 7.L guard is holding."
        : `${userFacing.length} zombie cells leaked past the recompute guard — investigate the formula/aggregate pair.`,
    samples: userFacing
      .slice(0, 5)
      .map((r) => `  ${r.company.code.padEnd(20)} ${r.indicator.code}`),
  }
}

async function main(): Promise<number> {
  const { orgId: explicitOrg, period } = parseArgs()
  const orgId = await pickOrg(explicitOrg)
  console.log(HR)
  console.log(`Pre-demo smoke test  ·  org=${orgId}  ·  period=${period}`)
  console.log(HR)

  const checks = await Promise.all([
    checkExtremeMagnitudes(orgId, period),
    checkFalseNegatives(orgId, period),
    checkBroadcastPollution(orgId, period),
    checkStaleAdapters(orgId),
    checkLowReadiness(orgId),
    checkZombies(orgId, period),
    checkOrphanedActuals(orgId),
  ])

  for (const c of checks) {
    console.log(NL + ICON[c.severity] + "  " + c.title)
    console.log("    " + c.message)
    if (c.samples && c.samples.length > 0) {
      for (const s of c.samples) console.log(s)
      if (c.count > c.samples.length) {
        console.log(`    ... +${c.count - c.samples.length} more`)
      }
    }
  }

  // Overall verdict = worst-of.
  const order: CheckResult["severity"][] = ["green", "yellow", "red"]
  const verdict = checks.reduce<CheckResult["severity"]>(
    (acc, c) =>
      order.indexOf(c.severity) > order.indexOf(acc) ? c.severity : acc,
    "green",
  )
  console.log(NL + HR)
  console.log(`Overall verdict: ${ICON[verdict]}  ${verdict.toUpperCase()}`)
  if (verdict === "red") {
    console.log(
      "→ Do NOT demo. Resolve the 🔴 items above first; they will be visible to the client.",
    )
  } else if (verdict === "yellow") {
    console.log(
      "→ Demo can proceed but the 🟡 items will likely surface in the session. Brief the client.",
    )
  } else {
    console.log("→ Cleared for demo.")
  }
  console.log(HR)

  return verdict === "red" ? 2 : verdict === "yellow" ? 1 : 0
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (e) => {
    console.error("[pre-demo-smoke] failed:", e)
    await prisma.$disconnect()
    process.exit(3)
  })
