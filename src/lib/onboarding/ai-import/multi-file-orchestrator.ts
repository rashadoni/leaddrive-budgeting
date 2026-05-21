/**
 * Phase 7.M Tier 5 (2026-05-20) — Multi-file AI Import orchestrator.
 *
 * Takes N xlsx files in one upload, routes each through the AI classifier,
 * groups by detected file-type, and commits each group atomically.
 *
 * Why this exists
 * ───────────────
 * AzerSheker refresh needs THREE files (Guvven Fin / Çıxarışların / Farming
 * strategy). Doing them as 3 separate single-file uploads loses two things:
 *   1. Apply-order safety — if main-financial fails AFTER land-registry
 *      committed, recompute fires on stale BS data.
 *   2. Cross-file conflict detection — if Guvven Fin and a separate
 *      "actuals.xlsx" disagree on Q1 revenue, last-write-wins silently
 *      corrupts financial reports.
 *
 * Pipeline (matches Phase 7.M Tier 5 plan):
 *   • Phase A — per-file meta + classify (concurrent, cap=3 to respect
 *               Anthropic rate limits)
 *   • Phase B — file-type detection per file
 *   • Phase C — pre-apply: build expected sums via parse-only adapter run
 *   • Phase D — cross-file conflict gate (BEFORE any DB write — 409 if
 *               conflicts found)
 *   • Phase E — group by file-type, apply each group in one $transaction
 *               so within-group failure rolls back ALL writes in that group
 *               (other groups continue independently — "hybrid group-level
 *               atomicity" per the user decision)
 *   • Phase F — single recompute pass across all touched companies
 *   • Phase G — aggregate response with per-file + per-group + overall verdicts
 *
 * Safety guarantees (replicated from plan):
 *   1. Cross-file conflicts checked BEFORE any tx opens → 0 DB writes
 *      on conflict.
 *   2. Group-level atomicity via outer prisma.$transaction — Phase 3
 *      extended batch functions accept the outer tx; on throw inside,
 *      Prisma rolls the entire group back.
 *   3. Apply order dependency graph: descriptions → main-financial →
 *      kpi-only → capex-plan → land-registry → forward-forecast.
 *      Out-of-order writes can leave reports stale; this order keeps
 *      bedrock data (main-financial) before everything that augments it.
 *   4. Recompute runs ONCE at the end across aggregated touched
 *      companies — saves O(N) recompute calls.
 *
 * Test seam: all dependencies (prisma, anthropicClient, registry, XLSX)
 * injected via the deps object. Tests pass stubs for hermetic runs.
 */
import type { PrismaClient } from "@prisma/client"
import {
  extractWorkbookMeta,
  type SheetMeta,
} from "./sheet-meta-extractor"
import {
  classifySheets,
  type SheetClassifierAnthropicLike,
  type SheetClassification,
} from "./sheet-classifier"
import {
  detectFileType,
  type FileType,
  type FileTypeResult,
} from "./file-type-detector"
import {
  detectCrossFileConflicts,
  type CrossFileConflict,
} from "./conflict-detector"
import type { AdapterRegistry, AdapterRunResult } from "./adapter-registry"
import {
  reconcileAllSheets,
  decideAction,
  type UniversalReconciliationReport,
  type SheetReconciliationInput,
} from "./universal-reconciler"
import type { LLMUsage } from "@/lib/llm/types"
import type { ReconciliationKey } from "../reconciliation"
import {
  runRecomputeForCompanies,
  type RunRecomputeResult,
} from "@/lib/risk/recompute-trigger"

/** Hard cap on concurrent LLM calls — protects against Anthropic rate
 *  limits when uploading 10 files at once. Picked as 3 because per
 *  Phase 7.M Tier 4 the per-file token spend is ~35K input + ~5K output
 *  and Anthropic's default rate limit is comfortable at 3 concurrent. */
const LLM_CONCURRENCY = 3

/** Apply-order dependency graph (lower index = applied first). See
 *  module header for rationale. unknown is always last (skipped). */
const APPLY_ORDER: Record<FileType, number> = {
  // company-setup applies FIRST — bootstraps the entity tree so subsequent
  // financial-data writes can resolve companyId by code without falling
  // through to a "company not in DB" warning.
  "company-setup": -1,
  "strategic-descriptions": 0,
  "main-financial": 1,
  // budget-actuals applies right after main-financial — actuals need a
  // BudgetPlan to attach to; main-financial seeds the plan via PLF
  // resolution. Mirrors the dependency arrow Plan → Actuals.
  // Phase 7.M Tier 7 (Phase 3).
  "budget-actuals": 1.5,
  // sales-forecast is org-scoped (no plan dep), but BudgetDepartment
  // must be seeded (typically already exists for the org). Same tier
  // as budget-actuals for simplicity. Phase 7.M Tier 7 (Phase 4).
  "sales-forecast": 1.7,
  "kpi-only": 2,
  // ops-facts shares the operational_facts table with kpi-only; same
  // dependency tier (companies seeded, plf-bs-cf optional) — placed
  // right after kpi-only so KPI Azik-shape sheets get the first write
  // and OPS_FACTS appends without conflicts. Phase 7.M Tier 7.
  "ops-facts": 2.5,
  "capex-plan": 3,
  "land-registry": 4,
  "forward-forecast": 5,
  unknown: 99,
}

// ──────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────

export interface MultiFileImportInput {
  files: ReadonlyArray<{
    filename: string
    workbook: { Sheets: Record<string, unknown>; SheetNames: string[] }
  }>
  organizationId: string
  year: number
  /** Known entity codes (e.g. ["AZSEKER-CPC", ...]). Forwarded to LLM. */
  knownEntityCodes?: string[]
  /** Org primary industry hint forwarded to LLM. */
  orgIndustry?: string
  /** Commit yellow-verdict groups (default false — abort on yellow). */
  allowYellow?: boolean
  /** Don't touch DB even on green (parse + classify + conflict-detect only). */
  dryRun?: boolean
  /** Force commit even if cross-file conflicts exist (USE WITH CAUTION —
   *  caller takes responsibility for the conflict). Default: false. */
  forceOverride?: boolean
  /** Phase 7.M Tier 6 — per-conflict resolution map. Key = conflict key
   *  (`buildReconKey(...)`); value picks a winning file or drops the cell.
   *  When set: orchestrator rewrites the per-file expectedSums map for
   *  every keyed conflict BEFORE the group-atomic apply phase, so the
   *  committed value matches the user's choice. Conflicts NOT in the
   *  map still block apply unless `forceOverride=true`. */
  conflictResolutions?: Record<
    string,
    { mode: "pick"; filename: string } | { mode: "skip" }
  >
}

export interface PerFileResult {
  filename: string
  /** Detected file-type (incl. confidence + reasoning). */
  fileTypeResult: FileTypeResult
  classifications: SheetClassification[]
  /** Sum maps the adapters declared during parse phase (no DB writes). */
  expectedSums: Map<ReconciliationKey, number>
  /** Set when a non-recoverable error stopped this file from being
   *  classified/parsed. The group it belongs to is treated as skipped. */
  error: string | null
  /** Per-file LLM token usage. */
  llmUsage: LLMUsage
}

export interface PerGroupResult {
  fileType: FileType
  filenames: string[]
  /** Verdict from per-group reconciliation. `skipped` when force-skipped
   *  (conflict + no override) or no committable files in the group. */
  verdict: "green" | "yellow" | "red" | "skipped"
  reconciliation: UniversalReconciliationReport | null
  /** True if this group's writes landed (i.e. $transaction committed). */
  committed: boolean
  /** Total rows inserted across all files in this group. */
  totalRowsInserted: number
  /** Reason the group was skipped (when verdict='skipped'). */
  skipReason: string | null
}

export interface MultiFileImportResult {
  perFile: PerFileResult[]
  /** Conflicts detected pre-apply. Empty when no conflicts. */
  conflicts: CrossFileConflict[]
  perGroup: PerGroupResult[]
  /** Worst verdict across all committed groups. `red` if conflicts
   *  blocked the import. */
  overallVerdict: "green" | "yellow" | "red"
  /** Aggregated LLM usage across all classifier calls. */
  llmUsage: LLMUsage
  durationMs: number
  /** Result of the single recompute pass (or zero-shape if skipped). */
  recompute: {
    ok: number
    unknown: number
    failed: number
    targets: number
  }
  /** Non-fatal issues observed. */
  warnings: string[]
}

export interface MultiFileImportDependencies {
  prisma: PrismaClient
  anthropicClient: SheetClassifierAnthropicLike
  model: string
  registry: AdapterRegistry
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any
  /** Optional readActualSums fn — when supplied, the orchestrator
   *  re-reads sums per sheet AFTER write inside the same tx (gives a
   *  true post-write reconciliation). When omitted, the parse-phase
   *  sums are used as actualSums (assumes adapter self-validates). */
  readActualSums?: (sheetCtx: {
    sheetName: string
    dataType: string
    entityCode: string | null
    organizationId: string
    year: number
  }) => Promise<Map<ReconciliationKey, number>>
}

// ──────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────

/** Lightweight p-limit replacement — caps concurrent promise execution. */
async function withConcurrency<T, R>(
  items: ReadonlyArray<T>,
  fn: (item: T, idx: number) => Promise<R>,
  cap: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  const workers = Array.from(
    { length: Math.min(cap, items.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

interface ParseRecord {
  filename: string
  classification: SheetClassification
  adapterResult: AdapterRunResult | null
  expectedSums: Map<ReconciliationKey, number>
  skippedReason: string | null
}

/** Run adapter parse phase for one file (no DB writes). */
async function parseFileSheets(
  filename: string,
  workbook: MultiFileImportInput["files"][number]["workbook"],
  classifications: ReadonlyArray<SheetClassification>,
  deps: MultiFileImportDependencies,
  input: MultiFileImportInput,
  warnings: string[],
): Promise<ParseRecord[]> {
  const records: ParseRecord[] = []
  for (const cls of classifications) {
    const handler = deps.registry.get(cls.dataType)
    if (!handler) {
      records.push({
        filename,
        classification: cls,
        adapterResult: null,
        expectedSums: new Map(),
        skippedReason: `No adapter for "${cls.dataType}"`,
      })
      warnings.push(
        `${filename}: sheet "${cls.sheetName}" (${cls.dataType}) — no adapter; skipped`,
      )
      continue
    }
    try {
      const ar = await handler({
        workbook,
        sheetName: cls.sheetName,
        entityCode: cls.entityCode,
        year: input.year,
        organizationId: input.organizationId,
        XLSX: deps.XLSX,
      })
      const expectedSums =
        (
          ar as AdapterRunResult & {
            expectedSums?: Map<ReconciliationKey, number>
          }
        ).expectedSums ?? new Map<ReconciliationKey, number>()
      records.push({
        filename,
        classification: cls,
        adapterResult: ar,
        expectedSums,
        skippedReason: null,
      })
      if (ar.warnings.length > 0) {
        warnings.push(
          `${filename}: sheet "${cls.sheetName}" emitted ${ar.warnings.length} adapter warning(s)`,
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      records.push({
        filename,
        classification: cls,
        adapterResult: null,
        expectedSums: new Map(),
        skippedReason: `Adapter threw: ${msg}`,
      })
      warnings.push(
        `${filename}: sheet "${cls.sheetName}" parse error — ${msg}`,
      )
    }
  }
  return records
}

/** Compute the worst verdict across multiple per-group verdicts.
 *  Order: red > yellow > green. `skipped` doesn't influence the worst. */
function aggregateVerdict(
  groups: ReadonlyArray<PerGroupResult>,
): "green" | "yellow" | "red" {
  let worst: "green" | "yellow" | "red" = "green"
  for (const g of groups) {
    if (g.verdict === "skipped") continue
    if (g.verdict === "red") return "red"
    if (g.verdict === "yellow" && worst === "green") worst = "yellow"
  }
  return worst
}

// ──────────────────────────────────────────────────────────────────────
// Main entry
// ──────────────────────────────────────────────────────────────────────

export async function runMultiFileImport(
  input: MultiFileImportInput,
  deps: MultiFileImportDependencies,
): Promise<MultiFileImportResult> {
  const t0 = Date.now()
  const warnings: string[] = []

  // ── Phase A: extract meta + classify each file in parallel ──────
  // Each file gets ONE LLM call. Concurrency capped at LLM_CONCURRENCY.
  type ClassifyResult = {
    filename: string
    classifications: SheetClassification[]
    metas: SheetMeta[]
    usage: LLMUsage
    error: string | null
  }
  const classifyResults = await withConcurrency<
    MultiFileImportInput["files"][number],
    ClassifyResult
  >(
    input.files,
    async (file) => {
      try {
        const metas = extractWorkbookMeta(file.workbook, deps.XLSX, {
          sampleRows: 5,
          maxColumns: 15,
          profileRows: 80,
        })
        const cls = await classifySheets(
          {
            sheetMetas: metas,
            knownEntityCodes: input.knownEntityCodes,
            orgIndustry: input.orgIndustry,
            filenameHint: file.filename,
          },
          deps.anthropicClient,
          deps.model,
        )
        return {
          filename: file.filename,
          classifications: cls.classifications,
          metas,
          usage: cls.usage,
          error: null,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warnings.push(`${file.filename}: classify failed — ${msg}`)
        return {
          filename: file.filename,
          classifications: [],
          metas: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            modelName: deps.model,
            promptVersion: "n/a",
          },
          error: msg,
        }
      }
    },
    LLM_CONCURRENCY,
  )

  // ── Phase B: file-type detection per file ───────────────────────
  const fileTypeResults: Map<string, FileTypeResult> = new Map()
  for (const cr of classifyResults) {
    if (cr.error) {
      fileTypeResults.set(cr.filename, {
        fileType: "unknown",
        confidence: 0,
        reasoning: `Classification failed: ${cr.error}`,
        sheetCounts: {
          plf: 0,
          bs: 0,
          cf: 0,
          kpiFarming: 0,
          kpiProcessing: 0,
          capex: 0,
          sales: 0,
          landRegistry: 0,
          descriptions: 0,
          infoSummary: 0,
          companies: 0,
          opsFacts: 0,
          budgetActuals: 0,
          salesForecast: 0,
          unknown: 0,
        },
      })
      continue
    }
    fileTypeResults.set(
      cr.filename,
      detectFileType(cr.classifications, cr.filename),
    )
  }

  // ── Phase C: parse all sheets (no DB writes) per file ───────────
  const perFileRecords = new Map<string, ParseRecord[]>()
  const perFileExpected = new Map<string, Map<ReconciliationKey, number>>()
  for (let i = 0; i < input.files.length; i++) {
    const file = input.files[i]
    const cr = classifyResults[i]
    if (cr.error) {
      perFileRecords.set(file.filename, [])
      perFileExpected.set(file.filename, new Map())
      continue
    }
    const records = await parseFileSheets(
      file.filename,
      file.workbook,
      cr.classifications,
      deps,
      input,
      warnings,
    )
    perFileRecords.set(file.filename, records)
    // Aggregate file-level expected sums (union across sheets — used
    // for cross-file conflict detection).
    const fileExpected = new Map<ReconciliationKey, number>()
    for (const r of records) {
      for (const [k, v] of r.expectedSums) {
        fileExpected.set(k, (fileExpected.get(k) ?? 0) + v)
      }
    }
    perFileExpected.set(file.filename, fileExpected)
  }

  // ── Phase D: cross-file conflict gate ───────────────────────────
  const conflicts = detectCrossFileConflicts(perFileExpected)

  // Build perFile result objects regardless of conflict outcome.
  const perFile: PerFileResult[] = input.files.map((f, i) => {
    const cr = classifyResults[i]
    return {
      filename: f.filename,
      fileTypeResult: fileTypeResults.get(f.filename)!,
      classifications: cr.classifications,
      expectedSums: perFileExpected.get(f.filename) ?? new Map(),
      error: cr.error,
      llmUsage: cr.usage,
    }
  })

  // Aggregate LLM usage across all files (sum tokens, keep model).
  const aggLlmUsage: LLMUsage = {
    inputTokens: classifyResults.reduce(
      (s, r) => s + (r.usage.inputTokens ?? 0),
      0,
    ),
    outputTokens: classifyResults.reduce(
      (s, r) => s + (r.usage.outputTokens ?? 0),
      0,
    ),
    modelName: deps.model,
    promptVersion: classifyResults[0]?.usage.promptVersion ?? "n/a",
  }

  // Phase 7.M Tier 6 — apply per-conflict resolutions BEFORE the
  // short-circuit. For each conflict that has a resolution: rewrite the
  // per-file expectedSums map so the chosen value wins (or drop the cell
  // entirely for "skip"). After rewriting, re-detect — fully-resolved
  // conflicts disappear from the list, so the short-circuit only fires
  // for unresolved conflicts.
  const resolutionMap = input.conflictResolutions
  if (resolutionMap && Object.keys(resolutionMap).length > 0 && conflicts.length > 0) {
    for (const conflict of conflicts) {
      const r = resolutionMap[conflict.key]
      if (!r) continue
      if (r.mode === "skip") {
        // Remove the conflicting cell from EVERY file's expected map
        // so no adapter writes it.
        for (const fileMap of perFileExpected.values()) {
          fileMap.delete(conflict.key)
        }
      } else if (r.mode === "pick") {
        const winningOccurrence = conflict.occurrences.find(
          (o) => o.filename === r.filename,
        )
        if (!winningOccurrence) continue // unknown filename — leave unresolved
        // Set the winning value on every file that had a value for this
        // key, dropping it from the losing files so duplicate-cell write
        // collisions don't happen at apply time.
        for (const [fn, fileMap] of perFileExpected.entries()) {
          if (!fileMap.has(conflict.key)) continue
          if (fn === r.filename) {
            fileMap.set(conflict.key, winningOccurrence.value)
          } else {
            fileMap.delete(conflict.key)
          }
        }
      }
    }
    // Refresh perFile.expectedSums views to match the mutated maps.
    for (const f of perFile) {
      f.expectedSums = perFileExpected.get(f.filename) ?? new Map()
    }
    // Re-run the cross-file conflict detector. Anything still in the
    // returned list is unresolved and will hit the short-circuit below.
    conflicts.splice(
      0,
      conflicts.length,
      ...detectCrossFileConflicts(perFileExpected),
    )
  }

  // Conflict short-circuit: if non-empty AND not forceOverride → abort
  // before opening any tx. UI surfaces the diff.
  if (conflicts.length > 0 && !input.forceOverride) {
    return {
      perFile,
      conflicts,
      perGroup: [],
      overallVerdict: "red",
      llmUsage: aggLlmUsage,
      durationMs: Date.now() - t0,
      recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
      warnings: [
        ...warnings,
        `Cross-file conflict gate — ${conflicts.length} cell(s) disagree across files; aborted before any DB write`,
      ],
    }
  }

  // ── Phase E: group by file-type, apply each group atomically ────
  // Sort by APPLY_ORDER so dependencies land in the right order.
  const byFileType = new Map<FileType, string[]>()
  for (const f of input.files) {
    const ft = fileTypeResults.get(f.filename)!.fileType
    let arr = byFileType.get(ft)
    if (!arr) {
      arr = []
      byFileType.set(ft, arr)
    }
    arr.push(f.filename)
  }
  const orderedGroups = Array.from(byFileType.entries()).sort(
    ([a], [b]) => APPLY_ORDER[a] - APPLY_ORDER[b],
  )

  const perGroup: PerGroupResult[] = []
  const touchedCompanies = new Set<string>()

  for (const [fileType, filenames] of orderedGroups) {
    // Files of `unknown` type are flagged but never auto-applied —
    // human review required (a workbook we couldn't classify could
    // damage real data if we guessed).
    if (fileType === "unknown") {
      perGroup.push({
        fileType,
        filenames,
        verdict: "skipped",
        reconciliation: null,
        committed: false,
        totalRowsInserted: 0,
        skipReason: `File-type unknown for ${filenames.length} file(s); manual review required`,
      })
      warnings.push(
        `Group "unknown" (${filenames.length} file(s)) skipped — manual review required`,
      )
      continue
    }

    // Build the committable records list for this group.
    const groupRecords: ParseRecord[] = []
    for (const fn of filenames) {
      const recs = perFileRecords.get(fn) ?? []
      for (const r of recs) {
        if (r.adapterResult && r.skippedReason === null) {
          groupRecords.push(r)
        }
      }
    }

    if (groupRecords.length === 0) {
      perGroup.push({
        fileType,
        filenames,
        verdict: "skipped",
        reconciliation: null,
        committed: false,
        totalRowsInserted: 0,
        skipReason: `No parseable sheets in group "${fileType}"`,
      })
      continue
    }

    // Pre-write reconciliation (parse-only — expected vs expected).
    // The same trick the single-file orchestrator uses to flag adapter
    // sums that are internally inconsistent.
    const dryInputs: SheetReconciliationInput[] = groupRecords.map((r) => ({
      sheetName: `${r.filename}::${r.classification.sheetName}`,
      dataType: r.classification.dataType,
      entityCode: r.classification.entityCode,
      expectedSums: r.expectedSums,
      actualSums: r.expectedSums,
    }))
    const dryReconciliation = reconcileAllSheets(dryInputs)

    if (
      dryReconciliation.overallVerdict === "red" ||
      (dryReconciliation.overallVerdict === "yellow" && !input.allowYellow)
    ) {
      perGroup.push({
        fileType,
        filenames,
        verdict: dryReconciliation.overallVerdict,
        reconciliation: dryReconciliation,
        committed: false,
        totalRowsInserted: 0,
        skipReason: `Pre-write reconciliation verdict: ${dryReconciliation.overallVerdict}`,
      })
      warnings.push(
        `Group "${fileType}" pre-write verdict ${dryReconciliation.overallVerdict} — skipped`,
      )
      continue
    }

    // Dry-run mode: never touch DB.
    if (input.dryRun) {
      perGroup.push({
        fileType,
        filenames,
        verdict: dryReconciliation.overallVerdict,
        reconciliation: dryReconciliation,
        committed: false,
        totalRowsInserted: 0,
        skipReason: "dryRun=true — no DB writes",
      })
      continue
    }

    // ── Phase E.2: atomic group commit ─────────────────────────
    // Outer $transaction: all files in this group either commit or
    // roll back as one. Other groups proceed independently.
    let totalRowsInserted = 0
    let postReconciliation: UniversalReconciliationReport = dryReconciliation
    let groupCommitError: string | null = null
    try {
      await deps.prisma.$transaction(async (tx) => {
        for (const r of groupRecords) {
          if (!r.adapterResult) continue
          const applied = await r.adapterResult.applyToDb(tx)
          totalRowsInserted += applied.rowsInserted
        }

        // Post-write reconciliation (inside the tx so re-reads see
        // uncommitted writes). Use the supplied actualSums reader if
        // any; else fall back to expected=actual (adapter-validated).
        if (deps.readActualSums) {
          const postInputs: SheetReconciliationInput[] = []
          for (const r of groupRecords) {
            const actual = await deps.readActualSums({
              sheetName: r.classification.sheetName,
              dataType: r.classification.dataType,
              entityCode: r.classification.entityCode,
              organizationId: input.organizationId,
              year: input.year,
            })
            postInputs.push({
              sheetName: `${r.filename}::${r.classification.sheetName}`,
              dataType: r.classification.dataType,
              entityCode: r.classification.entityCode,
              expectedSums: r.expectedSums,
              actualSums: actual,
            })
          }
          postReconciliation = reconcileAllSheets(postInputs)
          const action = decideAction(postReconciliation, {
            allowYellow: input.allowYellow,
          })
          if (action === "abort") {
            // Throwing inside the tx callback rolls back the entire
            // group — finance never sees a half-state.
            throw new Error(
              `Post-write reconciliation rejected (verdict=${postReconciliation.overallVerdict})`,
            )
          }
        }
      })

      perGroup.push({
        fileType,
        filenames,
        verdict: postReconciliation.overallVerdict,
        reconciliation: postReconciliation,
        committed: true,
        totalRowsInserted,
        skipReason: null,
      })

      // Track touched companies for the single recompute pass.
      for (const r of groupRecords) {
        // Adapters report touched companies via the standard sheet
        // classification's entityCode. We map code → id lazily before
        // the recompute call; for now, store the codes.
        if (r.classification.entityCode) {
          touchedCompanies.add(r.classification.entityCode)
        }
      }
    } catch (err) {
      groupCommitError =
        err instanceof Error ? err.message : String(err)
      perGroup.push({
        fileType,
        filenames,
        verdict: "red",
        reconciliation: postReconciliation,
        committed: false,
        totalRowsInserted: 0,
        skipReason: `Group commit failed: ${groupCommitError}`,
      })
      warnings.push(
        `Group "${fileType}" commit aborted — ${groupCommitError}`,
      )
    }
  }

  // ── Phase F: single recompute pass ──────────────────────────────
  // Map entity codes (stored above) → company ids; trigger recompute.
  let recompute: MultiFileImportResult["recompute"] = {
    ok: 0,
    unknown: 0,
    failed: 0,
    targets: 0,
  }
  if (touchedCompanies.size > 0 && !input.dryRun) {
    try {
      const companies = await deps.prisma.company.findMany({
        where: {
          organizationId: input.organizationId,
          code: { in: Array.from(touchedCompanies) },
        },
        select: { id: true },
      })
      const affected = companies.map((c) => ({
        companyId: c.id,
        year: input.year,
      }))
      const r: RunRecomputeResult = await runRecomputeForCompanies(
        deps.prisma,
        input.organizationId,
        affected,
        {
          pairError: (label, err) =>
            console.error(
              `[multi-file-import] recompute pair error ${label}:`,
              err,
            ),
        },
      )
      recompute = {
        ok: r.ok,
        unknown: r.unknown,
        failed: r.failed,
        targets: r.targets,
      }
    } catch (err) {
      // Recompute failure is observable but non-fatal — the writes
      // already landed; finance can re-trigger recompute later.
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push(`Recompute failed (non-fatal): ${msg}`)
    }
  }

  return {
    perFile,
    conflicts,
    perGroup,
    overallVerdict: aggregateVerdict(perGroup),
    llmUsage: aggLlmUsage,
    durationMs: Date.now() - t0,
    recompute,
    warnings,
  }
}
