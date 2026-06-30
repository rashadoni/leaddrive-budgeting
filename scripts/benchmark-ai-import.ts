/**
 * Repeatable AI Import benchmark.
 *
 * Default mode runs the production multi-file AI Import orchestrator with
 * dryRun=true. It can read real local workbooks plus synthetic edge-case
 * workbooks generated under tmp/ai-import-benchmark/generated.
 *
 * Usage:
 *   npx tsx scripts/benchmark-ai-import.ts --list
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx scripts/benchmark-ai-import.ts --org-slug azmade
 *   npx tsx scripts/benchmark-ai-import.ts --case reporting-pack --baseline tmp/ai-import-benchmark/report-prev.json
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import * as XLSX from "xlsx"
import { PrismaClient } from "@prisma/client"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import {
  REPORTING_PACK_BUDGET_PLF_BLOCK_ENTITIES,
  REPORTING_PACK_SHEET_MAP,
  looksLikeReportingPack,
} from "@/lib/onboarding/ai-import/reporting-pack-sheet-map"
import { applyBudgetPlfSplit } from "@/lib/onboarding/ai-import/consolidated-plf-split"
import {
  applyBuColumnSplit,
  inferStatementMeta,
} from "@/lib/onboarding/ai-import/bu-column-split"
import { buildEntityAliasMap } from "@/lib/onboarding/ai-import/entity-inference"
import {
  runMultiFileImport,
  type MultiFileImportResult,
} from "@/lib/onboarding/ai-import/multi-file-orchestrator"
import { buildProductionAdapterRegistry } from "@/lib/onboarding/ai-import/production-adapter-registry"
import type { FileType } from "@/lib/onboarding/ai-import/file-type-detector"
import type { SheetMap, SheetMapEntry } from "@/lib/onboarding/ai-import/sheet-routing"

type CorpusCategory =
  | "current-azersheker"
  | "reporting-pack"
  | "multi-bu"
  | "no-code-pl"
  | "no-code-bs"
  | "no-code-cf"
  | "elimination"
  | "summary-pivot"
  | "malformed-partial"

interface CorpusWorkbook {
  filename: string
  path: string
  generated?: boolean
}

interface CorpusCase {
  id: string
  title: string
  categories: CorpusCategory[]
  workbooks: CorpusWorkbook[]
  expectedFileType?: FileType
  expectedNoData?: boolean
  notes: string
}

interface Args {
  list: boolean
  orgSlug: string
  year: number
  outDir: string
  baselinePath?: string
  onlyCaseIds: Set<string>
  generatedOnly: boolean
  realOnly: boolean
  allowYellow: boolean
}

interface HumanConfirmationEstimate {
  count: number
  reasons: string[]
}

interface CaseScore {
  classification: number
  entityRouting: number
  parsing: number
  reconciliation: number
  humanEffort: number
  total: number
}

interface CaseReport {
  id: string
  title: string
  categories: CorpusCategory[]
  files: string[]
  skipped: boolean
  skipReason?: string
  expectedFileType?: FileType
  actualFileTypes: Array<{ filename: string; fileType: FileType; confidence: number }>
  metrics: {
    classification: {
      matchedExpected: boolean | null
      classifiedSheets: number
      classificationErrors: number
      llmInputTokens: number
      llmOutputTokens: number
    }
    entityRouting: {
      planRelevantSheets: number
      withEntity: number
      missingEntity: number
    }
    parse: {
      workbookSheets: number
      parsedSheets: number
      parsedItems: number
      parsedCells: number
      skippedSheets: number
      blockedSheets: number
      adapterWarnings: number
    }
    reconciliation: {
      verdict: MultiFileImportResult["overallVerdict"] | "skipped"
      conflicts: number
      groups: Array<{
        fileType: string
        verdict: string
        committed: boolean
        skipReason: string | null
      }>
    }
    recompute: MultiFileImportResult["recompute"]
    humanConfirmations: HumanConfirmationEstimate
    warnings: string[]
  }
  score: CaseScore | null
  beforeScore: number | null
  afterScore: number | null
  deltaScore: number | null
  durationMs: number | null
}

interface BenchmarkReport {
  generatedAt: string
  dryRun: true
  model: string
  organization: { slug: string; id: string | null; name: string | null }
  year: number
  corpus: { total: number; executed: number; skipped: number }
  totals: {
    averageScore: number | null
    totalHumanConfirmations: number
    totalConflicts: number
    totalParsedItems: number
    totalParsedCells: number
  }
  cases: CaseReport[]
}

const HOME = os.homedir()
const DEFAULT_OUT_DIR = path.resolve("tmp/ai-import-benchmark")

function realWorkbook(filename: string): CorpusWorkbook {
  return {
    filename,
    path: path.join(HOME, "Documents", "budget azersheker", filename),
  }
}

function defaultCorpus(generatedDir: string): CorpusCase[] {
  return [
    {
      id: "azersheker-main-financial",
      title: "AzerSheker current main financial workbook",
      categories: ["current-azersheker"],
      workbooks: [realWorkbook("Guvven Fin.xlsx")],
      expectedFileType: "main-financial",
      notes: "Canonical 23-sheet AzerSheker workbook with PLF/BS/CF/KPI/CAPEX.",
    },
    {
      id: "reporting-pack",
      title: "AzerSheker Reporting 2026 pack",
      categories: ["current-azersheker", "reporting-pack", "summary-pivot", "elimination"],
      workbooks: [realWorkbook("Reporting 2026.xlsx")],
      expectedFileType: "main-financial",
      notes: "Reporting pack with actual/budget, derived sheets, pivots, and EJE elimination tabs.",
    },
    {
      id: "actual-budget-multi-bu",
      title: "Actual/Budget workbook with BU-column multi-entity sheets",
      categories: ["current-azersheker", "multi-bu"],
      workbooks: [realWorkbook("actual-budget-v1.xlsx")],
      expectedFileType: "main-financial",
      notes: "Exercises BU-column split and actual/budget routing.",
    },
    {
      id: "generated-no-code-pl",
      title: "Generated no-code P&L",
      categories: ["no-code-pl"],
      workbooks: [
        {
          filename: "generated-no-code-pl.xlsx",
          path: path.join(generatedDir, "generated-no-code-pl.xlsx"),
          generated: true,
        },
      ],
      expectedFileType: "main-financial",
      notes: "Rows have labels like Revenue/OPEX/EBITDA but no PLF.* codes.",
    },
    {
      id: "generated-no-code-bs",
      title: "Generated no-code Balance Sheet",
      categories: ["no-code-bs"],
      workbooks: [
        {
          filename: "generated-no-code-bs.xlsx",
          path: path.join(generatedDir, "generated-no-code-bs.xlsx"),
          generated: true,
        },
      ],
      expectedFileType: "main-financial",
      notes: "Rows have asset/liability labels but no BS.* codes.",
    },
    {
      id: "generated-no-code-cf",
      title: "Generated no-code Cash Flow",
      categories: ["no-code-cf"],
      workbooks: [
        {
          filename: "generated-no-code-cf.xlsx",
          path: path.join(generatedDir, "generated-no-code-cf.xlsx"),
          generated: true,
        },
      ],
      expectedFileType: "main-financial",
      notes: "Rows have cash-flow labels but no CF.* codes.",
    },
    {
      id: "generated-elimination-summary",
      title: "Generated elimination and summary/pivot workbook",
      categories: ["elimination", "summary-pivot"],
      workbooks: [
        {
          filename: "generated-elimination-summary.xlsx",
          path: path.join(generatedDir, "generated-elimination-summary.xlsx"),
          generated: true,
        },
      ],
      expectedFileType: "main-financial",
      notes: "Source-like tabs plus EJE/elimination and pivot-style summary sheets.",
    },
    {
      id: "generated-malformed-partial",
      title: "Generated malformed and partial workbook",
      categories: ["malformed-partial"],
      workbooks: [
        {
          filename: "generated-malformed-partial.xlsx",
          path: path.join(generatedDir, "generated-malformed-partial.xlsx"),
          generated: true,
        },
      ],
      expectedFileType: "unknown",
      expectedNoData: true,
      notes: "Sparse/partial workbook that should not write data silently.",
    },
  ]
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    list: false,
    orgSlug: process.env.AI_IMPORT_BENCHMARK_ORG_SLUG ?? "azmade",
    year: new Date().getFullYear(),
    outDir: DEFAULT_OUT_DIR,
    onlyCaseIds: new Set(),
    generatedOnly: false,
    realOnly: false,
    allowYellow: true,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (!v) throw new Error(`Missing value for ${a}`)
      return v
    }
    if (a === "--list") args.list = true
    else if (a === "--org-slug") args.orgSlug = next()
    else if (a === "--year") args.year = Number(next())
    else if (a === "--out-dir") args.outDir = path.resolve(next())
    else if (a === "--baseline") args.baselinePath = path.resolve(next())
    else if (a === "--case") args.onlyCaseIds.add(next())
    else if (a === "--generated-only") args.generatedOnly = true
    else if (a === "--real-only") args.realOnly = true
    else if (a === "--strict-yellow") args.allowYellow = false
    else if (a === "--help" || a === "-h") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  if (!Number.isInteger(args.year) || args.year < 2020 || args.year > 2050) {
    throw new Error("--year must be an integer between 2020 and 2050")
  }
  if (args.generatedOnly && args.realOnly) {
    throw new Error("--generated-only and --real-only are mutually exclusive")
  }
  return args
}

function printHelp(): void {
  console.log(`AI Import benchmark

Options:
  --list                 Print corpus cases and exit without DB/LLM usage
  --org-slug <slug>      Organization slug to resolve entities (default: azmade)
  --year <yyyy>          Import year scope (default: current year)
  --case <id>            Run one case; repeatable
  --generated-only       Run generated synthetic fixtures only
  --real-only            Run real workbook fixtures only
  --baseline <file>      Compare current scores against a previous report JSON
  --out-dir <dir>        Report directory (default: tmp/ai-import-benchmark)
  --strict-yellow        Treat yellow reconciliation as requiring manual action
`)
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: unknown[][]): void {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
}

function monthHeaders(): string[] {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
}

function generateSyntheticFixtures(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })

  const pl = XLSX.utils.book_new()
  addSheet(pl, "Actual P&L 2026", [
    ["Line item", ...monthHeaders(), "BU"],
    ["Revenue", 120000, 125000, 130000, 132000, 135000, 0, 0, 0, 0, 0, 0, 0, "CPC"],
    ["Raw materials", -42000, -45000, -47000, -48000, -49000, 0, 0, 0, 0, 0, 0, 0, "CPC"],
    ["Payroll", -18000, -18000, -18500, -19000, -19000, 0, 0, 0, 0, 0, 0, 0, "CPC"],
    ["Admin expenses", -9000, -9200, -9300, -9400, -9500, 0, 0, 0, 0, 0, 0, 0, "CPC"],
    ["EBITDA", 51000, 52800, 55200, 55600, 57500, 0, 0, 0, 0, 0, 0, 0, "CPC"],
    ["Net profit", 43000, 44600, 46800, 47100, 48800, 0, 0, 0, 0, 0, 0, 0, "CPC"],
  ])
  XLSX.writeFile(pl, path.join(dir, "generated-no-code-pl.xlsx"))

  const bs = XLSX.utils.book_new()
  addSheet(bs, "Balance Sheet Actual", [
    ["Account label", ...monthHeaders(), "Company"],
    ["Cash and cash equivalents", 90000, 92000, 88000, 94000, 97000, 97000, 97000, 97000, 97000, 97000, 97000, 97000, "EDEN"],
    ["Trade receivables", 210000, 215000, 220000, 221000, 225000, 225000, 225000, 225000, 225000, 225000, 225000, 225000, "EDEN"],
    ["Inventory", 310000, 312000, 318000, 320000, 322000, 322000, 322000, 322000, 322000, 322000, 322000, 322000, "EDEN"],
    ["Loans payable", -150000, -148000, -146000, -144000, -142000, -142000, -142000, -142000, -142000, -142000, -142000, -142000, "EDEN"],
    ["Equity", -460000, -471000, -480000, -491000, -502000, -502000, -502000, -502000, -502000, -502000, -502000, -502000, "EDEN"],
  ])
  XLSX.writeFile(bs, path.join(dir, "generated-no-code-bs.xlsx"))

  const cf = XLSX.utils.book_new()
  addSheet(cf, "Cash Flow Actual", [
    ["Cash flow line", ...monthHeaders(), "Entity"],
    ["Opening cash", 50000, 62000, 59000, 61000, 64000, 64000, 64000, 64000, 64000, 64000, 64000, 64000, "CPC"],
    ["Cash receipts from customers", 115000, 119000, 123000, 125000, 128000, 0, 0, 0, 0, 0, 0, 0, "CPC"],
    ["Payments to suppliers", -72000, -74000, -76000, -77000, -78000, 0, 0, 0, 0, 0, 0, 0, "CPC"],
    ["Payroll paid", -18000, -18000, -18500, -19000, -19000, 0, 0, 0, 0, 0, 0, 0, "CPC"],
    ["Closing cash", 75000, 89000, 87500, 90000, 95000, 64000, 64000, 64000, 64000, 64000, 64000, 64000, "CPC"],
  ])
  XLSX.writeFile(cf, path.join(dir, "generated-no-code-cf.xlsx"))

  const elim = XLSX.utils.book_new()
  addSheet(elim, "PLF Actual", [
    ["Code", "Description", ...monthHeaders(), "BU"],
    ["PLF.01.01.01", "Revenue", 100000, 120000, 130000, 0, 0, 0, 0, 0, 0, 0, 0, 0, "CPC"],
    ["PLF.02.01.01", "COGS", -50000, -60000, -65000, 0, 0, 0, 0, 0, 0, 0, 0, 0, "CPC"],
  ])
  addSheet(elim, "EJE eliminations", [
    ["Code", "Description", ...monthHeaders(), "BU"],
    ["PLF.01.99.99", "Intercompany revenue elimination", -10000, -12000, -13000, 0, 0, 0, 0, 0, 0, 0, 0, 0, "EJE"],
  ])
  addSheet(elim, "Pivot Summary", [
    ["Metric", "Q1 total", "YTD"],
    ["Revenue", 350000, 350000],
    ["COGS", -175000, -175000],
    ["EBITDA", 175000, 175000],
  ])
  XLSX.writeFile(elim, path.join(dir, "generated-elimination-summary.xlsx"))

  const malformed = XLSX.utils.book_new()
  addSheet(malformed, "Random notes", [
    ["Prepared by finance"],
    ["These rows are intentionally sparse"],
    [],
    ["Revenue maybe", "N/A", "check later"],
  ])
  addSheet(malformed, "Partial table", [
    ["Account", "Jan", "Mar"],
    ["", 123],
    ["Unknown total"],
  ])
  XLSX.writeFile(malformed, path.join(dir, "generated-malformed-partial.xlsx"))
}

function listCases(cases: CorpusCase[]): void {
  console.log("AI Import benchmark corpus:")
  for (const c of cases) {
    const sources = c.workbooks
      .map((w) => `${w.generated ? "generated" : "real"}:${w.filename}`)
      .join(", ")
    console.log(`- ${c.id}`)
    console.log(`  categories: ${c.categories.join(", ")}`)
    console.log(`  expected: ${c.expectedFileType ?? "n/a"}`)
    console.log(`  files: ${sources}`)
    console.log(`  notes: ${c.notes}`)
  }
}

function readBaselineScores(filePath: string | undefined): Map<string, number> {
  if (!filePath) return new Map()
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    cases?: Array<{ id: string; afterScore?: number | null; score?: { total?: number } | null }>
  }
  const out = new Map<string, number>()
  for (const c of raw.cases ?? []) {
    const value = typeof c.afterScore === "number" ? c.afterScore : c.score?.total
    if (typeof value === "number") out.set(c.id, value)
  }
  return out
}

function scoreVerdict(verdict: MultiFileImportResult["overallVerdict"]): number {
  if (verdict === "green") return 1
  if (verdict === "yellow") return 0.65
  return 0
}

function estimateHumanConfirmations(
  result: MultiFileImportResult,
  allowYellow: boolean,
): HumanConfirmationEstimate {
  const reasons: string[] = []
  if (result.conflicts.length > 0) {
    reasons.push(`${result.conflicts.length} cross-file conflict(s)`)
  }
  if (result.parseMetrics.blockedSheets > 0) {
    reasons.push(`${result.parseMetrics.blockedSheets} blocked routing sheet(s)`)
  }
  if (result.parseMetrics.missingEntitySheets > 0) {
    reasons.push(`${result.parseMetrics.missingEntitySheets} plan-relevant sheet(s) without entity`)
  }
  const unknownFiles = result.perFile.filter((f) => f.fileTypeResult.fileType === "unknown").length
  if (unknownFiles > 0) reasons.push(`${unknownFiles} unknown file-type(s)`)
  const yellowGroups = result.perGroup.filter((g) => g.verdict === "yellow").length
  if (!allowYellow && yellowGroups > 0) reasons.push(`${yellowGroups} yellow reconciliation group(s)`)
  const reviewWarnings = result.warnings.filter((w) =>
    /review|confirm|ambiguous|not auto|unknown entity|not a known entity/i.test(w),
  )
  if (reviewWarnings.length > 0) reasons.push(`${reviewWarnings.length} review warning(s)`)
  return {
    count: reasons.reduce((sum, reason) => {
      const n = Number(reason.match(/^\d+/)?.[0] ?? 1)
      return sum + Math.max(1, n)
    }, 0),
    reasons,
  }
}

function computeScore(
  corpusCase: CorpusCase,
  result: MultiFileImportResult,
  human: HumanConfirmationEstimate,
): CaseScore {
  const expected = corpusCase.expectedFileType
  const matchesExpected =
    expected == null
      ? null
      : result.perFile.length > 0 &&
        result.perFile.every((f) => f.fileTypeResult.fileType === expected)
  const avgConfidence =
    result.perFile.reduce((sum, f) => sum + f.fileTypeResult.confidence, 0) /
    Math.max(1, result.perFile.length)
  const classification =
    matchesExpected === true ? 1 : matchesExpected === false ? 0 : avgConfidence
  const entityRouting =
    result.parseMetrics.planRelevantSheets === 0
      ? 1
      : result.parseMetrics.planRelevantSheetsWithEntity /
        result.parseMetrics.planRelevantSheets
  const parsing = corpusCase.expectedNoData
    ? result.parseMetrics.parsedItems === 0
      ? 1
      : 0
    : Math.min(1, result.parseMetrics.parsedItems / 24)
  const reconciliation = scoreVerdict(result.overallVerdict)
  const humanEffort = Math.max(
    0,
    1 - human.count / Math.max(5, result.parseMetrics.classifiedSheets),
  )
  const total =
    classification * 0.25 +
    entityRouting * 0.2 +
    parsing * 0.25 +
    reconciliation * 0.2 +
    humanEffort * 0.1
  return {
    classification: Math.round(classification * 1000) / 10,
    entityRouting: Math.round(entityRouting * 1000) / 10,
    parsing: Math.round(parsing * 1000) / 10,
    reconciliation: Math.round(reconciliation * 1000) / 10,
    humanEffort: Math.round(humanEffort * 1000) / 10,
    total: Math.round(total * 1000) / 10,
  }
}

async function resolveOrgContext(prisma: PrismaClient, orgSlug: string) {
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, settings: true },
  })
  if (!org) {
    const available = await prisma.organization.findMany({
      select: { slug: true, name: true },
      take: 20,
      orderBy: { slug: "asc" },
    })
    const hint =
      available.length === 0
        ? "No organizations exist in this database."
        : `Available slugs: ${available
            .map((o) => `${o.slug} (${o.name})`)
            .join(", ")}`
    throw new Error(`Organization slug="${orgSlug}" not found. ${hint}`)
  }

  const entities = await prisma.company.findMany({
    where: { organizationId: org.id, status: { not: "archived" } },
    select: { code: true, industry: true },
  })
  const level1 = await prisma.company.findMany({
    where: { organizationId: org.id, level: 1 },
    select: { code: true },
    take: 2,
  })
  const settings =
    org.settings && typeof org.settings === "object"
      ? (org.settings as Record<string, unknown>)
      : {}
  const entityAliases =
    settings.entityAliases && typeof settings.entityAliases === "object"
      ? (settings.entityAliases as Record<string, string>)
      : undefined
  return {
    org,
    knownEntityCodes: entities.map((e) => e.code),
    orgIndustry: settings.industry as string | undefined,
    entityAliases,
    holdingCompanyCode: level1.length === 1 ? level1[0].code : undefined,
  }
}

function loadWorkbookFile(workbook: CorpusWorkbook): {
  filename: string
  workbook: XLSX.WorkBook
  sheetMap?: SheetMap
} {
  const buf = fs.readFileSync(workbook.path)
  const wb = XLSX.read(buf, {
    cellFormula: false,
    cellHTML: false,
    type: "buffer",
  })
  return {
    filename: workbook.filename,
    workbook: wb,
    sheetMap: looksLikeReportingPack(wb.SheetNames)
      ? REPORTING_PACK_SHEET_MAP
      : undefined,
  }
}

function preprocessLikeRoute(
  files: Array<{ filename: string; workbook: XLSX.WorkBook; sheetMap?: SheetMap }>,
  ctx: Awaited<ReturnType<typeof resolveOrgContext>>,
): void {
  for (const f of files) {
    if (!looksLikeReportingPack(f.workbook.SheetNames)) continue
    if (!f.workbook.SheetNames.includes("Budget PLF")) continue
    const split = applyBudgetPlfSplit(f.workbook, XLSX, {
      blockEntityCodes: REPORTING_PACK_BUDGET_PLF_BLOCK_ENTITIES,
      holdingCompanyCode: ctx.holdingCompanyCode,
    })
    if (split.applied) {
      f.sheetMap = [...split.sheetMapEntries, ...REPORTING_PACK_SHEET_MAP]
    }
  }

  const buAliasMap = buildEntityAliasMap(
    ctx.knownEntityCodes,
    ctx.entityAliases ?? {},
  )
  for (const f of files) {
    if (looksLikeReportingPack(f.workbook.SheetNames)) continue
    const entries: SheetMapEntry[] = []
    for (const sheetName of [...f.workbook.SheetNames]) {
      const meta = inferStatementMeta(sheetName)
      if (!meta) continue
      const split = applyBuColumnSplit(f.workbook, XLSX, {
        sheetName,
        dataType: meta.dataType,
        planKind: meta.planKind,
        aliasMap: buAliasMap,
      })
      if (split.applied) entries.push(...split.sheetMapEntries)
    }
    if (entries.length > 0) f.sheetMap = [...entries, ...(f.sheetMap ?? [])]
  }
}

async function runCase(
  corpusCase: CorpusCase,
  args: Args,
  ctx: Awaited<ReturnType<typeof resolveOrgContext>>,
  prisma: PrismaClient,
  baseline: Map<string, number>,
): Promise<CaseReport> {
  const missing = corpusCase.workbooks.filter((w) => !fs.existsSync(w.path))
  if (missing.length > 0) {
    const beforeScore = baseline.get(corpusCase.id) ?? null
    return {
      id: corpusCase.id,
      title: corpusCase.title,
      categories: corpusCase.categories,
      files: corpusCase.workbooks.map((w) => w.path),
      skipped: true,
      skipReason: `Missing workbook(s): ${missing.map((w) => w.path).join(", ")}`,
      expectedFileType: corpusCase.expectedFileType,
      actualFileTypes: [],
      metrics: {
        classification: {
          matchedExpected: null,
          classifiedSheets: 0,
          classificationErrors: 0,
          llmInputTokens: 0,
          llmOutputTokens: 0,
        },
        entityRouting: { planRelevantSheets: 0, withEntity: 0, missingEntity: 0 },
        parse: {
          workbookSheets: 0,
          parsedSheets: 0,
          parsedItems: 0,
          parsedCells: 0,
          skippedSheets: 0,
          blockedSheets: 0,
          adapterWarnings: 0,
        },
        reconciliation: { verdict: "skipped", conflicts: 0, groups: [] },
        recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
        humanConfirmations: { count: 0, reasons: [] },
        warnings: [],
      },
      score: null,
      beforeScore,
      afterScore: null,
      deltaScore: null,
      durationMs: null,
    }
  }

  const files = corpusCase.workbooks.map(loadWorkbookFile)
  preprocessLikeRoute(files, ctx)
  const result = await runMultiFileImport(
    {
      files,
      organizationId: ctx.org.id,
      year: args.year,
      knownEntityCodes: ctx.knownEntityCodes,
      orgIndustry: ctx.orgIndustry,
      holdingCompanyCode: ctx.holdingCompanyCode,
      entityAliases: ctx.entityAliases,
      allowYellow: args.allowYellow,
      dryRun: true,
    },
    {
      prisma,
      anthropicClient: getAnthropicClient(),
      model: AI_MODEL,
      registry: buildProductionAdapterRegistry(prisma),
      XLSX,
    },
  )

  const human = estimateHumanConfirmations(result, args.allowYellow)
  const score = computeScore(corpusCase, result, human)
  const beforeScore = baseline.get(corpusCase.id) ?? null
  const afterScore = score.total
  const expected = corpusCase.expectedFileType
  const matchedExpected =
    expected == null
      ? null
      : result.perFile.length > 0 &&
        result.perFile.every((f) => f.fileTypeResult.fileType === expected)

  return {
    id: corpusCase.id,
    title: corpusCase.title,
    categories: corpusCase.categories,
    files: corpusCase.workbooks.map((w) => w.path),
    skipped: false,
    expectedFileType: expected,
    actualFileTypes: result.perFile.map((f) => ({
      filename: f.filename,
      fileType: f.fileTypeResult.fileType,
      confidence: f.fileTypeResult.confidence,
    })),
    metrics: {
      classification: {
        matchedExpected,
        classifiedSheets: result.parseMetrics.classifiedSheets,
        classificationErrors: result.parseMetrics.classificationErrors,
        llmInputTokens: result.llmUsage.inputTokens,
        llmOutputTokens: result.llmUsage.outputTokens,
      },
      entityRouting: {
        planRelevantSheets: result.parseMetrics.planRelevantSheets,
        withEntity: result.parseMetrics.planRelevantSheetsWithEntity,
        missingEntity: result.parseMetrics.missingEntitySheets,
      },
      parse: {
        workbookSheets: result.parseMetrics.workbookSheets,
        parsedSheets: result.parseMetrics.parsedSheets,
        parsedItems: result.parseMetrics.parsedItems,
        parsedCells: result.parseMetrics.parsedCells,
        skippedSheets: result.parseMetrics.skippedSheets,
        blockedSheets: result.parseMetrics.blockedSheets,
        adapterWarnings: result.parseMetrics.adapterWarnings,
      },
      reconciliation: {
        verdict: result.overallVerdict,
        conflicts: result.conflicts.length,
        groups: result.perGroup.map((g) => ({
          fileType: g.fileType,
          verdict: g.verdict,
          committed: g.committed,
          skipReason: g.skipReason,
        })),
      },
      recompute: result.recompute,
      humanConfirmations: human,
      warnings: result.warnings,
    },
    score,
    beforeScore,
    afterScore,
    deltaScore:
      beforeScore == null ? null : Math.round((afterScore - beforeScore) * 10) / 10,
    durationMs: result.durationMs,
  }
}

function filterCases(cases: CorpusCase[], args: Args): CorpusCase[] {
  return cases.filter((c) => {
    if (args.onlyCaseIds.size > 0 && !args.onlyCaseIds.has(c.id)) return false
    const hasGenerated = c.workbooks.some((w) => w.generated)
    if (args.generatedOnly && !hasGenerated) return false
    if (args.realOnly && hasGenerated) return false
    return true
  })
}

function printSummary(report: BenchmarkReport, outPath: string): void {
  console.log("\nAI Import benchmark summary")
  console.log(`Organization: ${report.organization.slug} (${report.organization.name ?? "unknown"})`)
  console.log(`Year: ${report.year}`)
  console.log(`Cases: ${report.corpus.executed} executed, ${report.corpus.skipped} skipped`)
  console.log(`Average score: ${report.totals.averageScore ?? "n/a"}`)
  console.log(`Human confirmations: ${report.totals.totalHumanConfirmations}`)
  console.log(`Conflicts: ${report.totals.totalConflicts}`)
  console.log(`Parsed: ${report.totals.totalParsedItems} items / ${report.totals.totalParsedCells} cells`)
  console.log("\nPer-case:")
  for (const c of report.cases) {
    const delta =
      c.deltaScore == null ? "" : ` (${c.deltaScore >= 0 ? "+" : ""}${c.deltaScore})`
    const status = c.skipped ? "SKIP" : c.metrics.reconciliation.verdict.toUpperCase()
    console.log(
      `  ${status.padEnd(7)} ${String(c.afterScore ?? "n/a").padStart(5)}${delta.padEnd(8)} ${c.id}`,
    )
    if (c.skipped) console.log(`          ${c.skipReason}`)
  }
  console.log(`\nReport written: ${outPath}`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const generatedDir = path.join(args.outDir, "generated")
  const cases = filterCases(defaultCorpus(generatedDir), args)
  if (args.list) {
    listCases(cases)
    return
  }

  fs.mkdirSync(args.outDir, { recursive: true })
  if (!args.realOnly) generateSyntheticFixtures(generatedDir)
  const baseline = readBaselineScores(args.baselinePath)
  const prisma = new PrismaClient()
  try {
    const ctx = await resolveOrgContext(prisma, args.orgSlug)
    const reports: CaseReport[] = []
    for (const c of cases) {
      console.log(`\n== ${c.id} ==`)
      reports.push(await runCase(c, args, ctx, prisma, baseline))
    }
    const executed = reports.filter((r) => !r.skipped)
    const scores = executed
      .map((r) => r.afterScore)
      .filter((v): v is number => typeof v === "number")
    const report: BenchmarkReport = {
      generatedAt: new Date().toISOString(),
      dryRun: true,
      model: AI_MODEL,
      organization: {
        slug: args.orgSlug,
        id: ctx.org.id,
        name: ctx.org.name,
      },
      year: args.year,
      corpus: {
        total: cases.length,
        executed: executed.length,
        skipped: reports.length - executed.length,
      },
      totals: {
        averageScore:
          scores.length === 0
            ? null
            : Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10,
        totalHumanConfirmations: reports.reduce(
          (s, r) => s + r.metrics.humanConfirmations.count,
          0,
        ),
        totalConflicts: reports.reduce((s, r) => s + r.metrics.reconciliation.conflicts, 0),
        totalParsedItems: reports.reduce((s, r) => s + r.metrics.parse.parsedItems, 0),
        totalParsedCells: reports.reduce((s, r) => s + r.metrics.parse.parsedCells, 0),
      },
      cases: reports,
    }
    const outPath = path.join(
      args.outDir,
      `report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    )
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8")
    printSummary(report, outPath)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
