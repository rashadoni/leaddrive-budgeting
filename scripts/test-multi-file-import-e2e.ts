/**
 * Phase 7.M Tier 5 (2026-05-20) — End-to-end test for multi-file AI Import.
 *
 * Exercises the FULL multi-file pipeline on 3 real AzerSheker xlsx files:
 *   1. Guvven Fin.xlsx          → expected: main-financial
 *   2. Çıxarışların uçotu.xlsx  → expected: land-registry
 *   3. Farming strategy.xlsx    → expected: forward-forecast
 *
 * Validates:
 *   • All 3 files classified by AI into the correct file-type
 *   • No cross-file conflicts (real production data should not conflict)
 *   • 3 groups identified in apply-order: descriptions/main / land /
 *     forward-forecast
 *   • Per-group commit succeeds in dry-run mode (no real DB writes)
 *   • Aggregate LLM cost stays under $0.50 budget
 *   • Total duration under 120 seconds
 *
 * Modes:
 *   --dry-run        — default — no DB writes, just preview the result
 *   --apply          — ACTUALLY commit to DB (use after dry-run passes)
 *   --skip-classify  — skip the LLM call (uses cached classifications
 *                      from an earlier run if available)
 *
 * Usage:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx scripts/test-multi-file-import-e2e.ts
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx scripts/test-multi-file-import-e2e.ts --apply
 */
import * as XLSX from "xlsx"
import * as fs from "node:fs"
import { PrismaClient } from "@prisma/client"
import { runMultiFileImport } from "@/lib/onboarding/ai-import/multi-file-orchestrator"
import { buildProductionAdapterRegistry } from "@/lib/onboarding/ai-import/production-adapter-registry"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"

const FILES = [
  {
    filename: "Guvven Fin.xlsx",
    path: "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx",
    expectedFileType: "main-financial",
  },
  {
    filename: "Çıxarışların uçotu.xlsx",
    path: "/Users/rashadrahimov/Documents/budget azersheker/Çıxarışların uçotu.xlsx",
    expectedFileType: "land-registry",
  },
  {
    filename: "Farming strategy - Guvven.xlsx",
    path: "/Users/rashadrahimov/Documents/budget azersheker/Farming strategy - Guvven.xlsx",
    expectedFileType: "forward-forecast",
  },
] as const

const ORG_SLUG = "azmade"
const YEAR = 2026
const MAX_BUDGET_DOLLARS = 0.5
const MAX_DURATION_MS = 120_000
const APPLY = process.argv.includes("--apply")
const DRY_RUN = !APPLY

interface TestResult {
  name: string
  pass: boolean
  detail?: string
}
const results: TestResult[] = []

function test(name: string, pass: boolean, detail?: string): void {
  results.push({ name, pass, detail })
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `: ${detail}` : ""}`)
}

const prisma = new PrismaClient()

async function main(): Promise<number> {
  console.log(
    `\n=== Multi-file AI Import E2E test ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} ===\n`,
  )
  console.log(`Files (${FILES.length}):`)
  for (const f of FILES) console.log(`  • ${f.filename} → ${f.expectedFileType}`)
  console.log()

  // ── 1. Org context ────────────────────────────────────────────
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  })
  if (!org) {
    console.error(`✗ Organization slug="${ORG_SLUG}" not found`)
    return 1
  }
  console.log(`Org: ${org.name} (${org.id})\n`)

  const entities = await prisma.company.findMany({
    where: { organizationId: org.id, status: { not: "archived" } },
    select: { code: true },
  })
  const knownEntityCodes = entities.map((e: { code: string }) => e.code)

  // ── 2. Load all xlsx into workbooks ───────────────────────────
  console.log(`── 1. Reading xlsx files ──`)
  const files: Array<{ filename: string; workbook: XLSX.WorkBook }> = []
  for (const f of FILES) {
    if (!fs.existsSync(f.path)) {
      console.error(`✗ File not found: ${f.path}`)
      return 1
    }
    const buf = fs.readFileSync(f.path)
    const wb = XLSX.read(buf, {
      cellFormula: false,
      cellHTML: false,
      cellDates: false,
    })
    console.log(
      `  ✓ ${f.filename} (${(buf.byteLength / 1024).toFixed(0)} KB, ${wb.SheetNames.length} sheets)`,
    )
    files.push({ filename: f.filename, workbook: wb })
  }
  console.log()

  // ── 3. Run the orchestrator ───────────────────────────────────
  console.log(
    `── 2. Running multi-file orchestrator (${DRY_RUN ? "dry-run" : "APPLY"}) ──`,
  )
  const t0 = Date.now()
  const result = await runMultiFileImport(
    {
      files,
      organizationId: org.id,
      year: YEAR,
      knownEntityCodes,
      dryRun: DRY_RUN,
      // Allow yellow so a small drift in real data doesn't kill the test
      allowYellow: true,
    },
    {
      prisma,
      anthropicClient: getAnthropicClient(),
      model: AI_MODEL,
      registry: buildProductionAdapterRegistry(prisma),
      XLSX,
    },
  )
  const durationMs = Date.now() - t0
  console.log(`  Duration: ${durationMs}ms\n`)

  // ── 4. Assertions ─────────────────────────────────────────────
  console.log(`── 3. Validating ──`)

  // 3.1. Each file classified into the expected file-type
  for (const expected of FILES) {
    const f = result.perFile.find((p) => p.filename === expected.filename)
    if (!f) {
      test(
        `${expected.filename} present in result`,
        false,
        "missing from perFile",
      )
      continue
    }
    test(
      `${expected.filename} → fileType=${expected.expectedFileType}`,
      f.fileTypeResult.fileType === expected.expectedFileType,
      `actual=${f.fileTypeResult.fileType} confidence=${f.fileTypeResult.confidence.toFixed(2)}`,
    )
  }

  // 3.2. No cross-file conflicts (real data should not conflict)
  test(
    `0 cross-file conflicts`,
    result.conflicts.length === 0,
    result.conflicts.length > 0
      ? `${result.conflicts.length} conflicts found`
      : "no conflicts",
  )

  // 3.3. perGroup matches expected file-types
  const groupFileTypes = result.perGroup.map((g) => g.fileType as string).sort()
  const expectedTypes = ["forward-forecast", "land-registry", "main-financial"]
  test(
    `perGroup contains [main-financial, land-registry, forward-forecast]`,
    expectedTypes.every((t) => groupFileTypes.includes(t)),
    `actual: [${groupFileTypes.join(", ")}]`,
  )

  // 3.4. Overall verdict not red
  test(
    `overallVerdict is not red`,
    result.overallVerdict !== "red",
    `actual=${result.overallVerdict}`,
  )

  // 3.5. LLM cost under budget
  // Sonnet 4.5 pricing: $3/M input, $15/M output (Phase 7.M Tier 4 source).
  const inputCost = (result.llmUsage.inputTokens / 1_000_000) * 3
  const outputCost = (result.llmUsage.outputTokens / 1_000_000) * 15
  const totalCost = inputCost + outputCost
  test(
    `LLM cost under $${MAX_BUDGET_DOLLARS}`,
    totalCost <= MAX_BUDGET_DOLLARS,
    `$${totalCost.toFixed(4)} (in=${result.llmUsage.inputTokens}, out=${result.llmUsage.outputTokens})`,
  )

  // 3.6. Duration under cap
  test(
    `Duration under ${MAX_DURATION_MS}ms`,
    durationMs <= MAX_DURATION_MS,
    `actual=${durationMs}ms`,
  )

  // 3.7. Apply mode: each group should report committed=true
  if (APPLY) {
    for (const g of result.perGroup) {
      test(
        `${g.fileType} group committed`,
        g.committed === true,
        g.committed
          ? `${g.totalRowsInserted} rows inserted`
          : `verdict=${g.verdict} skipReason=${g.skipReason}`,
      )
    }
    // 3.8. Recompute fired
    test(
      `Recompute targets > 0`,
      result.recompute.targets > 0,
      `targets=${result.recompute.targets} ok=${result.recompute.ok} failed=${result.recompute.failed}`,
    )
  }

  // ── 5. Summary ────────────────────────────────────────────────
  console.log(`\n── 4. Summary ──`)
  console.log(`  Files processed:  ${result.perFile.length}/${FILES.length}`)
  console.log(`  Groups attempted: ${result.perGroup.length}`)
  console.log(`  Conflicts:        ${result.conflicts.length}`)
  console.log(`  Warnings:         ${result.warnings.length}`)
  console.log(`  Overall verdict:  ${result.overallVerdict.toUpperCase()}`)
  console.log(
    `  LLM cost:         $${totalCost.toFixed(4)} (${result.llmUsage.inputTokens} in / ${result.llmUsage.outputTokens} out)`,
  )
  console.log(`  Duration:         ${durationMs}ms`)

  if (result.warnings.length > 0) {
    console.log(`\nWarnings:`)
    for (const w of result.warnings.slice(0, 20)) console.log(`  ⚠ ${w}`)
    if (result.warnings.length > 20) {
      console.log(`  ... and ${result.warnings.length - 20} more`)
    }
  }

  if (result.perGroup.length > 0) {
    console.log(`\nPer-group breakdown:`)
    for (const g of result.perGroup) {
      console.log(
        `  ${g.verdict === "green" ? "🟢" : g.verdict === "yellow" ? "🟡" : g.verdict === "red" ? "🔴" : "⚪"} ${g.fileType.padEnd(24)} files=${g.filenames.length} rows=${g.totalRowsInserted} ${g.committed ? "committed" : g.skipReason ?? ""}`,
      )
    }
  }

  // ── 6. Verdict ────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length
  const failed = results.filter((r) => !r.pass).length
  console.log(
    `\n=== ${failed === 0 ? "✓ PASS" : "✗ FAIL"} (${passed}/${results.length} checks) ===\n`,
  )
  return failed === 0 ? 0 : 1
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error("\n✗ UNCAUGHT ERROR:", err)
    await prisma.$disconnect()
    process.exit(2)
  })
