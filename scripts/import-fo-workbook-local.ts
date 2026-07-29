/**
 * TEMP repro harness (2026-07-15) — import the FO client workbook
 * (~/Desktop/N. Nəcəfzadə.xlsx) into the LOCAL dev org, mirroring the
 * /api/import/ai-auto-multi route's deterministic pre-split steps
 * (BU-column split) so the run matches what the UI import does.
 *
 * Usage:
 *   set -a; source .env; set +a
 *   npx tsx scripts/import-fo-workbook-local.ts            # dry-run
 *   npx tsx scripts/import-fo-workbook-local.ts --apply    # commit
 */
import * as XLSX from "xlsx"
import * as fs from "node:fs"
import { PrismaClient } from "@prisma/client"
import { runMultiFileImport } from "@/lib/onboarding/ai-import/multi-file-orchestrator"
import { buildProductionAdapterRegistry } from "@/lib/onboarding/ai-import/production-adapter-registry"
import {
  applyBuColumnSplit,
  inferStatementMeta,
} from "@/lib/onboarding/ai-import/bu-column-split"
import { buildEntityAliasMap } from "@/lib/onboarding/ai-import/entity-inference"
import { looksLikeReportingPack } from "@/lib/onboarding/ai-import/reporting-pack-sheet-map"
import { detectProductSalesShape } from "@/lib/onboarding/ai-import/product-sales-parser"
import type { SheetMapEntry } from "@/lib/onboarding/ai-import/sheet-routing"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"

const FILE = "/Users/rashadrahimov/Desktop/N. Nəcəfzadə.xlsx"
const ORG_SLUG = "azmade"
const YEAR = Number(process.env.IMPORT_YEAR ?? 2026)
const APPLY = process.argv.includes("--apply")

const prisma = new PrismaClient()

async function main(): Promise<number> {
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true, settings: true },
  })
  if (!org) throw new Error(`org slug=${ORG_SLUG} not found`)
  console.log(`Org: ${org.name} (${org.id}) — year=${YEAR} apply=${APPLY}`)

  const entities = await prisma.company.findMany({
    where: { organizationId: org.id, status: { not: "archived" } },
    select: { code: true },
  })
  const knownEntityCodes = entities.map((e) => e.code)
  console.log(`Known entities: ${knownEntityCodes.join(", ")}`)
  const entityAliases =
    org.settings && typeof org.settings === "object"
      ? ((org.settings as Record<string, unknown>).entityAliases as
          | Record<string, string>
          | undefined)
      : undefined

  const wb = XLSX.read(fs.readFileSync(FILE), {
    cellFormula: false,
    cellHTML: false,
    type: "buffer",
  })
  const file: {
    filename: string
    workbook: XLSX.WorkBook
    sheetMap?: SheetMapEntry[]
  } = { filename: "N. Nəcəfzadə.xlsx", workbook: wb }

  // ── Mirror the route's BU-column pre-split ─────────────────────────
  const aliasMap = buildEntityAliasMap(knownEntityCodes, entityAliases ?? {})
  if (!looksLikeReportingPack(wb.SheetNames)) {
    const entries: SheetMapEntry[] = []
    for (const sheetName of [...wb.SheetNames]) {
      const meta = inferStatementMeta(sheetName)
      if (!meta) continue
      const split = applyBuColumnSplit(wb, XLSX, {
        sheetName,
        dataType: meta.dataType,
        planKind: meta.planKind,
        aliasMap,
      })
      if (split.applied) {
        entries.push(...split.sheetMapEntries)
        console.log(
          `BU-split "${sheetName}":`,
          split.mapping
            .map((m) => `${m.buValue}→${m.entityCode ?? `skip(${m.reason})`}(${m.rowCount})`)
            .join(" "),
        )
        for (const w of split.warnings) console.log(`  ⚠ ${w}`)
      }
    }
    if (entries.length > 0) file.sheetMap = entries
  }

  // mirror the route's deterministic product-sales pin
  {
    const entries: SheetMapEntry[] = []
    for (const sheetName of wb.SheetNames) {
      const shape = detectProductSalesShape(wb, sheetName, XLSX)
      if (!shape) continue
      entries.push({ match: sheetName, dataType: "SALES_PRODUCTS", role: "source" })
      console.log(`product-sales pin: "${sheetName}" shape=${shape}`)
    }
    if (entries.length > 0) file.sheetMap = [...entries, ...(file.sheetMap ?? [])]
  }

  const t0 = Date.now()
  const result = await runMultiFileImport(
    {
      files: [file],
      organizationId: org.id,
      year: YEAR,
      knownEntityCodes,
      entityAliases,
      allowYellow: true,
      dryRun: !APPLY,
    },
    {
      prisma,
      anthropicClient: getAnthropicClient(),
      model: AI_MODEL,
      registry: buildProductionAdapterRegistry(prisma),
      XLSX,
    },
  )
  console.log(`\nDuration ${Date.now() - t0}ms — verdict=${result.overallVerdict}`)
  console.log(`Conflicts: ${result.conflicts.length}`)
  for (const f of result.perFile) {
    console.log(`\nFile ${f.filename} → fileType=${f.fileTypeResult.fileType}`)
    for (const c of f.classifications) {
      console.log(
        `  ${c.sheetName} → ${c.dataType} entity=${c.entityCodeOverride ?? c.entityCode} plan=${c.planKind}(${c.planKindSignal}) role=${c.role} conf=${c.confidence}`,
      )
    }
  }
  for (const g of result.perGroup) {
    console.log(
      `group ${g.fileType}: verdict=${g.verdict} committed=${g.committed} rows=${g.totalRowsInserted} skip=${g.skipReason ?? "-"}`,
    )
  }
  if (result.warnings.length) {
    console.log(`\nWarnings (${result.warnings.length}):`)
    for (const w of result.warnings.slice(0, 40)) console.log(`  ⚠ ${w}`)
  }
  console.log(
    `\nLLM usage: in=${result.llmUsage.inputTokens} out=${result.llmUsage.outputTokens}`,
  )
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
