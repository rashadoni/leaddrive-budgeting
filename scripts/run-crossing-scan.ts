/**
 * Phase 7.L — Standalone runner for the crossing scan.
 *
 * Bypasses the full intel-scheduler-bootstrap pipeline (which requires
 * ANTHROPIC_API_KEY for the news-crawler step). Just runs:
 *   1. enumerate active orgs
 *   2. runCrossingScan per org
 *   3. print summary
 *
 * The crossing scan ITSELF calls Anthropic via the impact-forecast LLM
 * module, so ANTHROPIC_API_KEY is still required — but no other LLM
 * calls (news / sentiment / morning brief) burn while we're testing.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... DATABASE_URL=... \
 *     npx tsx scripts/run-crossing-scan.ts
 */
import { prisma } from "../src/lib/prisma"
import { runCrossingScan } from "../src/lib/intel/crossing-scan-runner"

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "[run-crossing-scan] ANTHROPIC_API_KEY not set. Required for impact-forecast LLM calls.",
    )
    console.error(
      "[run-crossing-scan] Pass via env: ANTHROPIC_API_KEY=sk-... npx tsx scripts/run-crossing-scan.ts",
    )
    process.exit(1)
  }

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
  })
  console.log(`[run-crossing-scan] orgs to process: ${orgs.length}`)

  for (const org of orgs) {
    console.log(`\n=== ${org.name} (${org.id}) ===`)
    const start = Date.now()
    try {
      const result = await runCrossingScan(org.id, { prisma })
      const ms = Date.now() - start
      console.log(`  done in ${ms}ms`)
      console.log(`  matches found:        ${result.matchesFound}`)
      console.log(`  forecasts attempted:  ${result.forecastsAttempted}`)
      console.log(`  forecasts generated:  ${result.forecastsGenerated}`)
      console.log(`  cache hits:           ${result.cacheHits}`)
      console.log(`  skipped (no financ):  ${result.skippedNoFinancials}`)
      console.log(`  skipped (budget):     ${result.skippedBudget}`)
      if (result.errors.length > 0) {
        console.log(`  errors: ${result.errors.length}`)
        for (const e of result.errors.slice(0, 5)) console.log(`    · ${e}`)
      }
    } catch (e) {
      console.error(
        `  THREW: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  // Print final state of feed_impact_forecasts.
  const totalForecasts = await prisma.feedImpactForecast.count()
  console.log(`\n[run-crossing-scan] total feed_impact_forecasts in DB: ${totalForecasts}`)
}

main()
  .catch((e) => {
    console.error("Script error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
