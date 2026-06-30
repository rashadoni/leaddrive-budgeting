"use client"
/**
 * Phase 7.M Tier 5 (2026-05-20) — Multi-file AI Auto Import UI.
 *
 * Two-step flow for N files (1-10):
 *   Step 1: Drop files → POST /api/import/ai-auto-multi (preview/dryRun)
 *           → render per-file file-type detection + cross-file conflict
 *             banner (if any)
 *   Step 2: User clicks "Применить группы" → POST same files with apply=1
 *           → render per-group verdict (commit / rollback)
 *
 * Safety:
 *  - "Применить" button disabled while conflicts present (unless user
 *    explicitly chose "Force override")
 *  - File count cap (10) enforced client-side + server-side
 *  - Total size cap (20 MB) enforced client-side + server-side
 */
import { useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { useTranslations } from "next-intl"

interface ConflictOccurrence {
  filename: string
  value: number
}
interface CrossFileConflict {
  key: string
  occurrences: ConflictOccurrence[]
  spread: number
  spreadPct: number
}

interface SheetCounts {
  plf: number
  bs: number
  cf: number
  kpiFarming: number
  kpiProcessing: number
  capex: number
  sales: number
  landRegistry: number
  descriptions: number
  infoSummary: number
  unknown: number
}

interface FileTypeResult {
  fileType: string
  confidence: number
  reasoning: string
  sheetCounts: SheetCounts
}

interface SheetClassification {
  sheetName: string
  dataType: string
  entityCode: string | null
  confidence: number
  reasoning: string
  planKind?: "actual" | "budget" | null
  role?: "source" | "derived_summary"
  planKindSignal?: string
  roleSignal?: string
  entityCodeOverride?: string
}

interface PerFileResult {
  filename: string
  workbookProfile?: {
    filename?: string
    sheetCount: number
    totalRows?: number
    totalColumns?: number
    workbookPlanHint: "actual" | "budget" | "mixed" | "unknown"
    sourceLikeSheets: number
    summaryLikeSheets: number
    monthLikeSheets: number
    sheetsWithBuColumns: number
    sheetsWithFormulas?: number
    sheetsWithEliminations: number
    duplicateGroups: Array<{ id: string; sheetNames: string[] }>
    repeatedDataHints?: Array<{ sheetNames: string[]; reason: string }>
    sheets?: Array<Record<string, unknown>>
  } | null
  templateApplied?: {
    id: string
    name: string
    version: number
    structureHash: string
  }
  fileTypeResult: FileTypeResult
  classifications: SheetClassification[]
  semanticCoa?: {
    mappings: Array<{
      sheetName: string
      sourceLabel: string
      targetCode: string | null
      confidence: number
      action: "map" | "skip"
      source: string
      matchedLabel?: string
      reasoning: string
    }>
    reviewItems: Array<{
      sheetName: string
      dataType: "PLF" | "BS" | "CF"
      sourceLabel: string
      reason: string
      candidates: Array<{
        targetCode: string
        accountType: string
        confidence: number
        source: string
        matchedLabel: string
        reasoning: string
      }>
    }>
  }
  error: string | null
}

interface PerGroupResult {
  fileType: string
  filenames: string[]
  verdict: "green" | "yellow" | "red" | "skipped"
  committed: boolean
  totalRowsInserted: number
  skipReason: string | null
}

/** 2026-05-27 — per-sheet «affected indicators» preview projection.
 *  Server computes via affectedIndicatorsForDataType() against
 *  indicator-seeds.requiredInputs. Shown under each file in the preview
 *  step so the user can verify the AI classifier landed on the right
 *  dataType AND see which downstream indicators will move BEFORE applying. */
interface AffectedIndicator {
  code: string
  nameEn: string
  nameRu: string | null
  nameAz: string | null
  category: string
  industries: string[]
  matchedInput: string
}
interface SheetImpact {
  sheetName: string
  dataType: string
  entityCode: string | null
  confidence: number
  impact: {
    dataType: string
    writes: string
    note: string | null
    indicators: AffectedIndicator[]
  }
}

interface MultiFileApiResponse {
  ok: boolean
  mode?: "preview" | "applied"
  perFile: PerFileResult[]
  conflicts: CrossFileConflict[]
  perGroup: PerGroupResult[]
  overallVerdict: "green" | "yellow" | "red"
  llmUsage: {
    inputTokens: number
    outputTokens: number
    modelName: string
  }
  durationMs: number
  recompute: { ok: number; unknown: number; failed: number; targets: number }
  warnings: string[]
  error?: string
  templateUsage?: {
    requested: boolean
    matched: boolean
    template?: {
      id: string
      name: string
      version: number
      structureHash: string
      fileCount: number
    }
    skippedAiFiles: string[]
  }
  /** 2026-05-27 — indicators that moved from `unknown` → present
   *  thanks to this import. Surfaced as «✅ Closed N backlog items»
   *  banner below the apply result. */
  backlogClosed?: Array<{ companyCode: string; indicatorCode: string }>
  /** 2026-05-27 — per-file map of sheet-level impact projections. Read
   *  by the preview card to render confidence + affected-indicator list
   *  per classified sheet. */
  sheetImpactsByFilename?: Record<string, SheetImpact[]>
  buColumnSplits?: Array<{
    filename: string
    sheetName: string
    mapping: Array<{
      sheetName: string
      entityCode: string | null
      buValue: string
      rowCount: number
      action: "write" | "skip"
      reason?: "elimination" | "unknown_alias"
    }>
    warnings: string[]
  }>
}

interface CoaDecision {
  filename: string
  sheetName: string
  sourceLabel: string
  targetCode: string | null
  confidence: number
  action: "map" | "skip"
}

interface SheetFix {
  filename: string
  sheetName: string
  entityCode?: string
  planKind?: "actual" | "budget"
  role?: "source" | "derived_summary"
}

interface EntityAliasCompany {
  code: string
  name: string | null
  level?: number | null
}

interface EntityAliasRow {
  alias: string
  code: string
}

interface EntityAliasesApiResponse {
  ok: boolean
  aliases?: Record<string, string>
  companies?: EntityAliasCompany[]
  rejected?: string[]
  error?: string
}

const MAX_FILES = 10
const MAX_TOTAL_BYTES = 20 * 1024 * 1024

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function verdictColor(v: string): string {
  if (v === "green") return "text-emerald-700 bg-emerald-50 border-emerald-200"
  if (v === "yellow") return "text-amber-700 bg-amber-50 border-amber-200"
  if (v === "red") return "text-red-700 bg-red-50 border-red-200"
  return "text-slate-500 bg-slate-50 border-slate-200"
}

function verdictEmoji(v: string): string {
  if (v === "green") return "🟢"
  if (v === "yellow") return "🟡"
  if (v === "red") return "🔴"
  return "⚪"
}

function coaDecisionKey(
  filename: string,
  sheetName: string,
  sourceLabel: string,
): string {
  return `${filename}\u001f${sheetName}\u001f${sourceLabel}`
}

function sheetFixKey(filename: string, sheetName: string): string {
  return `${filename}\u001f${sheetName}`
}

/** Map LLM classifier confidence (0..1) → readable band + Tailwind chip class.
 *  Mirrors `confidenceBand()` in datatype-indicator-map.ts but inlined here so
 *  the component stays self-contained and tree-shakes cleanly. */
function confidenceClass(
  c: number,
  t: (k: string) => string,
): {
  label: string
  pct: string
  cls: string
  bar: string
} {
  const pct = `${Math.round(Math.max(0, Math.min(1, c)) * 100)}%`
  if (c >= 0.85) {
    return {
      label: t("confidence.high"),
      pct,
      cls: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300",
      bar: "bg-emerald-500",
    }
  }
  if (c >= 0.65) {
    return {
      label: t("confidence.medium"),
      pct,
      cls: "bg-amber-50 text-amber-800 ring-1 ring-amber-300",
      bar: "bg-amber-500",
    }
  }
  return {
    label: t("confidence.low"),
    pct,
    cls: "bg-rose-50 text-rose-800 ring-1 ring-rose-300",
    bar: "bg-rose-500",
  }
}

/** Per-dataType chip color. Maps the discrete classifier outputs to a
 *  consistent palette so the user learns at-a-glance which colour is
 *  which file-type. */
function dataTypeChipClass(dt: string): string {
  switch (dt) {
    case "PLF":
      return "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
    case "BS":
      return "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200"
    case "CF":
      return "bg-teal-50 text-teal-700 ring-1 ring-teal-200"
    case "KPI_FARMING":
      return "bg-lime-50 text-lime-800 ring-1 ring-lime-300"
    case "KPI_PROCESSING":
      return "bg-orange-50 text-orange-800 ring-1 ring-orange-300"
    case "LAND_REGISTRY":
      return "bg-amber-50 text-amber-800 ring-1 ring-amber-300"
    case "SALES":
      return "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200"
    case "CAPEX":
      return "bg-violet-50 text-violet-700 ring-1 ring-violet-200"
    case "DESCRIPTIONS":
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
    case "OPS_FACTS":
      return "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
    case "BUDGET_ACTUALS":
    case "SALES_FORECAST":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
    case "INFO_SUMMARY":
      return "bg-gray-100 text-gray-600 ring-1 ring-gray-200"
    case "COMPANIES":
      return "bg-stone-100 text-stone-700 ring-1 ring-stone-200"
    default:
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
  }
}

export function MultiFileForm() {
  const t = useTranslations("adminAiImport.multi")
  const [files, setFiles] = useState<File[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [previewResult, setPreviewResult] =
    useState<MultiFileApiResponse | null>(null)
  const [applyResult, setApplyResult] =
    useState<MultiFileApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forceOverride, setForceOverride] = useState(false)
  const [useTemplates, setUseTemplates] = useState(true)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [templateSaveStatus, setTemplateSaveStatus] = useState<string | null>(null)
  const [coaDecisions, setCoaDecisions] = useState<Record<string, CoaDecision>>(
    {},
  )
  const [sheetFixes, setSheetFixes] = useState<Record<string, SheetFix>>({})
  const [previewFixSignature, setPreviewFixSignature] = useState("[]")
  const [aliasEditorOpen, setAliasEditorOpen] = useState(false)
  const [aliasRows, setAliasRows] = useState<EntityAliasRow[]>([])
  const [aliasCompanies, setAliasCompanies] = useState<EntityAliasCompany[]>([])
  const [aliasesLoaded, setAliasesLoaded] = useState(false)
  const [isLoadingAliases, setIsLoadingAliases] = useState(false)
  const [isSavingAliases, setIsSavingAliases] = useState(false)
  const [aliasStatus, setAliasStatus] = useState<string | null>(null)
  // Phase 7.M Tier 6 — per-conflict resolution map. Key = conflict key
  // (e.g. "AZSEKER-CPC::PLF.01::2026-01"), value = either
  //   { mode: "pick", filename: <filename to win> }  — use that file's value
  //   { mode: "skip" }                                — drop the cell entirely
  // Empty / undefined entries leave the conflict unresolved; the apply
  // button stays disabled until every conflict either has a resolution
  // OR `forceOverride` is checked (legacy escape hatch).
  type Resolution =
    | { mode: "pick"; filename: string }
    | { mode: "skip" }
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const applyResultRef = useRef<HTMLDivElement>(null)
  const conflictBannerRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  const overSizeCap = totalBytes > MAX_TOTAL_BYTES
  const overCountCap = files.length > MAX_FILES
  const hasConflicts = (previewResult?.conflicts.length ?? 0) > 0
  const coaReviewItems =
    previewResult?.perFile.flatMap((f) =>
      (f.semanticCoa?.reviewItems ?? []).map((item) => ({
        ...item,
        filename: f.filename,
      })),
    ) ?? []
  const hasUnresolvedCoaReviews = coaReviewItems.some(
    (item) =>
      !coaDecisions[
        coaDecisionKey(item.filename, item.sheetName, item.sourceLabel)
      ],
  )
  const guidedFixItems =
    previewResult?.perFile.flatMap((f) =>
      f.classifications
        .filter(
          (cls) =>
            ["PLF", "BS", "CF"].includes(cls.dataType) ||
            !cls.entityCode ||
            cls.planKind === null ||
            cls.role === "derived_summary" ||
            cls.confidence < 0.65,
        )
        .map((cls) => ({
          filename: f.filename,
          classification: cls,
        })),
    ) ?? []
  const sheetFixList = Object.values(sheetFixes).filter(
    (fix) =>
      fix.entityCode !== undefined ||
      fix.planKind !== undefined ||
      fix.role !== undefined,
  )
  const currentFixSignature = JSON.stringify(
    sheetFixList
      .map((fix) => ({
        filename: fix.filename,
        sheetName: fix.sheetName,
        entityCode: fix.entityCode ?? null,
        planKind: fix.planKind ?? null,
        role: fix.role ?? null,
      }))
      .sort((a, b) =>
        `${a.filename}\u001f${a.sheetName}`.localeCompare(
          `${b.filename}\u001f${b.sheetName}`,
        ),
      ),
  )
  const hasStaleSheetFixes =
    !!previewResult && currentFixSignature !== previewFixSignature
  const allConflictsResolved =
    hasConflicts &&
    (previewResult?.conflicts ?? []).every((c) => resolutions[c.key])
  const activeTemplate = previewResult?.templateUsage?.template
  const buRoutingSplits = previewResult?.buColumnSplits ?? []
  const entityOptions = Array.from(
    new Map(
      [
        ...aliasCompanies.map((company) => [
          company.code,
          company.name ? `${company.name} (${company.code})` : company.code,
        ] as const),
        ...(previewResult?.perFile.flatMap((f) =>
          f.classifications
            .map((classification) => classification.entityCode)
            .filter((code): code is string => !!code)
            .map((code) => [code, code] as const),
        ) ?? []),
      ].filter(([code]) => !!code),
    ),
  )
  const canSaveTemplate =
    !!previewResult &&
    previewResult.overallVerdict === "green" &&
    !hasConflicts &&
    !hasUnresolvedCoaReviews &&
    !hasStaleSheetFixes &&
    previewResult.perFile.some(
      (f) => f.workbookProfile && f.classifications.length > 0,
    )

  function handleFiles(newFiles: FileList | File[]): void {
    const incoming = Array.from(newFiles).filter((f) =>
      f.name.toLowerCase().endsWith(".xlsx"),
    )
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_FILES))
    setPreviewResult(null)
    setApplyResult(null)
    setError(null)
    setTemplateSaveStatus(null)
    setCoaDecisions({})
    setSheetFixes({})
    setPreviewFixSignature("[]")
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  function onSelect(e: ChangeEvent<HTMLInputElement>): void {
    if (e.target.files) handleFiles(e.target.files)
  }

  function removeFile(idx: number): void {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
    setPreviewResult(null)
    setApplyResult(null)
    setTemplateSaveStatus(null)
    setCoaDecisions({})
    setSheetFixes({})
    setPreviewFixSignature("[]")
  }

  function resetAll(): void {
    setFiles([])
    setPreviewResult(null)
    setApplyResult(null)
    setError(null)
    setForceOverride(false)
    setUseTemplates(true)
    setResolutions({})
    setTemplateSaveStatus(null)
    setCoaDecisions({})
    setSheetFixes({})
    setPreviewFixSignature("[]")
    if (inputRef.current) inputRef.current.value = ""
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function loadEntityAliases(): Promise<void> {
    setIsLoadingAliases(true)
    setAliasStatus(null)
    try {
      const res = await fetch("/api/import/entity-aliases")
      const data = (await res.json()) as EntityAliasesApiResponse
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const aliases = data.aliases ?? {}
      setAliasRows(
        Object.entries(aliases)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([alias, code]) => ({ alias, code })),
      )
      setAliasCompanies(data.companies ?? [])
      setAliasesLoaded(true)
      setAliasStatus(t("aliases.loaded", { n: Object.keys(aliases).length }))
    } catch (err) {
      setAliasStatus(
        t("aliases.error", {
          msg: err instanceof Error ? err.message : String(err),
        }),
      )
    } finally {
      setIsLoadingAliases(false)
    }
  }

  function aliasRowsToMap(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const row of aliasRows) {
      const alias = row.alias.trim().toUpperCase().replace(/\s+/g, " ")
      const code = row.code.trim()
      if (alias && code) out[alias] = code
    }
    return out
  }

  function updateSheetFix(
    filename: string,
    sheetName: string,
    patch: Partial<Omit<SheetFix, "filename" | "sheetName">>,
  ): void {
    const key = sheetFixKey(filename, sheetName)
    setSheetFixes((prev) => {
      const current = prev[key] ?? { filename, sheetName }
      const next = { ...current, ...patch }
      if (next.entityCode === undefined && next.planKind === undefined && next.role === undefined) {
        const copy = { ...prev }
        delete copy[key]
        return copy
      }
      return { ...prev, [key]: next }
    })
    setApplyResult(null)
  }

  async function saveEntityAliases(): Promise<void> {
    setIsSavingAliases(true)
    setAliasStatus(null)
    try {
      const res = await fetch("/api/import/entity-aliases", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aliases: aliasRowsToMap() }),
      })
      const data = (await res.json()) as EntityAliasesApiResponse
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const aliases = data.aliases ?? {}
      setAliasRows(
        Object.entries(aliases)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([alias, code]) => ({ alias, code })),
      )
      setAliasCompanies(data.companies ?? aliasCompanies)
      const rejected = data.rejected?.length
        ? ` ${t("aliases.rejected", { n: data.rejected.length })}`
        : ""
      setAliasStatus(
        `${t("aliases.saved", { n: Object.keys(aliases).length })}${rejected}`,
      )
      setAliasesLoaded(true)
      setPreviewResult(null)
      setApplyResult(null)
    } catch (err) {
      setAliasStatus(
        t("aliases.error", {
          msg: err instanceof Error ? err.message : String(err),
        }),
      )
    } finally {
      setIsSavingAliases(false)
    }
  }

  async function submit(apply: boolean): Promise<void> {
    if (files.length === 0) return
    setIsProcessing(true)
    setError(null)
    if (apply) {
      setApplyResult(null)
    } else {
      setPreviewResult(null)
    }
    try {
      const form = new FormData()
      for (const f of files) form.append("files", f)
      form.append("year", String(new Date().getFullYear()))
      form.append("useTemplate", useTemplates ? "1" : "0")
      if (apply) form.append("apply", "1")
      if (forceOverride) form.append("forceOverride", "1")
      // Per-conflict resolutions take precedence over forceOverride —
      // when both are present the orchestrator honors the resolution
      // map first, then falls back to last-write-wins for any conflict
      // not in the map.
      if (apply && Object.keys(resolutions).length > 0) {
        form.append("conflictResolutions", JSON.stringify(resolutions))
      }
      const selectedCoaDecisions = Object.values(coaDecisions)
      if (selectedCoaDecisions.length > 0) {
        form.append("semanticCoaMappings", JSON.stringify(selectedCoaDecisions))
      }
      if (sheetFixList.length > 0) {
        form.append("guidedSheetFixes", JSON.stringify(sheetFixList))
      }
      const res = await fetch("/api/import/ai-auto-multi", {
        method: "POST",
        body: form,
      })
      const data = (await res.json()) as MultiFileApiResponse
      if (!res.ok && res.status !== 409) {
        setError(data.error ?? `HTTP ${res.status}`)
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50)
        return
      }
      if (apply) {
        setApplyResult(data)
        setTimeout(() => applyResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
      } else {
        setPreviewResult(data)
        setPreviewFixSignature(currentFixSignature)
        // Scroll to conflict banner if conflicts exist, otherwise to the analysis section
        if ((data.conflicts?.length ?? 0) > 0) {
          setTimeout(() => conflictBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsProcessing(false)
    }
  }

  async function saveTemplate(): Promise<void> {
    if (!previewResult || !canSaveTemplate) return
    const templateFiles = previewResult.perFile
      .filter((f) => f.workbookProfile && f.classifications.length > 0)
      .map((f) => {
        const mappingsBySheet = new Map<string, CoaDecision[]>()
        for (const mapping of f.semanticCoa?.mappings ?? []) {
          const item: CoaDecision = {
            filename: f.filename,
            sheetName: mapping.sheetName,
            sourceLabel: mapping.sourceLabel,
            targetCode: mapping.targetCode,
            confidence: mapping.confidence,
            action: mapping.action,
          }
          mappingsBySheet.set(mapping.sheetName, [
            ...(mappingsBySheet.get(mapping.sheetName) ?? []),
            item,
          ])
        }
        for (const decision of Object.values(coaDecisions)) {
          if (decision.filename !== f.filename) continue
          mappingsBySheet.set(decision.sheetName, [
            ...(mappingsBySheet.get(decision.sheetName) ?? []),
            decision,
          ])
        }
        const classifications = f.classifications.map((classification) => {
          const seen = new Set<string>()
          const coaMappings = (mappingsBySheet.get(classification.sheetName) ?? [])
            .filter((mapping) => {
              const key = mapping.sourceLabel.trim().toLowerCase()
              if (!key || seen.has(key)) return false
              seen.add(key)
              return true
            })
            .map((mapping) => ({
              sourceLabel: mapping.sourceLabel,
              targetCode: mapping.targetCode,
              confidence: mapping.confidence,
              action: mapping.action,
            }))
          return coaMappings.length > 0
            ? { ...classification, coaMappings }
            : classification
        })
        return {
          filename: f.filename,
          workbookProfile: f.workbookProfile,
          classifications,
        }
      })
    setIsSavingTemplate(true)
    setTemplateSaveStatus(null)
    try {
      const res = await fetch("/api/import/ai-auto-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: activeTemplate?.id,
          name:
            activeTemplate?.name ??
            `AI import template (${templateFiles.map((f) => f.filename).join(", ")})`,
          files: templateFiles,
        }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        template?: { name: string; version: number }
      }
      if (!res.ok || !data.ok || !data.template) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setTemplateSaveStatus(
        t(activeTemplate ? "template.updated" : "template.saved", {
          name: data.template.name,
          version: data.template.version,
        }),
      )
    } catch (err) {
      setTemplateSaveStatus(
        t("template.saveError", {
          msg: err instanceof Error ? err.message : String(err),
        }),
      )
    } finally {
      setIsSavingTemplate(false)
    }
  }

  return (
    <div className="space-y-6">
      <div
        className="rounded-lg border border-slate-200 bg-white p-4 text-sm"
        data-testid="entity-aliases-panel"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">
              {t("aliases.title")}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {t("aliases.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const nextOpen = !aliasEditorOpen
              setAliasEditorOpen(nextOpen)
              if (nextOpen && !aliasesLoaded && !isLoadingAliases) {
                void loadEntityAliases()
              }
            }}
            className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            data-testid="btn-toggle-aliases"
          >
            {aliasEditorOpen ? t("aliases.close") : t("aliases.open")}
          </button>
        </div>
        {aliasEditorOpen && (
          <div className="mt-4 space-y-3" data-testid="entity-aliases-editor">
            {isLoadingAliases ? (
              <p className="text-xs text-slate-500">{t("aliases.loading")}</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5">{t("aliases.col.alias")}</th>
                        <th className="px-2 py-1.5">{t("aliases.col.company")}</th>
                        <th className="px-2 py-1.5 text-right">{t("aliases.col.action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aliasRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-2 py-3 text-center text-slate-400"
                          >
                            {t("aliases.empty")}
                          </td>
                        </tr>
                      )}
                      {aliasRows.map((row, idx) => (
                        <tr key={`${row.alias}-${idx}`} className="border-t">
                          <td className="px-2 py-1.5">
                            <input
                              value={row.alias}
                              onChange={(e) => {
                                const value = e.target.value
                                setAliasRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, alias: value } : r,
                                  ),
                                )
                              }}
                              className="w-full min-w-[9rem] rounded border border-slate-200 px-2 py-1"
                              placeholder={t("aliases.aliasPlaceholder")}
                              data-testid={`entity-alias-input-${idx}`}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={row.code}
                              onChange={(e) => {
                                const value = e.target.value
                                setAliasRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, code: value } : r,
                                  ),
                                )
                              }}
                              className="w-full min-w-[14rem] rounded border border-slate-200 bg-white px-2 py-1"
                              data-testid={`entity-alias-company-${idx}`}
                            >
                              <option value="">{t("aliases.companyPlaceholder")}</option>
                              {aliasCompanies.map((company) => (
                                <option key={company.code} value={company.code}>
                                  {company.name
                                    ? `${company.name} (${company.code})`
                                    : company.code}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setAliasRows((prev) =>
                                  prev.filter((_, i) => i !== idx),
                                )
                              }
                              className="rounded px-2 py-1 text-slate-500 hover:bg-red-50 hover:text-red-700"
                              data-testid={`entity-alias-remove-${idx}`}
                            >
                              {t("aliases.remove")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setAliasRows((prev) => [
                        ...prev,
                        { alias: "", code: aliasCompanies[0]?.code ?? "" },
                      ])
                    }
                    className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    data-testid="btn-add-alias"
                  >
                    {t("aliases.add")}
                  </button>
                  <button
                    type="button"
                    disabled={isSavingAliases}
                    onClick={saveEntityAliases}
                    className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-800"
                    data-testid="btn-save-aliases"
                  >
                    {isSavingAliases ? t("aliases.saving") : t("aliases.save")}
                  </button>
                  {aliasStatus && (
                    <span
                      className="text-xs text-slate-500"
                      data-testid="entity-alias-status"
                    >
                      {aliasStatus}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Drop zone */}
      <div
        data-testid="multi-drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={onSelect}
          data-testid="multi-file-input"
        />
        <p className="text-sm text-slate-600">
          {t("dropZone.empty", { max: MAX_FILES })}
        </p>
        <p className="text-xs text-slate-400 mt-1">
          {t("dropZone.limits", {
            max: MAX_FILES,
            mb: MAX_TOTAL_BYTES / 1024 / 1024,
          })}
        </p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between bg-slate-100 px-4 py-2 border-b">
            <span className="text-sm font-medium">
              {t("fileList.count", { n: files.length })} · {formatBytes(totalBytes)}
            </span>
            {(overSizeCap || overCountCap) && (
              <span className="text-xs text-red-600 font-medium">
                {t("fileList.overLimit")}
              </span>
            )}
          </div>
          <ul className="divide-y">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between px-4 py-2 text-sm"
                data-testid={`file-row-${i}`}
              >
                <span className="truncate">{f.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-500">
                    {formatBytes(f.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-slate-400 hover:text-red-600 px-2"
                    aria-label={`Remove ${f.name}`}
                    data-testid={`remove-file-${i}`}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Step 1 button */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={
            files.length === 0 || isProcessing || overSizeCap || overCountCap
          }
          onClick={() => submit(false)}
          className="px-4 py-2 bg-slate-900 text-white rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
          data-testid="btn-analyze"
        >
          {isProcessing && !applyResult ? t("step1.running") : t("step1.button")}
        </button>
        <label
          className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          data-testid="use-template-toggle"
        >
          <input
            type="checkbox"
            checked={useTemplates}
            onChange={(e) => {
              setUseTemplates(e.target.checked)
              setPreviewResult(null)
              setApplyResult(null)
              setTemplateSaveStatus(null)
            }}
          />
          <span>{t("template.useSaved")}</span>
        </label>
        {previewResult && (
          <button
            type="button"
            disabled={
              isProcessing ||
              hasUnresolvedCoaReviews ||
              hasStaleSheetFixes ||
              (hasConflicts && !forceOverride && !allConflictsResolved)
            }
            onClick={() => submit(true)}
            className="px-4 py-2 bg-emerald-600 text-white rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700"
            data-testid="btn-apply"
          >
            {isProcessing && previewResult ? t("step2.running") : t("step2.button")}
          </button>
        )}
      </div>

      {/* Error banner — sits right below buttons so it's always visible */}
      {error && (
        <div
          ref={errorRef}
          className="rounded border border-red-300 bg-red-50 text-red-700 p-3 text-sm"
          data-testid="error-banner"
        >
          ❌ {error}
        </div>
      )}

      {/* Processing banner — shown while Step 2 is running */}
      {isProcessing && previewResult && (
        <div className="rounded border border-emerald-300 bg-emerald-50 text-emerald-800 p-3 text-sm flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <span>{t("applying")}</span>
        </div>
      )}

      {/* Conflict banner */}
      {previewResult && hasConflicts && (
        <div
          ref={conflictBannerRef}
          className="rounded border border-red-300 bg-red-50 p-4 space-y-3"
          data-testid="conflict-banner"
        >
          <h3 className="font-semibold text-red-800">
            {t("conflict.title", { n: previewResult.conflicts.length })}
          </h3>
          <p className="text-xs text-red-700">
            {t("conflict.description")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-2">{t("conflict.col.cell")}</th>
                  <th className="py-1 pr-2">{t("conflict.col.values")}</th>
                  <th className="py-1 pr-2 text-right">{t("conflict.col.spread")}</th>
                  <th className="py-1 pr-2">{t("conflict.col.resolution")}</th>
                </tr>
              </thead>
              <tbody>
                {previewResult.conflicts.slice(0, 20).map((c) => {
                  const current = resolutions[c.key]
                  const selectValue = !current
                    ? ""
                    : current.mode === "skip"
                      ? "__skip__"
                      : current.filename
                  return (
                    <tr
                      key={c.key}
                      className="border-b last:border-b-0"
                      data-testid={`conflict-row-${c.key}`}
                    >
                      <td className="py-1 pr-2 font-mono">{c.key}</td>
                      <td className="py-1 pr-2">
                        {c.occurrences
                          .map(
                            (o) =>
                              `${o.filename}=${o.value.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}`,
                          )
                          .join(", ")}
                      </td>
                      <td className="py-1 pr-2 text-right font-medium">
                        {(c.spreadPct * 100).toFixed(2)}%
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          value={selectValue}
                          onChange={(e) => {
                            const v = e.target.value
                            setResolutions((prev) => {
                              const next = { ...prev }
                              if (v === "") {
                                delete next[c.key]
                              } else if (v === "__skip__") {
                                next[c.key] = { mode: "skip" }
                              } else {
                                next[c.key] = { mode: "pick", filename: v }
                              }
                              return next
                            })
                          }}
                          data-testid={`resolution-${c.key}`}
                          className="text-xs border rounded px-1 py-0.5 bg-white"
                        >
                          <option value="">{t("conflict.pickPlaceholder")}</option>
                          {c.occurrences.map((o) => (
                            <option key={o.filename} value={o.filename}>
                              {t("conflict.useFile", { name: o.filename })}
                            </option>
                          ))}
                          <option value="__skip__">{t("conflict.skipCell")}</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {previewResult.conflicts.length > 20 && (
              <p className="text-xs text-red-600 mt-2">
                {t("conflict.moreOmitted", { n: previewResult.conflicts.length - 20 })}
              </p>
            )}
          </div>
          {allConflictsResolved && (
            <p className="text-xs text-emerald-700 font-medium" data-testid="all-resolved">
              {t("conflict.allResolved")}
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-700 border-t pt-2">
            <input
              type="checkbox"
              checked={forceOverride}
              onChange={(e) => setForceOverride(e.target.checked)}
              data-testid="force-override"
            />
            <span>{t("conflict.forceOverride")}</span>
          </label>
        </div>
      )}

      {previewResult && coaReviewItems.length > 0 && (
        <div
          className="rounded border border-amber-300 bg-amber-50 p-4 space-y-3"
          data-testid="coa-review-banner"
        >
          <div>
            <h3 className="font-semibold text-amber-900">
              {t("coaReview.title", { n: coaReviewItems.length })}
            </h3>
            <p className="text-xs text-amber-800 mt-1">
              {t("coaReview.description")}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-amber-200 text-left">
                  <th className="py-1 pr-2">{t("coaReview.col.source")}</th>
                  <th className="py-1 pr-2">{t("coaReview.col.reason")}</th>
                  <th className="py-1 pr-2">{t("coaReview.col.decision")}</th>
                </tr>
              </thead>
              <tbody>
                {coaReviewItems.map((item) => {
                  const key = coaDecisionKey(
                    item.filename,
                    item.sheetName,
                    item.sourceLabel,
                  )
                  const selected = coaDecisions[key]
                  const selectedValue = !selected
                    ? ""
                    : selected.action === "skip"
                      ? "__skip__"
                      : selected.targetCode ?? ""
                  return (
                    <tr
                      key={key}
                      className="border-b border-amber-100 last:border-b-0"
                    >
                      <td className="py-1.5 pr-2 align-top">
                        <div className="font-medium text-slate-900">
                          {item.sourceLabel}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {item.filename} · {item.sheetName} · {item.dataType}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 align-top text-amber-900">
                        {item.reason}
                      </td>
                      <td className="py-1.5 pr-2 align-top">
                        <select
                          value={selectedValue}
                          onChange={(e) => {
                            const value = e.target.value
                            setCoaDecisions((prev) => {
                              const next = { ...prev }
                              if (!value) {
                                delete next[key]
                                return next
                              }
                              if (value === "__skip__") {
                                next[key] = {
                                  filename: item.filename,
                                  sheetName: item.sheetName,
                                  sourceLabel: item.sourceLabel,
                                  targetCode: null,
                                  confidence: 1,
                                  action: "skip",
                                }
                                return next
                              }
                              const candidate = item.candidates.find(
                                (c) => c.targetCode === value,
                              )
                              next[key] = {
                                filename: item.filename,
                                sheetName: item.sheetName,
                                sourceLabel: item.sourceLabel,
                                targetCode: value,
                                confidence: candidate?.confidence ?? 1,
                                action: "map",
                              }
                              return next
                            })
                          }}
                          className="w-full min-w-[14rem] rounded border border-amber-200 bg-white px-2 py-1"
                          data-testid={`coa-review-${encodeURIComponent(key)}`}
                        >
                          <option value="">{t("coaReview.pickPlaceholder")}</option>
                          {item.candidates.map((candidate) => (
                            <option
                              key={candidate.targetCode}
                              value={candidate.targetCode}
                            >
                              {t("coaReview.useCode", {
                                code: candidate.targetCode,
                                pct: Math.round(candidate.confidence * 100),
                              })}
                            </option>
                          ))}
                          <option value="__skip__">
                            {t("coaReview.skipRow")}
                          </option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!hasUnresolvedCoaReviews && (
            <p className="text-xs font-medium text-emerald-700">
              {t("coaReview.allResolved")}
            </p>
          )}
        </div>
      )}

      {previewResult && guidedFixItems.length > 0 && (
        <div
          className="rounded border border-violet-200 bg-violet-50 p-4 space-y-3"
          data-testid="guided-fixes-panel"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-violet-950">
                {t("fixes.title", { n: guidedFixItems.length })}
              </h3>
              <p className="mt-1 text-xs text-violet-900">
                {t("fixes.description")}
              </p>
            </div>
            {aliasCompanies.length === 0 && (
              <button
                type="button"
                onClick={loadEntityAliases}
                disabled={isLoadingAliases}
                className="rounded border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-800 disabled:opacity-50"
                data-testid="btn-load-fix-companies"
              >
                {isLoadingAliases ? t("aliases.loading") : t("fixes.loadCompanies")}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-violet-200 text-left">
                  <th className="py-1 pr-2">{t("fixes.col.sheet")}</th>
                  <th className="py-1 pr-2">{t("fixes.col.company")}</th>
                  <th className="py-1 pr-2">{t("fixes.col.plan")}</th>
                  <th className="py-1 pr-2">{t("fixes.col.role")}</th>
                </tr>
              </thead>
              <tbody>
                {guidedFixItems.map(({ filename, classification }) => {
                  const key = sheetFixKey(filename, classification.sheetName)
                  const fix = sheetFixes[key]
                  const entityValue =
                    fix?.entityCode ?? classification.entityCode ?? ""
                  const planValue = fix?.planKind ?? classification.planKind ?? ""
                  const roleValue = fix?.role ?? classification.role ?? "source"
                  return (
                    <tr
                      key={key}
                      className="border-b border-violet-100 last:border-b-0"
                    >
                      <td className="py-1.5 pr-2 align-top">
                        <div className="font-medium text-slate-900">
                          {classification.sheetName}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {filename} · {classification.dataType} ·{" "}
                          {Math.round(classification.confidence * 100)}%
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 align-top">
                        <select
                          value={entityValue}
                          onChange={(e) => {
                            const value = e.target.value
                            updateSheetFix(filename, classification.sheetName, {
                              entityCode: value || undefined,
                            })
                          }}
                          className="w-full min-w-[12rem] rounded border border-violet-200 bg-white px-2 py-1"
                          data-testid={`fix-entity-${encodeURIComponent(key)}`}
                        >
                          <option value="">
                            {t("fixes.noCompany")}
                          </option>
                          {entityOptions.map(([code, label]) => (
                            <option key={code} value={code}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2 align-top">
                        <select
                          value={planValue}
                          onChange={(e) => {
                            const value = e.target.value
                            updateSheetFix(filename, classification.sheetName, {
                              planKind:
                                value === "actual" || value === "budget"
                                  ? value
                                  : undefined,
                            })
                          }}
                          className="w-full min-w-[8rem] rounded border border-violet-200 bg-white px-2 py-1"
                          data-testid={`fix-plan-${encodeURIComponent(key)}`}
                        >
                          <option value="">{t("fixes.planAuto")}</option>
                          <option value="actual">{t("fixes.planActual")}</option>
                          <option value="budget">{t("fixes.planBudget")}</option>
                        </select>
                      </td>
                      <td className="py-1.5 pr-2 align-top">
                        <select
                          value={roleValue}
                          onChange={(e) => {
                            const value = e.target.value
                            updateSheetFix(filename, classification.sheetName, {
                              role:
                                value === "derived_summary"
                                  ? "derived_summary"
                                  : "source",
                            })
                          }}
                          className="w-full min-w-[9rem] rounded border border-violet-200 bg-white px-2 py-1"
                          data-testid={`fix-role-${encodeURIComponent(key)}`}
                        >
                          <option value="source">{t("fixes.roleSource")}</option>
                          <option value="derived_summary">
                            {t("fixes.roleSkip")}
                          </option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isProcessing || sheetFixList.length === 0}
              onClick={() => submit(false)}
              className="rounded bg-violet-700 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-violet-800"
              data-testid="btn-rerun-fixes"
            >
              {isProcessing ? t("step1.running") : t("fixes.rerun")}
            </button>
            {hasStaleSheetFixes ? (
              <span
                className="text-xs font-medium text-amber-800"
                data-testid="stale-fixes-warning"
              >
                {t("fixes.stale")}
              </span>
            ) : sheetFixList.length > 0 ? (
              <span className="text-xs font-medium text-emerald-700">
                {t("fixes.appliedToPreview")}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {previewResult && buRoutingSplits.length > 0 && (
        <div
          className="rounded border border-cyan-200 bg-cyan-50 p-4 space-y-3"
          data-testid="bu-routing-grid"
        >
          <div>
            <h3 className="font-semibold text-cyan-900">
              {t("routing.title", { n: buRoutingSplits.length })}
            </h3>
            <p className="mt-1 text-xs text-cyan-800">
              {t("routing.description")}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-cyan-200 text-left">
                  <th className="py-1 pr-2">{t("routing.col.source")}</th>
                  <th className="py-1 pr-2">{t("routing.col.bu")}</th>
                  <th className="py-1 pr-2">{t("routing.col.target")}</th>
                  <th className="py-1 pr-2 text-right">{t("routing.col.rows")}</th>
                  <th className="py-1 pr-2">{t("routing.col.action")}</th>
                </tr>
              </thead>
              <tbody>
                {buRoutingSplits.flatMap((split) =>
                  split.mapping.map((row, idx) => (
                    <tr
                      key={`${split.filename}-${split.sheetName}-${row.buValue}-${idx}`}
                      className="border-b border-cyan-100 last:border-b-0"
                    >
                      <td className="py-1.5 pr-2 align-top">
                        <div className="font-medium text-slate-900">
                          {split.sheetName}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {split.filename}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 align-top font-mono">
                        {row.buValue}
                      </td>
                      <td className="py-1.5 pr-2 align-top font-mono">
                        {row.entityCode ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 align-top text-right">
                        {row.rowCount.toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-2 align-top">
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium ${
                            row.action === "write"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-orange-100 text-orange-800"
                          }`}
                        >
                          {row.action === "write"
                            ? t("routing.write")
                            : row.reason === "elimination"
                              ? t("routing.skipElim")
                              : t("routing.skipUnknown")}
                        </span>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Preview result — 2026-05-27 expanded: per-sheet dataType chip,
          AI confidence bar, and affected-indicators chip list, so the
          admin can verify both classification correctness AND downstream
          impact before clicking Apply. */}
      {previewResult && previewResult.perFile.length > 0 && (
        <div className="space-y-3" data-testid="preview-result">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold text-sm">{t("preview.title")}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {t("preview.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!canSaveTemplate || isSavingTemplate}
                onClick={saveTemplate}
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-800"
                data-testid="btn-save-template"
              >
                {isSavingTemplate
                  ? t("template.saving")
                  : activeTemplate
                    ? t("template.updateButton")
                    : t("template.saveButton")}
              </button>
              <div className="text-[10px] text-slate-400 leading-tight text-right hidden md:block">
                <div>{t("preview.legendHigh")}</div>
                <div>{t("preview.legendMedium")}</div>
                <div>{t("preview.legendLow")}</div>
              </div>
            </div>
          </div>
          {previewResult.templateUsage && (
            <div
              className={`rounded border px-3 py-2 text-xs ${
                previewResult.templateUsage.matched
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
              data-testid="template-usage-banner"
            >
              {previewResult.templateUsage.matched && activeTemplate
                ? t("template.used", {
                    name: activeTemplate.name,
                    version: activeTemplate.version,
                    n: previewResult.templateUsage.skippedAiFiles.length,
                  })
                : previewResult.templateUsage.requested
                  ? t("template.noMatch")
                  : t("template.disabled")}
            </div>
          )}
          {templateSaveStatus && (
            <div
              className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800"
              data-testid="template-save-status"
            >
              {templateSaveStatus}
            </div>
          )}
          {previewResult.perFile.map((f) => {
            const impacts =
              previewResult.sheetImpactsByFilename?.[f.filename] ?? []
            return (
              <div
                key={f.filename}
                className="border rounded-lg p-3 text-sm space-y-2"
                data-testid={`preview-file-${f.filename}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{f.filename}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs border shrink-0 ${verdictColor(
                      f.error ? "red" : "green",
                    )}`}
                  >
                    {f.fileTypeResult.fileType}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  {f.fileTypeResult.reasoning}
                </p>
                {f.workbookProfile && (
                  <div
                    className="flex flex-wrap gap-1.5 text-[10px]"
                    data-testid={`workbook-profile-${f.filename}`}
                  >
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                      {t("preview.profilePlan", {
                        plan: f.workbookProfile.workbookPlanHint,
                      })}
                    </span>
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                      {t("preview.profileSource", {
                        n: f.workbookProfile.sourceLikeSheets,
                      })}
                    </span>
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                      {t("preview.profileSummary", {
                        n: f.workbookProfile.summaryLikeSheets,
                      })}
                    </span>
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                      {t("preview.profileMonths", {
                        n: f.workbookProfile.monthLikeSheets,
                      })}
                    </span>
                    {f.workbookProfile.sheetsWithBuColumns > 0 && (
                      <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-cyan-700">
                        {t("preview.profileBu", {
                          n: f.workbookProfile.sheetsWithBuColumns,
                        })}
                      </span>
                    )}
                    {f.workbookProfile.sheetsWithEliminations > 0 && (
                      <span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-700">
                        {t("preview.profileElim", {
                          n: f.workbookProfile.sheetsWithEliminations,
                        })}
                      </span>
                    )}
                    {f.workbookProfile.duplicateGroups.length > 0 && (
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">
                        {t("preview.profileDuplicates", {
                          n: f.workbookProfile.duplicateGroups.length,
                        })}
                      </span>
                    )}
                  </div>
                )}
                {f.error && (
                  <p className="text-xs text-red-700">⚠ {f.error}</p>
                )}
                {impacts.length > 0 && (
                  <div className="border-t pt-2 space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      {t("preview.sheetsHeading", { n: impacts.length })}
                    </div>
                    <ul className="space-y-1.5">
                      {impacts.map((imp) => {
                        const conf = confidenceClass(imp.confidence, t)
                        const hasIndicators = imp.impact.indicators.length > 0
                        return (
                          <li
                            key={imp.sheetName}
                            className="rounded border border-slate-200 px-2.5 py-2 bg-slate-50/40"
                            data-testid={`sheet-impact-${f.filename}-${imp.sheetName}`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[11px] text-slate-700 truncate max-w-[16rem]">
                                {imp.sheetName}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${dataTypeChipClass(imp.dataType)}`}
                              >
                                {imp.dataType}
                              </span>
                              {imp.entityCode && (
                                <span className="font-mono text-[10px] text-slate-500">
                                  {imp.entityCode}
                                </span>
                              )}
                              <div
                                className={`ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] ${conf.cls}`}
                                title={t("preview.aiConfidenceTooltip", { pct: conf.pct })}
                              >
                                <span>{conf.label}</span>
                                <span className="font-mono opacity-70">
                                  {conf.pct}
                                </span>
                              </div>
                            </div>
                            {/* confidence bar — visual reinforcement */}
                            <div className="mt-1.5 h-1 rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className={`h-full ${conf.bar} transition-all`}
                                style={{
                                  width: `${Math.round(Math.max(0, Math.min(1, imp.confidence)) * 100)}%`,
                                }}
                              />
                            </div>
                            {/* writes summary */}
                            <p className="text-[10px] text-slate-500 mt-1.5">
                              <span className="text-slate-600">{t("preview.writes")}: </span>
                              {imp.impact.writes}
                            </p>
                            {/* indicator list — humanized: localized name
                                primary, code as small mono suffix so finance
                                users read at-a-glance without learning each
                                abbreviation. */}
                            {hasIndicators ? (
                              <div className="mt-1.5">
                                <p className="text-[10px] text-slate-600 mb-1">
                                  {t("preview.affectsIndicators", {
                                    n: imp.impact.indicators.length,
                                  })}
                                  :
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {imp.impact.indicators.map((ind) => (
                                    <span
                                      key={ind.code}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] text-slate-700"
                                      title={`${ind.code} · ${ind.category} · ${ind.matchedInput}`}
                                    >
                                      <span>{ind.nameRu ?? ind.nameEn}</span>
                                      <span className="font-mono text-[9px] text-slate-400">
                                        {ind.code}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : imp.impact.note ? (
                              <p className="text-[10px] text-slate-500 italic mt-1.5">
                                {imp.impact.note}
                              </p>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
                {impacts.length === 0 && f.classifications.length > 0 && (
                  <p className="text-xs text-slate-500">
                    {t("preview.sheetsClassified", { n: f.classifications.length })}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Apply result */}
      {applyResult && (
        <div ref={applyResultRef} className="space-y-3" data-testid="apply-result">
          <h3 className="font-semibold text-sm">
            {verdictEmoji(applyResult.overallVerdict)} {t("result.title")} ·{" "}
            {applyResult.durationMs}ms
          </h3>
          {applyResult.perGroup.map((g) => (
            <div
              key={g.fileType}
              className={`border rounded p-3 text-sm ${verdictColor(g.verdict)}`}
              data-testid={`apply-group-${g.fileType}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {verdictEmoji(g.verdict)} {g.fileType} ·{" "}
                  {t("result.fileCount", { n: g.filenames.length })}
                </span>
                <span className="text-xs">
                  {g.committed
                    ? t("result.rowsWritten", { n: g.totalRowsInserted })
                    : g.skipReason ?? t("result.skipped")}
                </span>
              </div>
            </div>
          ))}
          {applyResult.recompute.targets > 0 && (
            <p className="text-xs text-slate-600">
              {t("result.recomputeLine", {
                ok: applyResult.recompute.ok,
                total: applyResult.recompute.targets,
              })}
            </p>
          )}
          {applyResult.backlogClosed && applyResult.backlogClosed.length > 0 && (
            <div className="mt-3 p-3 rounded-md bg-emerald-50 border border-emerald-200">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">✅</span>
                <p className="text-sm font-semibold text-emerald-800">
                  {t("result.backlogClosed", { n: applyResult.backlogClosed.length })}
                </p>
              </div>
              <ul className="text-xs text-emerald-900/80 space-y-0.5 ml-5">
                {applyResult.backlogClosed.slice(0, 8).map((b) => (
                  <li key={`${b.companyCode}-${b.indicatorCode}`}>
                    <code className="font-mono text-[11px]">{b.companyCode}</code>{" "}
                    → {b.indicatorCode}
                  </li>
                ))}
                {applyResult.backlogClosed.length > 8 && (
                  <li className="italic text-emerald-700">
                    {t("result.andMore", {
                      n: applyResult.backlogClosed.length - 8,
                    })}
                  </li>
                )}
              </ul>
              <a
                href="/budgeting/admin/indicator-backlog"
                className="inline-block mt-2 text-xs text-emerald-700 underline-offset-2 hover:underline"
              >
                {t("result.openBacklog")}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Step 3 — shown after successful apply */}
      {applyResult && applyResult.overallVerdict !== "red" && (
        <div
          className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-5 space-y-3"
          data-testid="step3-done"
        >
          <div className="flex items-center gap-2">
            <span className="text-2xl">✅</span>
            <div>
              <p className="font-semibold text-emerald-800">{t("step3.title")}</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {t("step3.summary", {
                  rows: applyResult.perGroup
                    .filter((g) => g.committed)
                    .reduce((s, g) => s + g.totalRowsInserted, 0),
                  groups: applyResult.perGroup.filter((g) => g.committed).length,
                })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAll}
            className="px-4 py-2 bg-emerald-600 text-white rounded font-medium hover:bg-emerald-700 text-sm"
            data-testid="btn-reset"
          >
            {t("step3.resetButton")}
          </button>
        </div>
      )}
    </div>
  )
}
