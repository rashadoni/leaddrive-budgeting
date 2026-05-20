/**
 * Phase 7.M Tier 4 (2026-05-19) — E2E test for AI Auto Import.
 *
 * Exercises the full pipeline on real Guvven Fin.xlsx:
 *   1. Sheet meta extraction (pure)
 *   2. AI classifier with REAL LLM call (~$0.02 burn)
 *   3. Entity sheet map building (pure)
 *   4. Validation: every PLF/BS/CF sheet correctly routed
 *
 * Does NOT mutate DB — pure read + LLM call.
 *
 * Usage:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx scripts/test-ai-import-e2e.ts
 */
import * as XLSX from "xlsx"
import { PrismaClient } from "@prisma/client"
import { extractWorkbookMeta } from "@/lib/onboarding/ai-import/sheet-meta-extractor"
import { classifySheets } from "@/lib/onboarding/ai-import/sheet-classifier"
import { buildEntitySheetMaps } from "@/lib/onboarding/ai-import/wire-azseker-adapters"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"

const FILE =
  "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const ORG_SLUG = "azmade"

const EXPECTED = {
  // Real workbook ground truth — must match these exact assignments
  // for the test to pass.
  totalSheets: 23,
  classifications: {
    "Təsvir": { dataType: "DESCRIPTIONS" },
    "Farming Budget sales plan": { dataType: "SALES" },
    "Production Budget sales plan": { dataType: "SALES" },
    "Satış ProMalt": { dataType: "SALES" },
    "Actual >>>": { dataType: "INFO_SUMMARY" },
    "PLF CPC": { dataType: "PLF", entityCode: "AZSEKER-CPC" },
    "BS CPC": { dataType: "BS", entityCode: "AZSEKER-CPC" },
    "CF CPC": { dataType: "CF", entityCode: "AZSEKER-CPC" },
    "PLF AZSF": { dataType: "PLF", entityCode: "AZSEKER-AZSF" },
    "BS AZSF": { dataType: "BS", entityCode: "AZSEKER-AZSF" },
    "CF AZSF": { dataType: "CF", entityCode: "AZSEKER-AZSF" },
    "PLF EDEN": { dataType: "PLF", entityCode: "AZSEKER-EDEN" },
    "BS EDEN": { dataType: "BS", entityCode: "AZSEKER-EDEN" },
    "CF EDEN": { dataType: "CF", entityCode: "AZSEKER-EDEN" },
    "PL Malt": { dataType: "PLF", entityCode: "AZSEKER-MALT" },
    "BS Malt": { dataType: "BS", entityCode: "AZSEKER-MALT" },
    "CF Malt": { dataType: "CF", entityCode: "AZSEKER-MALT" },
    "KPI >>>": { dataType: "INFO_SUMMARY" },
    "Farming KPI": { dataType: "KPI_FARMING" },
    "CPC KPI": { dataType: "KPI_PROCESSING", entityCode: "AZSEKER-CPC" },
    "CAPEX >>>": { dataType: "INFO_SUMMARY" },
    "CAPEX_Farm": { dataType: "CAPEX" },
    "CAPEX_CPC": { dataType: "CAPEX", entityCode: "AZSEKER-CPC" },
  },
}

interface TestResult {
  name: string
  pass: boolean
  detail?: string
}

const results: TestResult[] = []

function test(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail })
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `: ${detail}` : ""}`)
}

const prisma = new PrismaClient()

async function main(): Promise<number> {
  console.log(`\n=== AI Auto Import E2E test ===\n`)
  console.log(`File: ${FILE}\n`)

  // ── 1. Read org context ──────────────────────────────────────
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  })
  if (!org) {
    console.error(`✗ Org slug=${ORG_SLUG} not found`)
    return 1
  }
  const entities = await prisma.company.findMany({
    where: {
      organizationId: org.id,
      status: { not: "archived" },
      code: { startsWith: "AZSEKER" },
    },
    select: { code: true },
  })
  const knownEntityCodes = entities.map((e: { code: string }) => e.code)
  console.log(
    `Org: ${org.name} · ${knownEntityCodes.length} active AZSEKER entities`,
  )
  console.log(`Known: ${knownEntityCodes.join(", ")}\n`)

  // ── 2. Sheet meta extraction ─────────────────────────────────
  console.log(`── Test 1: Sheet meta extraction ──`)
  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false })
  const metas = extractWorkbookMeta(wb, XLSX, {
    sampleRows: 4,
    maxColumns: 12,
    profileRows: 60,
  })
  test(
    `Extracted ${metas.length} sheet metas`,
    metas.length === EXPECTED.totalSheets,
    `expected ${EXPECTED.totalSheets}, got ${metas.length}`,
  )
  const separators = metas.filter((m) => m.isSectionSeparator)
  test(
    `Found ${separators.length} section separators`,
    separators.length === 3,
    `expected 3 (Actual >>>, KPI >>>, CAPEX >>>), got ${separators.length}: ${separators.map((s) => s.sheetName).join(", ")}`,
  )
  const compactJson = JSON.stringify(
    metas.map((m) => ({
      ...m,
      sample: m.sample.slice(0, 3).map((r) => r.slice(0, 8)),
    })),
  )
  test(
    `Meta JSON payload < 50 KB (cost-bounded)`,
    compactJson.length < 50_000,
    `size=${(compactJson.length / 1024).toFixed(1)} KB`,
  )

  // ── 3. AI classifier with REAL LLM call ──────────────────────
  console.log(`\n── Test 2: AI classifier (REAL LLM CALL — ~$0.02 burn) ──`)
  const t0 = Date.now()
  const classifierResult = await classifySheets(
    {
      sheetMetas: metas,
      knownEntityCodes,
      orgIndustry: "food_processing",
    },
    getAnthropicClient(),
    AI_MODEL,
  )
  const elapsed = Date.now() - t0
  test(
    `LLM call completed in <30s`,
    elapsed < 30_000,
    `took ${elapsed}ms`,
  )
  test(
    `Returned ${classifierResult.classifications.length} classifications`,
    classifierResult.classifications.length === EXPECTED.totalSheets,
    `expected ${EXPECTED.totalSheets}, got ${classifierResult.classifications.length}`,
  )
  test(
    `Token spend < 10K total`,
    classifierResult.usage.inputTokens + classifierResult.usage.outputTokens <
      10_000,
    `${classifierResult.usage.inputTokens} in + ${classifierResult.usage.outputTokens} out`,
  )
  test(
    `skippedLLM=false (LLM was actually called)`,
    !classifierResult.skippedLLM,
  )
  test(
    `All classifications have non-empty reasoning`,
    classifierResult.classifications.every(
      (c) => c.reasoning && c.reasoning.length > 0,
    ),
  )

  // ── 4. Validate each classification against ground truth ─────
  console.log(`\n── Test 3: Classification correctness ──`)
  let correctType = 0
  let correctEntity = 0
  let typeChecked = 0
  let entityChecked = 0
  const errors: string[] = []
  for (const [sheetName, expected] of Object.entries(EXPECTED.classifications)) {
    const actual = classifierResult.classifications.find(
      (c) => c.sheetName === sheetName,
    )
    if (!actual) {
      errors.push(`Missing classification for "${sheetName}"`)
      continue
    }
    typeChecked++
    if (actual.dataType === expected.dataType) {
      correctType++
    } else {
      errors.push(
        `${sheetName}: expected dataType=${expected.dataType}, got ${actual.dataType} (confidence ${actual.confidence.toFixed(2)})`,
      )
    }
    if ("entityCode" in expected && expected.entityCode) {
      entityChecked++
      if (actual.entityCode === expected.entityCode) {
        correctEntity++
      } else {
        errors.push(
          `${sheetName}: expected entityCode=${expected.entityCode}, got ${actual.entityCode}`,
        )
      }
    }
  }
  test(
    `${correctType}/${typeChecked} dataType classifications correct`,
    correctType === typeChecked,
  )
  test(
    `${correctEntity}/${entityChecked} entity assignments correct`,
    correctEntity === entityChecked,
  )

  // Show per-sheet table
  console.log(`\n  Detailed classification:`)
  for (const c of classifierResult.classifications) {
    const expected = EXPECTED.classifications[c.sheetName as keyof typeof EXPECTED.classifications]
    const ok =
      expected &&
      c.dataType === expected.dataType &&
      ("entityCode" in expected
        ? c.entityCode === expected.entityCode
        : true)
    const flag = ok ? "✓" : expected ? "✗" : "•"
    console.log(
      `    ${flag} ${c.sheetName.padEnd(34)} ${c.dataType.padEnd(16)} ${(c.entityCode ?? "—").padEnd(18)} conf=${c.confidence.toFixed(2)}`,
    )
  }

  if (errors.length > 0) {
    console.log(`\n  Classification errors:`)
    for (const e of errors) console.log(`    ⚠ ${e}`)
  }

  // ── 5. Entity sheet map building ─────────────────────────────
  console.log(`\n── Test 4: Entity sheet map grouping ──`)
  const maps = buildEntitySheetMaps(classifierResult.classifications)
  test(
    `Grouped into ${maps.length} entity buckets`,
    maps.length >= 4,
    `got ${maps.length}: ${maps.map((m) => m.code).join(", ")}`,
  )
  for (const expectedEntity of [
    "AZSEKER-CPC",
    "AZSEKER-AZSF",
    "AZSEKER-EDEN",
    "AZSEKER-MALT",
  ]) {
    const m = maps.find((m) => m.code === expectedEntity)
    test(
      `${expectedEntity}: PLF + BS + CF all routed`,
      m !== undefined && !!m.plSheet && !!m.bsSheet && !!m.cfSheet,
      m
        ? `pl=${m.plSheet}, bs=${m.bsSheet}, cf=${m.cfSheet}`
        : "entity missing",
    )
  }

  // ── 6. Summary ───────────────────────────────────────────────
  const pass = results.filter((r) => r.pass).length
  const fail = results.filter((r) => !r.pass).length
  console.log(`\n${"─".repeat(60)}`)
  console.log(`Total: ${pass + fail} · Pass: ${pass} · Fail: ${fail}`)
  console.log(
    `LLM cost estimate: ~$${((classifierResult.usage.inputTokens / 1000) * 0.003 + (classifierResult.usage.outputTokens / 1000) * 0.015).toFixed(4)}`,
  )
  console.log(`Duration: ${elapsed}ms (LLM only)`)
  console.log(`${"─".repeat(60)}\n`)

  return fail === 0 ? 0 : 1
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(2)
  })
