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
import { chooseReconciliationBlockedMessage } from "@/lib/onboarding/ai-import/reconciliation-blocked-message"
import { doctorNextStep } from "@/lib/onboarding/ai-import/doctor-next-step"
import { useLocale, useTranslations } from "next-intl"
import { localizedName } from "@/lib/i18n/localized-name"
import {
  groupImportWarnings,
  countRealWarnings,
  ACTIONABLE_GROUPS,
  QUIET_GROUPS,
  type I18nLine,
  type WarningBriefing,
} from "@/lib/onboarding/ai-import/warning-groups"
import { buildWarningSheetFacts } from "./warning-facts"
import {
  asImportTranslator,
  isAiOutageCode,
  localizeAiOutage,
  localizeImportMessage,
  localizeVerdict,
} from "./import-message-i18n"
import {
  ImportFlowStrip,
  ImportRunningBanner,
  ImportDoneRedirect,
  ImportReviewTabs,
  PNL_HREF,
  type FlowStepKey,
  type ReviewTabDef,
  type ReviewTabKey,
} from "./ImportFlowGuide"

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
  /** Phase 11.5b — years the workbook's own headers declare. */
  importableYears?: { years: number[]; counts: Record<number, number> }
  detectedYears?: {
    years: number[]
    dominant: number | null
    multiYear: boolean
  }
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

interface SafetyReceipt {
  mode: "preview" | "applied"
  status:
    | "blocked"
    | "preview_ready"
    | "applied_complete"
    | "applied_recompute_pending"
    | "applied_recompute_failed"
    | "applied_no_writes"
  year: number
  rows: {
    toWrite: number
    committed: number
    toArchive: number | null
    archiveScopeCount: number
  }
  affectedCompanies: string[]
  affectedPlans: string[]
  sectionsDetected: Array<{ dataType: string; sheets: number }>
  skippedSheets: Array<{
    filename: string
    sheetName: string
    dataType: string
    reason: string
  }>
  archiveScopes: Array<{
    companyCode: string
    dataType: string
    planKind: "actual" | "budget" | "unknown"
  }>
  reconciliation: {
    verdict: "green" | "yellow" | "red"
    conflicts: number
    /**
     * 2026-08-03 — the server has sent this since Phase 11.2 and this type
     * never declared it, so the only surface that could have shown WHY a
     * verdict is red could not see the reason. Optional because a receipt from
     * an older deployment carries none.
     */
    evidence?: {
      sheetsVerified: number
      sheetsUnverified: number
      unverifiedSheetNames?: string[]
      allCommittedGroupsVerified: boolean
    }
    groups: Array<{
      fileType: string
      verdict: string
      committed: boolean
      rows: number
      skipReason: string | null
    }>
  }
  recompute: {
    status: "not_run" | "ok" | "pending" | "failed"
    predictedTargets: number
    targets: number
    ok: number
    unknown: number
    failed: number
  }
  links: {
    riskTerminal: string
    indicatorHealth: string
    rollback: string
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
  /** Phase 11.3 — did every uploaded file's data actually land? Separate
   *  from `overallVerdict`, which only says whether what landed is correct. */
  completeness?: {
    complete: boolean
    filesWithErrors: string[]
    unclassifiedFiles: string[]
    groupsNotCommitted: Array<{
      fileType: string
      filenames: string[]
      reason: string
    }>
    /** Set when the classifier failed because the AI service was unreachable. */
    aiOutage?: "ai_credits" | "ai_rate_limit" | "ai_unavailable" | "ai_bad_response" | null
  }
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
  safetyReceipt?: SafetyReceipt
  buColumnSplits?: Array<{
    filename: string
    sheetName: string
    mapping: Array<{
      sheetName: string
      entityCode: string | null
      buValue: string
      rowCount: number
      action: "write" | "skip"
      reason?: "elimination" | "unknown_alias" | "adjustment"
      foldedInto?: { entityCode: string; viaHeader: string }
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

interface DoctorIssue {
  code: string
  severity: "info" | "warning" | "blocking"
  message: string
  location?: Record<string, unknown>
  evidence?: Record<string, unknown>
}

interface DoctorExplanation {
  title: string
  plainExplanation: string
  whyBlocked: string
  whatToCheck: string[]
  safeNextStep: string
  needsReimport: boolean
}

type DoctorFixProposal =
  | {
      kind: "sheet_fix"
      executable: true
      title: string
      rationale: string
      confidence: number
      risk: "low" | "medium"
      patch: SheetFix
      requiresPreviewRerun: true
    }
  | {
      kind: "coa_mapping"
      executable: true
      title: string
      rationale: string
      confidence: number
      risk: "low" | "medium"
      patch: CoaDecision
      requiresPreviewRerun: true
    }
  | {
      kind: "conflict_resolution"
      executable: true
      title: string
      rationale: string
      confidence: number
      risk: "low" | "medium"
      patch: {
        key: string
        resolution: { mode: "pick"; filename: string } | { mode: "skip" }
      }
      requiresPreviewRerun: false
    }
  | {
      kind: "manual_review"
      executable: false
      title: string
      rationale: string
      confidence: number
      risk: "high"
      manualSteps: string[]
      requiresPreviewRerun: false
    }

interface DoctorExplainResponse {
  ok: boolean
  explanation?: DoctorExplanation
  error?: string
  code?: string
}

interface DoctorFixResponse {
  ok: boolean
  proposal?: DoctorFixProposal
  error?: string
  code?: string
}

const MAX_FILES = 10
// Phase 11 follow-up (2026-07-29) — MUST match the server's cap in
// src/app/api/import/ai-auto-multi/route.ts. It was 20 MB against the
// server's 40 MB, so the browser rejected uploads the server would have
// accepted — including the client's own 26.6 MB `Reporting 2026.xlsx`, with a
// client-side message that made it look like a hard product limit.
const MAX_TOTAL_BYTES = 40 * 1024 * 1024
// 11.58 — mirror the server's per-count cap (`totalCapFor` in the route). A
// single file gets the full 64 MB every other import route allows; the 40 MB
// aggregate applies only from two files up, where ten near-cap files would
// otherwise reach ~640 MB. Without this the browser refused a 41-63 MB
// workbook that the classify-only tab had just accepted.
const MAX_SINGLE_FILE_BYTES = 64 * 1024 * 1024
const totalCapFor = (fileCount: number): number =>
  fileCount <= 1 ? MAX_SINGLE_FILE_BYTES : MAX_TOTAL_BYTES

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function formatInt(n: number): string {
  return new Intl.NumberFormat().format(n)
}

function verdictColor(v: string): string {
  if (v === "green") return "text-emerald-700 bg-emerald-50 border-emerald-200"
  if (v === "yellow") return "text-amber-700 bg-amber-50 border-amber-200"
  if (v === "red") return "text-red-700 bg-red-50 border-red-200"
  return "text-slate-500 bg-slate-50 border-slate-200"
}

function receiptStatusClass(status: SafetyReceipt["status"]): string {
  if (status === "blocked" || status === "applied_recompute_failed") {
    return "border-red-200 bg-red-50 text-red-900"
  }
  if (status === "applied_recompute_pending" || status === "applied_no_writes") {
    return "border-amber-200 bg-amber-50 text-amber-900"
  }
  if (status === "applied_complete") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900"
  }
  return "border-blue-200 bg-blue-50 text-blue-900"
}

function recomputeStatusClass(status: SafetyReceipt["recompute"]["status"]): string {
  if (status === "failed") return "bg-red-100 text-red-800"
  if (status === "pending") return "bg-amber-100 text-amber-800"
  if (status === "ok") return "bg-emerald-100 text-emerald-800"
  return "bg-slate-100 text-slate-600"
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

/**
 * Selectable import years. Spans a few years back so a prior-year re-import
 * stays possible after 1 January — the exact case that used to be impossible
 * when the year came from the browser clock (Phase 11.5).
 */
const YEAR_OPTIONS: number[] = (() => {
  const now = new Date().getFullYear()
  const out: number[] = []
  for (let y = now + 1; y >= now - 4; y--) out.push(y)
  return out
})()

export function MultiFileForm({ initialYear }: { initialYear?: number } = {}) {
  const t = useTranslations("adminAiImport.multi")
  // 11.58 — the flow namespace also carries the honest label for the
  // pre-write reconciliation (see `receipt-preview-self-check` below).
  const tFlow = useTranslations("adminAiImport.multi.flow")
  // 11.7x — everything the SERVER wrote (warnings, skip reasons, CoA reasons,
  // file-type reasoning, API errors, verdict enums) is rendered through this
  // namespace. It was the single largest block of English left on the screen.
  const tShared = asImportTranslator(useTranslations("adminAiImport.shared"))
  const locale = useLocale()
  /**
   * Phase 11.5 (2026-07-29) — the target year is an EXPLICIT, user-visible
   * choice.
   *
   * This component used to render with no props (its three sibling tabs each
   * received one), so `?year=` never reached the only tab that writes, and
   * the year went to the server as `new Date().getFullYear()` — the
   * BROWSER's calendar year. The reset panel carries its own independent
   * year, so the two could disagree silently. Any sheet for a different year
   * is then dropped by the adapters' year guards at zero rows, and the group
   * commits "green" with nothing written. After 1 January that made
   * re-importing the prior year through this tab structurally impossible,
   * with the data already erased.
   */
  const [year, setYear] = useState<number>(
    initialYear ?? new Date().getFullYear(),
  )
  const [files, setFiles] = useState<File[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  // 11.54 — WHICH step is running, not merely that something is.
  // `isProcessing` alone could not drive a banner: the old one keyed off
  // `isProcessing && previewResult`, and submitting Step 1 nulls
  // `previewResult` first, so the 30-90s of AI classification rendered
  // nothing and read as a hang (11.42a, caught in a live rehearsal).
  const [runningPhase, setRunningPhase] = useState<"analyze" | "apply" | null>(
    null,
  )
  // 11.68 — the years this run is actually writing, CAPTURED at submit rather
  // than derived from current state. The banner must report what went on the
  // wire, not what the form says now.
  const [runningYears, setRunningYears] = useState<number[]>([])
  // 11.65 — every review section is a tab, including the ones that explain or
  // fix a blocked apply. `null` means "nothing chosen yet", which is what lets
  // the auto-selection below open the urgent tab after a run without ever
  // overriding a deliberate click.
  const [reviewTab, setReviewTab] = useState<ReviewTabKey | null>(null)
  const [previewResult, setPreviewResult] =
    useState<MultiFileApiResponse | null>(null)
  const [applyResult, setApplyResult] =
    useState<MultiFileApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forceOverride, setForceOverride] = useState(false)
  // 2026-07-30 — import every year the workbooks contain, not just the picked
  // one. Off by default: widening the write scope is never implicit.
  const [importAllYears, setImportAllYears] = useState(false)
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
  const [doctorExplanation, setDoctorExplanation] =
    useState<DoctorExplanation | null>(null)
  const [doctorFix, setDoctorFix] = useState<DoctorFixProposal | null>(null)
  const [doctorLoading, setDoctorLoading] = useState<"explain" | "fix" | null>(
    null,
  )
  const [doctorError, setDoctorError] = useState<string | null>(null)
  /**
   * The panel used to print the machine code verbatim — «Import Doctor
   * işləmədi: ai_unavailable» — which is both meaningless to a finance
   * operator and, in the case measured on production, wrong: the model had
   * answered and our own parser rejected the shape. Someone reading that goes
   * to check the API key and the billing page for a defect in our prompt.
   */
  const doctorErrorText = (code: string | null | undefined, fallback: string) => {
    switch (code) {
      case "ai_bad_response":
        return t("doctor.errorBadResponse")
      case "ai_credits":
      case "ai_unavailable":
        return t("doctor.errorUnavailable")
      case "ai_rate_limit":
        return t("doctor.errorBusy")
      default:
        return t("doctor.error", { msg: fallback })
    }
  }
  const [doctorStatus, setDoctorStatus] = useState<string | null>(null)
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
  const doctorPanelRef = useRef<HTMLDivElement>(null)

  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  const sizeCap = totalCapFor(files.length)
  const overSizeCap = totalBytes > sizeCap
  const overCountCap = files.length > MAX_FILES
  const hasConflicts = (previewResult?.conflicts.length ?? 0) > 0
  const yearMismatch = detectedYearMismatch(previewResult)
  // 2026-07-30 — every year the uploaded workbooks actually contain, from the
  // detection that already feeds the year gate. Empty until the preview runs.
  // 2026-07-30 — the OFFER uses `importableYears`, not `detectedYears`.
  // The loose scan counts any year-looking number, and on a real workbook that
  // is money: an amount of 40,000-55,000 AZN lands inside the Excel
  // date-serial range, so actual-budget-v1.xlsx offered FOURTEEN years
  // (2015…2035) instead of the two it holds. `importableYears` requires a real
  // month-header sequence.
  const detectedYearsAll = [
    ...new Set(
      (previewResult?.perFile ?? []).flatMap((f) => f.importableYears?.years ?? []),
    ),
  ].sort()
  const extraYears = detectedYearsAll.filter((y) => y !== year)
  // 11.54 — which of the four plain-language steps the operator is standing on.
  // Derived, never stored: any other source of truth would drift from the
  // buttons that actually gate the flow.
  const currentFlowStep: FlowStepKey =
    runningPhase === "apply" || applyResult
      ? "write"
      : runningPhase === "analyze"
        ? "analyze"
        : previewResult
          ? "verify"
          : files.length > 0
            ? "analyze"
            : "file"
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

  // ── 11.65: the review tab model ──────────────────────────────────
  // Every review section is a tab now, blockers included. That is only safe
  // because of the two rules below; drop either and this becomes strictly
  // worse than the endless scroll it replaced.
  //
  //  1. A section with no content gets no tab, so the strip never offers an
  //     empty panel and a count is never a lie.
  //  2. `blocking` marks the sections that explain or fix something the Apply
  //     button refuses on. They are styled red AND one of them is opened
  //     AUTOMATICALLY (see `effectiveReviewTab`) — a blocker behind an
  //     unchosen tab would leave a disabled button with no visible reason.
  //
  // Panels stay MOUNTED and are hidden with CSS, never unmounted: the
  // conflict banner holds the only `forceOverride` checkbox, the Import
  // Doctor scrolls to refs inside these sections, and the suite queries
  // testids in them.
  // 11.82 — the badge counts WARNINGS, not lines. A sheet the pipeline chose
  // not to read (INFO_SUMMARY, or a sheet routed derived_summary) is a
  // statement of intent with no reader and no remedy; counting it reinflates
  // exactly the number 11.69 set out to make meaningful.
  const warningCount = countRealWarnings(
    groupImportWarnings(
      previewResult?.warnings ?? [],
      buildWarningSheetFacts(previewResult),
    ),
  )
  const reviewTabDefs: ReviewTabDef[] = previewResult
    ? ([
        previewResult.perFile.length > 0
          ? {
              key: "analysis",
              count: previewResult.perFile.reduce((n, f) => n + f.classifications.length, 0),
            }
          : null,
        guidedFixItems.length > 0
          ? { key: "fixes", count: guidedFixItems.length, blocking: hasStaleSheetFixes }
          : null,
        coaReviewItems.length > 0
          ? { key: "coa", count: coaReviewItems.length, blocking: hasUnresolvedCoaReviews }
          : null,
        hasConflicts
          ? { key: "conflicts", count: previewResult.conflicts.length, blocking: !allConflictsResolved }
          : null,
        buRoutingSplits.length > 0 ? { key: "routing", count: buRoutingSplits.length } : null,
        previewResult.safetyReceipt ? { key: "receipt" } : null,
        warningCount > 0 ? { key: "warnings", count: warningCount } : null,
      ].filter(Boolean) as ReviewTabDef[])
    : []

  // A deliberate click always wins. Otherwise open the first BLOCKING tab —
  // "why can't I apply" beats "what did it read" whenever both are on offer.
  // With nothing blocking, land on the analysis: after a run the operator's
  // first question is whether the AI understood the file, not what the
  // warnings say.
  const effectiveReviewTab: ReviewTabKey | null =
    (reviewTab && reviewTabDefs.some((d) => d.key === reviewTab) ? reviewTab : null) ??
    reviewTabDefs.find((d) => d.blocking)?.key ??
    reviewTabDefs.find((d) => d.key === "analysis")?.key ??
    reviewTabDefs[0]?.key ??
    null
  /** True when this section should be on screen. */
  const showTab = (key: ReviewTabKey) => effectiveReviewTab === key
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

  const primaryDoctorIssue = buildPrimaryDoctorIssue()

  function resetDoctorState(): void {
    setDoctorExplanation(null)
    setDoctorFix(null)
    setDoctorError(null)
    setDoctorStatus(null)
    setDoctorLoading(null)
  }

  function buildPrimaryDoctorIssue(): DoctorIssue | null {
    if (error) {
      return {
        code: "import_failed",
        severity: "blocking",
        // 11.7x — the other five doctor issues are built from the catalogue;
        // this one carried the raw server sentence straight into the panel.
        message: localizeImportMessage(tShared, error),
      }
    }
    if (!previewResult) return null
    if (hasConflicts) {
      return {
        code: "cross_file_conflict",
        severity: "blocking",
        message: t("doctor.issue.crossFileConflict", {
          n: previewResult.conflicts.length,
        }),
        evidence: { conflicts: previewResult.conflicts.slice(0, 5) },
      }
    }
    if (hasUnresolvedCoaReviews) {
      return {
        code: "coa_review_required",
        severity: "blocking",
        message: t("doctor.issue.coaReviewRequired", {
          n: coaReviewItems.length,
        }),
        evidence: { reviewItems: coaReviewItems.slice(0, 8) },
      }
    }
    if (hasStaleSheetFixes) {
      return {
        code: "preview_stale",
        severity: "warning",
        message: t("doctor.issue.previewStale"),
        evidence: { sheetFixes: sheetFixList },
      }
    }
    if (
      previewResult.safetyReceipt?.status === "blocked" ||
      previewResult.overallVerdict === "red"
    ) {
      // 2026-08-03 — every other issue here names a number; this one stated a
      // colour. The evidence is already in the receipt and the route's own
      // comment says what it means: "a verdict with `sheetsVerified: 0` is NOT
      // proof of anything". Rendering that as a flat "reconciliation is red"
      // told an operator their data was wrong when what actually happened was
      // that the check never ran.
      const choice = chooseReconciliationBlockedMessage(
        previewResult.safetyReceipt?.reconciliation?.evidence,
      )
      return {
        code: "reconciliation_blocked",
        severity: "blocking",
        message: t(`doctor.issue.${choice.key}`, choice.params),
        evidence: { safetyReceipt: previewResult.safetyReceipt },
      }
    }
    if (guidedFixItems.length > 0) {
      return {
        code: "routing_uncertain",
        severity: "warning",
        message: t("doctor.issue.routingUncertain", {
          n: guidedFixItems.length,
        }),
        evidence: { guidedFixItems: guidedFixItems.slice(0, 10) },
      }
    }
    return null
  }

  function doctorIssueLabel(code: string): string {
    switch (code) {
      case "import_failed":
        return t("doctor.labels.importFailed")
      case "cross_file_conflict":
        return t("doctor.labels.crossFileConflict")
      case "coa_review_required":
        return t("doctor.labels.coaReviewRequired")
      case "routing_uncertain":
        return t("doctor.labels.routingUncertain")
      case "reconciliation_blocked":
        return t("doctor.labels.reconciliationBlocked")
      case "preview_stale":
        return t("doctor.labels.previewStale")
      default:
        return t("doctor.labels.manualReview")
    }
  }

  function doctorRiskLabel(risk: DoctorFixProposal["risk"]): string {
    switch (risk) {
      case "low":
        return t("doctor.riskLow")
      case "medium":
        return t("doctor.riskMedium")
      case "high":
        return t("doctor.riskHigh")
    }
  }

  function buildDoctorContext(): Record<string, unknown> {
    return {
      error,
      mode: previewResult?.mode ?? null,
      overallVerdict: previewResult?.overallVerdict ?? null,
      warnings: (previewResult?.warnings ?? []).slice(0, 10),
      safetyReceipt: previewResult?.safetyReceipt
        ? {
            status: previewResult.safetyReceipt.status,
            rows: previewResult.safetyReceipt.rows,
            affectedCompanies: previewResult.safetyReceipt.affectedCompanies,
            affectedPlans: previewResult.safetyReceipt.affectedPlans,
            sectionsDetected: previewResult.safetyReceipt.sectionsDetected,
            reconciliation: previewResult.safetyReceipt.reconciliation,
            recompute: previewResult.safetyReceipt.recompute,
          }
        : null,
      conflicts: (previewResult?.conflicts ?? []).slice(0, 8),
      coaReviewItems: coaReviewItems.slice(0, 12),
      guidedFixItems: guidedFixItems.slice(0, 16).map((item) => ({
        filename: item.filename,
        classification: item.classification,
      })),
      selectedCoaDecisions: Object.values(coaDecisions),
      sheetFixes: sheetFixList,
      buColumnSplits: buRoutingSplits.slice(0, 8),
      perFile:
        previewResult?.perFile.map((file) => ({
          filename: file.filename,
          fileType: file.fileTypeResult.fileType,
          fileTypeConfidence: file.fileTypeResult.confidence,
          fileTypeReasoning: file.fileTypeResult.reasoning,
          classifications: file.classifications.slice(0, 40),
          semanticCoaReviewItems: file.semanticCoa?.reviewItems?.slice(0, 12),
          error: file.error,
        })) ?? [],
    }
  }

  async function requestDoctorExplanation(): Promise<void> {
    if (!primaryDoctorIssue) return
    setDoctorLoading("explain")
    setDoctorError(null)
    setDoctorStatus(null)
    try {
      const res = await fetch("/api/import/ai-auto-multi/doctor/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          issue: primaryDoctorIssue,
          context: buildDoctorContext(),
        }),
      })
      const data = (await res.json()) as DoctorExplainResponse
      if (!res.ok || !data.ok || !data.explanation) {
        throw Object.assign(
          new Error(data.error ?? data.code ?? `HTTP ${res.status}`),
          { aiCode: data.code ?? data.error },
        )
      }
      setDoctorExplanation(data.explanation)
      setTimeout(
        () => doctorPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
        50,
      )
    } catch (err) {
      setDoctorError(
        doctorErrorText(
          (err as { aiCode?: string })?.aiCode,
          err instanceof Error ? err.message : String(err),
        ),
      )
    } finally {
      setDoctorLoading(null)
    }
  }

  async function requestDoctorFix(): Promise<void> {
    if (!primaryDoctorIssue) return
    setDoctorLoading("fix")
    setDoctorError(null)
    setDoctorStatus(null)
    try {
      const res = await fetch("/api/import/ai-auto-multi/doctor/suggest-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          issue: primaryDoctorIssue,
          context: buildDoctorContext(),
        }),
      })
      const data = (await res.json()) as DoctorFixResponse
      if (!res.ok || !data.ok || !data.proposal) {
        throw Object.assign(
          new Error(data.error ?? data.code ?? `HTTP ${res.status}`),
          { aiCode: data.code ?? data.error },
        )
      }
      setDoctorFix(data.proposal)
      setTimeout(
        () => doctorPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
        50,
      )
    } catch (err) {
      setDoctorError(
        doctorErrorText(
          (err as { aiCode?: string })?.aiCode,
          err instanceof Error ? err.message : String(err),
        ),
      )
    } finally {
      setDoctorLoading(null)
    }
  }

  function applyDoctorFix(): void {
    if (!doctorFix?.executable) return
    if (doctorFix.kind === "sheet_fix") {
      updateSheetFix(doctorFix.patch.filename, doctorFix.patch.sheetName, {
        entityCode: doctorFix.patch.entityCode,
        planKind: doctorFix.patch.planKind,
        role: doctorFix.patch.role,
      })
    } else if (doctorFix.kind === "coa_mapping") {
      const key = coaDecisionKey(
        doctorFix.patch.filename,
        doctorFix.patch.sheetName,
        doctorFix.patch.sourceLabel,
      )
      setCoaDecisions((prev) => ({ ...prev, [key]: doctorFix.patch }))
      setApplyResult(null)
    } else if (doctorFix.kind === "conflict_resolution") {
      setResolutions((prev) => ({
        ...prev,
        [doctorFix.patch.key]: doctorFix.patch.resolution,
      }))
      setApplyResult(null)
    }
    setDoctorStatus(
      doctorFix.requiresPreviewRerun
        ? t("doctor.statusPreviewNeeded")
        : t("doctor.statusApplied"),
    )
  }

  function scrollToDoctorProblem(): void {
    // 11.65 — OPEN the tab first. Every section the doctor points at now lives
    // behind a tab, and `scrollIntoView` on a hidden element does nothing at
    // all: the button would appear to do nothing, which is exactly the
    // dead-end this whole screen keeps being fixed for.
    // 2026-08-03 — the map moved to `doctorNextStep`, so the button and the
    // sentence above it can never point at different places, and both are
    // testable without mounting the form.
    const code = primaryDoctorIssue?.code
    const tab = (code ? doctorNextStep(code).tab : null) as ReviewTabKey | null
    if (tab && reviewTabDefs.some((d) => d.key === tab)) setReviewTab(tab)
    // The error banner sits OUTSIDE the tabs, so it stays a valid target;
    // the conflict banner is only reachable once its tab is open, which the
    // state update above has queued. Scroll on the next frame so the layout
    // reflects it.
    requestAnimationFrame(() => {
      const target =
        errorRef.current ?? conflictBannerRef.current ?? doctorPanelRef.current
      target?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }

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
    resetDoctorState()
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
    resetDoctorState()
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
    resetDoctorState()
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
      resetDoctorState()
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

  /**
   * Phase 11.5b — adopt the year the workbook actually declares.
   *
   * The user picks a year before seeing the file. When the preview comes back
   * saying every uploaded workbook is about a different year, silently
   * importing the picked one means every adapter's year guard drops every
   * sheet and the group commits "green" with nothing written. The server now
   * refuses that outright; this makes the client stop offering it.
   */
  function detectedYearMismatch(res: MultiFileApiResponse | null): number | null {
    if (!res) return null
    // Same strict signal as the multi-year offer: "is this file about my
    // year" must not be answered by numbers that merely look like years.
    const withYears = res.perFile.filter(
      (f) => (f.importableYears?.years.length ?? 0) > 0,
    )
    if (withYears.length === 0) return null
    if (withYears.some((f) => f.importableYears!.years.includes(year))) return null
    const all = [
      ...new Set(withYears.flatMap((f) => f.importableYears!.years)),
    ].sort()
    return all[0] ?? null
  }

  async function submit(apply: boolean): Promise<void> {
    if (files.length === 0) return
    setIsProcessing(true)
    setRunningPhase(apply ? "apply" : "analyze")
    setRunningYears(
      importAllYears && detectedYearsAll.length > 1 ? detectedYearsAll : [year],
    )
    setError(null)
    setDoctorError(null)
    setDoctorStatus(null)
    if (apply) {
      setApplyResult(null)
    } else {
      setPreviewResult(null)
      setDoctorExplanation(null)
      setDoctorFix(null)
    }
    try {
      const form = new FormData()
      for (const f of files) form.append("files", f)
      form.append("year", String(year))
      // 2026-07-30 — multi-year target. Sent only when the operator ticked the
      // box, so a normal run is byte-identical to what it always sent.
      if (importAllYears && detectedYearsAll.length > 1) {
        form.append("years", detectedYearsAll.join(","))
      }
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
      setRunningPhase(null)
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

  function receiptStatusLabel(status: SafetyReceipt["status"]): string {
    switch (status) {
      case "blocked":
        return t("receipt.status.blocked")
      case "preview_ready":
        return t("receipt.status.previewReady")
      case "applied_complete":
        return t("receipt.status.appliedComplete")
      case "applied_recompute_pending":
        return t("receipt.status.recomputePending")
      case "applied_recompute_failed":
        return t("receipt.status.recomputeFailed")
      case "applied_no_writes":
        return t("receipt.status.noWrites")
    }
  }

  function recomputeStatusLabel(
    status: SafetyReceipt["recompute"]["status"],
  ): string {
    switch (status) {
      case "ok":
        return t("receipt.recomputeOk")
      case "pending":
        return t("receipt.recomputePending")
      case "failed":
        return t("receipt.recomputeFailed")
      case "not_run":
        return t("receipt.recomputeNotRun")
    }
  }

  function compactList(values: string[], max = 6): string {
    if (values.length === 0) return t("receipt.none")
    const shown = values.slice(0, max).join(", ")
    return values.length > max
      ? `${shown} +${values.length - max}`
      : shown
  }

  /** Render an i18n descriptor produced by warning-groups.ts. */
  function line(l: I18nLine): string {
    return t(`warnings.${l.key}` as never, l.params as never)
  }

  /**
   * 11.82 — the three questions an unread sheet has to answer.
   *
   * «как теперь финансисту решить, или отдельно добавить, или понять почему
   * не смогло прочесть?» — the previous version answered none of them: it
   * showed the server's own sentence and stopped. Each card now states what
   * is in the sheet, what stays empty because it did not land, and the next
   * action — and the original line is still there underneath, because a
   * finance user forwarding this to an engineer needs the literal text.
   */
  function renderBriefing(b: WarningBriefing, i: number) {
    return (
      <li
        key={i}
        className="rounded border border-amber-300 bg-white/70 p-2 dark:bg-amber-950/20"
        data-testid={`warning-brief-${b.sheetName ?? `line-${i}`}`}
      >
        {b.sheetName && (
          <div className="font-semibold text-[12px] break-words">{b.sheetName}</div>
        )}
        <dl className="mt-1 space-y-1 text-[11px]">
          {b.contains.length > 0 && (
            <div>
              <dt className="inline font-medium opacity-70">
                {t("warnings.brief.what")}{" "}
              </dt>
              <dd className="inline break-words">
                {b.contains.map(line).join(" ")}
              </dd>
            </div>
          )}
          {b.stakes && (
            <div data-testid="warning-brief-stakes">
              <dt className="inline font-medium opacity-70">
                {t("warnings.brief.lost")}{" "}
              </dt>
              <dd className="inline break-words">{line(b.stakes)}</dd>
            </div>
          )}
          {b.actions.length > 0 && (
            <div data-testid="warning-brief-actions">
              <dt className="inline font-medium opacity-70">
                {t("warnings.brief.todo")}{" "}
              </dt>
              <dd className="inline break-words">
                {b.actions.map(line).join(" ")}
              </dd>
            </div>
          )}
        </dl>
        {/* The server's own sentence, kept verbatim and one click away. It is
            what an engineer needs and what a screenshot has to contain. */}
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] opacity-60">
            {t("warnings.brief.raw")}
          </summary>
          <p className="mt-1 break-words text-[10px] opacity-80">
            {localizeImportMessage(tShared, b.message)}
          </p>
        </details>
      </li>
    )
  }

  /**
   * Phase 11.3 (2026-07-29) — render `warnings`.
   *
   * The orchestrator has always emitted the reason a sheet was dropped, a
   * year was mismatched or a group was skipped, and this screen never showed
   * any of it: `warnings` was referenced exactly once, inside
   * buildDoctorContext, so the text only existed in the Import Doctor
   * payload. The user saw a verdict badge and nothing else.
   *
   * 11.82 — takes the whole response, not just the strings: the briefings
   * need each sheet's dimensions, classification and indicator projection,
   * which live elsewhere in the same payload (see `warning-facts.ts`).
   */
  function renderWarnings(
    res: MultiFileApiResponse | null,
    testId = "apply-warnings",
  ) {
    const warnings = res?.warnings
    if (!warnings || warnings.length === 0) return null
    const groups = groupImportWarnings(warnings, buildWarningSheetFacts(res))
    const loud = groups.filter((g) => !QUIET_GROUPS.has(g.key))
    const quiet = groups.filter((g) => QUIET_GROUPS.has(g.key))
    const loudCount = countRealWarnings(groups)

    return (
      <div className="space-y-2">
        {loudCount > 0 && (
          <details
            className="border rounded p-3 text-sm bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-800"
            data-testid={testId}
            open={loudCount <= 5}
          >
            <summary className="font-medium cursor-pointer">
              ⚠️ {t("result.warningsTitle", { n: loudCount })}
            </summary>
            {/* 11.69 — grouped by MEANING, not dumped in arrival order.
                The live run put six identical "this sheet is about another
                year" lines next to a real structural failure, in English, on
                an Azerbaijani page: «тут ничего не поймёшь, всё так записано».
                What must be acted on comes first; every original line is
                still here verbatim, one click away. */}
            <div className="mt-2 space-y-2">
              {loud.map((g) => {
                const actionable = ACTIONABLE_GROUPS.has(g.key)
                return (
                  <details
                    key={g.key}
                    data-testid={`warning-group-${g.key}`}
                    data-actionable={actionable ? "true" : undefined}
                    open={actionable}
                    className={`rounded border px-2 py-1.5 ${
                      actionable
                        ? "border-amber-400 bg-amber-100/60"
                        : "border-amber-200 bg-white/50"
                    }`}
                  >
                    <summary className="cursor-pointer text-xs">
                      <span
                        className={actionable ? "font-semibold" : "font-medium"}
                      >
                        {t(
                          `warnings.group.${g.key}` as never,
                          { n: g.messages.length } as never,
                        )}
                      </span>
                      {/* The remedy, stated where the problem is — these
                          sheets load if the multi-year box is ticked. */}
                      {g.key === "off-year" && g.years.length > 0 && (
                        <span className="ml-1 opacity-80">
                          {t(
                            "warnings.offYearHint" as never,
                            { years: g.years.join(", ") } as never,
                          )}
                        </span>
                      )}
                    </summary>
                    {/* An actionable group gets the three-question briefing;
                        an informational one stays a plain localized list —
                        off-year and dictionary notes already read as
                        sentences and have their own group hint. */}
                    {actionable ? (
                      <ul className="mt-1.5 space-y-2">
                        {g.briefings.map(renderBriefing)}
                      </ul>
                    ) : (
                      <ul className="mt-1.5 space-y-1 list-disc list-inside text-[11px]">
                        {g.messages.map((w, i) => (
                          <li key={i} className="break-words">
                            {localizeImportMessage(tShared, w)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                )
              })}
            </div>
          </details>
        )}

        {/* 11.82 — deliberately not read. Grey, outside the amber block, and
            not in the count: a sheet the pipeline decided to skip is a
            statement of intent, and dressing it as a warning is what made
            the owner ask why three unrelated events shared one heading. */}
        {quiet.map((g) => (
          <details
            key={g.key}
            data-testid={`warning-group-${g.key}`}
            className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900/40"
          >
            <summary className="cursor-pointer text-xs text-slate-600 dark:text-slate-300">
              {t("warnings.group.by-design" as never, { n: g.messages.length } as never)}
            </summary>
            <ul className="mt-1.5 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
              {g.briefings.map((b, i) => (
                <li key={i} className="break-words">
                  <span className="font-medium">{b.sheetName ?? ""}</span>
                  {b.sheetName ? " — " : ""}
                  {b.byDesignReason ? line(b.byDesignReason) : ""}
                  {/* Dimensions only. `contains` also carries "Read as
                      INFO_SUMMARY, 74% confidence", which the reason line
                      above has already said in words. */}
                  {b.contains[0] && ` ${line(b.contains[0])}`}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    )
  }

  /**
   * Phase 11.3 — say plainly when part of the upload never reached the
   * database. This is the case that used to exit as `ok: true` /
   * `applied_complete`, which right after a reset reads as "imported fine"
   * while the numbers are missing.
   */
  function renderIncompleteness(res: MultiFileApiResponse) {
    const c = res.completeness
    if (!c || c.complete) return null
    const lines: string[] = [
      ...c.filesWithErrors.map((f) => t("result.incompleteFileError", { f })),
      ...c.unclassifiedFiles.map((f) =>
        t("result.incompleteUnclassified", { f }),
      ),
      // 11.7x — the ICU wrapper was translated but `reason` was the raw
      // English skipReason from the orchestrator, so the red banner read half
      // Azerbaijani, half English.
      ...c.groupsNotCommitted.map((g) =>
        t("result.incompleteGroup", {
          g: g.fileType,
          reason: localizeImportMessage(tShared, g.reason),
        }),
      ),
    ]
    return (
      <div
        className="border rounded p-3 text-sm bg-red-50 border-red-400 dark:bg-red-950/30 dark:border-red-800"
        data-testid="apply-incomplete"
      >
        <div className="font-semibold">🔴 {t("result.incompleteTitle")}</div>
        {/* 2026-08-18 — name the real cause first when the AI service was the
            thing that failed. Every line below this says "file type unknown /
            manual review required", which reads as a defect in the workbook.
            On production the Anthropic balance ran out and that wording sent
            the owner hunting through a spreadsheet that was perfectly fine. */}
        {c.aiOutage && (
          <p
            className="mt-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-2 font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            data-testid="apply-incomplete-ai-outage"
          >
            {localizeAiOutage(tShared, c.aiOutage, "classify")}
          </p>
        )}
        <ul className="mt-2 space-y-1 list-disc list-inside">
          {lines.map((l, i) => (
            <li key={i} className="break-words">
              {l}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  function renderSafetyReceipt(
    receipt: SafetyReceipt,
    placement: "preview" | "applied",
  ) {
    const archiveRows =
      receipt.rows.toArchive === null
        ? t("receipt.archiveCalculated")
        : formatInt(receipt.rows.toArchive)
    const recomputeTargets =
      receipt.recompute.targets > 0
        ? receipt.recompute.targets
        : receipt.recompute.predictedTargets
    return (
      <div
        className={`rounded-lg border p-4 text-sm ${receiptStatusClass(receipt.status)}`}
        data-testid={`safety-receipt-${placement}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-950">
              {t("receipt.title")}
            </h3>
            <p className="mt-1 text-xs text-current opacity-75">
              {placement === "preview"
                ? t("receipt.previewSubtitle")
                : t("receipt.appliedSubtitle")}
            </p>
          </div>
          <span
            className="rounded border border-current/15 bg-white/70 px-2.5 py-1 text-xs font-semibold"
            data-testid={`safety-receipt-status-${placement}`}
          >
            {receiptStatusLabel(receipt.status)}
          </span>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <div className="rounded border border-current/10 bg-white/65 p-2.5">
            <div className="text-[10px] uppercase tracking-wide opacity-60">
              {placement === "preview"
                ? t("receipt.rowsToWrite")
                : t("receipt.rowsCommitted")}
            </div>
            <div className="mt-1 font-mono text-base font-semibold">
              {formatInt(
                placement === "preview"
                  ? receipt.rows.toWrite
                  : receipt.rows.committed,
              )}
            </div>
          </div>
          <div className="rounded border border-current/10 bg-white/65 p-2.5">
            <div className="text-[10px] uppercase tracking-wide opacity-60">
              {t("receipt.rowsToArchive")}
            </div>
            <div className="mt-1 text-xs font-medium">{archiveRows}</div>
          </div>
          <div className="rounded border border-current/10 bg-white/65 p-2.5">
            <div className="text-[10px] uppercase tracking-wide opacity-60">
              {t("receipt.reconciliation")}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-semibold ${verdictColor(
                  receipt.reconciliation.verdict,
                )}`}
              >
                {/* 11.7x — was `.toUpperCase()` on the raw enum, sitting
                    directly under the translated «Üzləşdirmə» label. Dropping
                    toUpperCase() is deliberate: it maps az "i" → "I", not
                    "İ". */}
                {localizeVerdict(tShared, receipt.reconciliation.verdict)}
              </span>
              {receipt.reconciliation.conflicts > 0 && (
                <span className="text-xs">
                  {t("receipt.conflicts", {
                    n: receipt.reconciliation.conflicts,
                  })}
                </span>
              )}
            </div>
            {/* 11.58 — a GREEN here before Apply is green BY CONSTRUCTION.
                The pre-write pass compares the parsed sums against themselves
                (`multi-file-orchestrator.ts:1552` marks it
                `evidence: "parse-self-check"`), so it proves the adapter read
                the file consistently and NOTHING about the database. Saying
                "GREEN" unqualified is what let a preview reassure an operator
                minutes before the real post-write check rejected the same
                import outright. The database comparison happens after Apply,
                and only that one is evidence. */}
            {placement === "preview" && (
              <p
                className="mt-1 text-[10px] leading-snug opacity-70"
                data-testid="receipt-preview-self-check"
              >
                {tFlow("previewIsSelfCheck")}
              </p>
            )}
          </div>
          <div className="rounded border border-current/10 bg-white/65 p-2.5">
            <div className="text-[10px] uppercase tracking-wide opacity-60">
              {t("receipt.recompute")}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-semibold ${recomputeStatusClass(
                  receipt.recompute.status,
                )}`}
              >
                {recomputeStatusLabel(receipt.recompute.status)}
              </span>
              <span className="font-mono text-xs">
                {receipt.recompute.ok}/{recomputeTargets}
              </span>
              {receipt.recompute.unknown > 0 || receipt.recompute.failed > 0 ? (
                <span className="text-xs">
                  {t("receipt.recomputeDetail", {
                    unknown: receipt.recompute.unknown,
                    failed: receipt.recompute.failed,
                  })}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-60">
                {t("receipt.affectedCompanies")}
              </div>
              <p className="mt-0.5 break-words font-mono text-xs">
                {compactList(receipt.affectedCompanies)}
              </p>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-60">
                {t("receipt.affectedPlans")}
              </div>
              <p className="mt-0.5 text-xs">
                {compactList(receipt.affectedPlans)}
              </p>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-60">
                {t("receipt.sectionsDetected")}
              </div>
              <p className="mt-0.5 text-xs">
                {receipt.sectionsDetected.length === 0
                  ? t("receipt.none")
                  : receipt.sectionsDetected
                      .map((section) => `${section.dataType} ${section.sheets}`)
                      .join(" · ")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-60">
                {t("receipt.archiveScope")}
              </div>
              <p className="mt-0.5 break-words font-mono text-xs">
                {receipt.archiveScopes.length === 0
                  ? t("receipt.none")
                  : compactList(
                      receipt.archiveScopes.map(
                        (scope) =>
                          `${scope.companyCode}/${scope.dataType}/${scope.planKind}`,
                      ),
                    )}
              </p>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-60">
                {t("receipt.skippedSheets")}
              </div>
              <p className="mt-0.5 break-words text-xs">
                {receipt.skippedSheets.length === 0
                  ? t("receipt.none")
                  : compactList(
                      receipt.skippedSheets.map(
                        (sheet) => `${sheet.filename}: ${sheet.sheetName}`,
                      ),
                      4,
                    )}
              </p>
            </div>
            {receipt.reconciliation.groups.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide opacity-60">
                  {t("receipt.groups")}
                </div>
                <p className="mt-0.5 break-words text-xs">
                  {compactList(
                    receipt.reconciliation.groups.map(
                      (group) =>
                        `${group.fileType}: ${
                          group.committed
                            ? formatInt(group.rows)
                            : localizeVerdict(tShared, group.verdict)
                        }`,
                    ),
                    4,
                  )}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {/* 11.55 — the payoff link, first and primary. The point of an
              import is the statement it produces; the receipt used to offer
              three admin destinations and no way to look at the numbers. */}
          <a
            href={PNL_HREF}
            className="rounded bg-slate-900 px-2.5 py-1 font-semibold text-white hover:bg-slate-800"
            data-testid="receipt-open-pnl"
          >
            {t("receipt.openPnl")}
          </a>
          <a
            href={receipt.links.riskTerminal}
            className="rounded border border-current/15 bg-white/70 px-2.5 py-1 font-medium hover:bg-white"
          >
            {t("receipt.openRiskTerminal")}
          </a>
          <a
            href={receipt.links.indicatorHealth}
            className="rounded border border-current/15 bg-white/70 px-2.5 py-1 font-medium hover:bg-white"
          >
            {t("receipt.openIndicatorHealth")}
          </a>
          <a
            href={receipt.links.rollback}
            className="rounded border border-current/15 bg-white/70 px-2.5 py-1 font-medium hover:bg-white"
          >
            {t("receipt.openRollback")}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 11.54 — the map goes first: what this screen does, in four plain
          sentences, with the current step lit. Before this the operator's
          first sight was an entity-alias admin panel. */}
      <ImportFlowStrip current={currentFlowStep} />

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

      {/* Phase 11.5 — explicit target year. Must match the year the reset
          panel cleared; a mismatch means the adapters silently drop every
          sheet and the group commits with zero rows. */}
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">{t("yearLabel")}</span>
        <select
          data-testid="multi-year"
          className="border rounded px-2 py-1 bg-background"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          disabled={isProcessing}
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {t("yearHint")}
        </span>
      </label>

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
                    aria-label={t("fileList.removeAria", { name: f.name })}
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
              resetDoctorState()
            }}
          />
          <span>{t("template.useSaved")}</span>
        </label>
        {yearMismatch !== null && (
          <div
            className="w-full rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-200"
            data-testid="year-mismatch"
          >
            {t("yearMismatch", { picked: year, detected: yearMismatch })}{" "}
            <button
              type="button"
              className="underline font-medium"
              onClick={() => setYear(yearMismatch)}
              data-testid="year-mismatch-fix"
            >
              {t("yearMismatchFix", { detected: yearMismatch })}
            </button>
          </div>
        )}
        {previewResult && (
          <button
            type="button"
            disabled={
              isProcessing ||
              hasUnresolvedCoaReviews ||
              hasStaleSheetFixes ||
              // Phase 11.5b — the server refuses this apply anyway; don't
              // offer a button whose only outcome is a 4xx.
              (yearMismatch !== null && !forceOverride) ||
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

      {/* 2026-07-30 — the workbook holds more than the picked year.
          The detection already existed (it powers the year gate that says
          "workbooks contain 2025, 2026"); until now the operator could only
          ACT on one of them, so covering a two-year file meant running the
          whole flow twice by hand. Opt-in, never implicit: widening what a
          click writes is the operator's decision. */}
      {previewResult && extraYears.length > 0 && (
        <div
          className="rounded border border-sky-300 bg-sky-50 p-3 text-sm dark:bg-sky-950/30 dark:border-sky-800"
          data-testid="multi-year-offer"
          // Machine-readable so the set is assertable without depending on
          // which locale rendered the sentence.
          data-years={detectedYearsAll.join(",")}
        >
          {/* 11.68 — frozen once the write starts.
              The request body is assembled at the moment Apply is pressed, so
              toggling this mid-run changes nothing at all — but it stayed
              clickable, which reads as "I can still change my mind". The owner
              hit exactly that: mid-apply the box was live, the year scope was
              already settled, and the run went out with 2026 alone. A control
              that pretends to steer a running write is worse than no control. */}
          <label
            className={`flex items-start gap-2 ${
              isProcessing ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={importAllYears}
              onChange={(e) => setImportAllYears(e.target.checked)}
              disabled={isProcessing}
              className="mt-1"
              data-testid="chk-all-years"
            />
            <span>
              <strong>
                {t("multiYear.title", { years: detectedYearsAll.join(", ") })}
              </strong>
              <br />
              <span className="text-xs opacity-80">
                {t("multiYear.hint", {
                  picked: year,
                  extra: extraYears.join(", "),
                })}
              </span>
            </span>
          </label>
        </div>
      )}

      {/* Error banner — sits right below buttons so it's always visible.
          11.58: it used to print the server string verbatim, so an operator
          (and, in a rehearsal, a client) read "HTTP 500" or a raw exception
          and had no idea whether their data was at risk. Now a plain sentence
          leads, the technical text is kept verbatim behind a disclosure for
          whoever debugs it, and the one thing the reader actually needs to
          know — nothing was written — is stated outright. */}
      {error && (
        <div
          ref={errorRef}
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
          data-testid="error-banner"
        >
          <p className="font-medium">❌ {t("errorBanner.title")}</p>
          <p className="mt-1 text-xs">{t("errorBanner.reassurance")}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs opacity-70">
              {t("errorBanner.details")}
            </summary>
            <pre
              className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-white/70 p-2 font-mono text-[11px]"
              data-testid="error-banner-raw"
            >
              {localizeImportMessage(tShared, error)}
            </pre>
          </details>
        </div>
      )}

      {/* 11.54 — live banner for BOTH steps, with an elapsed counter.
          Keyed on the phase so the counter restarts at Step 2 instead of
          carrying Step 1's seconds over. */}
      {runningPhase && (
        <ImportRunningBanner
          key={runningPhase}
          phase={runningPhase}
          years={runningYears}
        />
      )}

      {primaryDoctorIssue && (
        <div
          ref={doctorPanelRef}
          className="rounded-lg border border-blue-200 bg-white p-4 text-sm shadow-sm"
          data-testid="import-doctor-panel"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-slate-950">
                  {t("doctor.title")}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    primaryDoctorIssue.severity === "blocking"
                      ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                      : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
                  }`}
                  data-testid="import-doctor-issue"
                >
                  {doctorIssueLabel(primaryDoctorIssue.code)}
                </span>
                {/* 11.89 — the severity was already deciding the badge COLOUR
                    and never said the word. Amber over «Routing check» reads
                    as an alarm, and a routing finding blocks nothing: every
                    P&L, balance-sheet and cash-flow sheet is listed there as a
                    matter of course. Twice in one session that colour sent a
                    reader hunting for a defect that did not exist. Colour is a
                    hint; the sentence is the fact. */}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    primaryDoctorIssue.severity === "blocking"
                      ? "bg-red-100 text-red-800"
                      : "bg-slate-100 text-slate-600"
                  }`}
                  data-testid="import-doctor-severity"
                >
                  {t(
                    primaryDoctorIssue.severity === "blocking"
                      ? "doctor.severityBlocking"
                      : "doctor.severityWarning",
                  )}
                </span>
              </div>
              <p className="mt-1 max-w-[72ch] text-xs text-slate-600">
                {t("doctor.subtitle")}
              </p>
              <p className="mt-2 max-w-[72ch] text-slate-800">
                {primaryDoctorIssue.message}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void requestDoctorExplanation()}
                disabled={!!doctorLoading}
                className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-blue-100"
                data-testid="btn-doctor-explain"
              >
                {doctorLoading === "explain"
                  ? t("doctor.explainLoading")
                  : t("doctor.explain")}
              </button>
              <button
                type="button"
                onClick={() => void requestDoctorFix()}
                disabled={!!doctorLoading}
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-800"
                data-testid="btn-doctor-suggest"
              >
                {doctorLoading === "fix"
                  ? t("doctor.suggestLoading")
                  : t("doctor.suggest")}
              </button>
              <button
                type="button"
                onClick={scrollToDoctorProblem}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                data-testid="btn-doctor-go-problem"
              >
                {t("doctor.goToProblem")}
              </button>
            </div>
          </div>

          {doctorError && (
            <div
              className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              data-testid="import-doctor-error"
            >
              {doctorError}
            </div>
          )}
          {doctorStatus && (
            <div
              className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"
              data-testid="import-doctor-status"
            >
              {doctorStatus}
            </div>
          )}

          {/* 2026-08-03 — what to do, before anyone asks the AI.
              The advice used to arrive only after an "Explain" round-trip, so
              the panel's DEFAULT state named a problem and offered no move.
              This is deterministic, always present, and free. */}
          {primaryDoctorIssue && (
            <div
              className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded border px-3 py-2 ${
                doctorNextStep(primaryDoctorIssue.code).canProceed
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-blue-200 bg-blue-50"
              }`}
              data-testid="import-doctor-next-step"
            >
              <p className="text-xs text-slate-800">
                {t(
                  `doctor.nextStep.${doctorNextStep(primaryDoctorIssue.code).key}`,
                )}
                {doctorNextStep(primaryDoctorIssue.code).canProceed && (
                  <span className="ml-1 font-semibold text-emerald-800">
                    {t("doctor.nextStep.canProceed")}
                  </span>
                )}
              </p>
              {doctorNextStep(primaryDoctorIssue.code).tab && (
                <button
                  type="button"
                  onClick={scrollToDoctorProblem}
                  className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  data-testid="btn-doctor-next-step"
                >
                  {t("doctor.nextStep.openTab", {
                    // The tab strip's own label, so the button names the tab
                    // exactly as it is written on the tab.
                    tab: t(
                      `review.tab.${doctorNextStep(primaryDoctorIssue.code).tab}` as never,
                    ),
                  })}
                </button>
              )}
            </div>
          )}

          {doctorExplanation && (
            <div
              className="mt-4 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-3"
              data-testid="import-doctor-explanation"
            >
              <div className="lg:col-span-2">
                <h4 className="font-semibold text-slate-950">
                  {doctorExplanation.title}
                </h4>
                <p className="mt-1 text-slate-700">
                  {doctorExplanation.plainExplanation}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">
                    {t("doctor.whyBlocked")}
                  </span>{" "}
                  {doctorExplanation.whyBlocked}
                </p>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("doctor.whatToCheck")}
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                  {doctorExplanation.whatToCheck.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-700">
                  <span className="font-medium">
                    {t("doctor.safeNextStep")}
                  </span>{" "}
                  {doctorExplanation.safeNextStep}
                </div>
              </div>
            </div>
          )}

          {doctorFix && (
            <div
              className="mt-4 rounded border border-slate-200 bg-slate-50 p-3"
              data-testid="import-doctor-fix"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-slate-950">
                      {doctorFix.title}
                    </h4>
                    <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                      {Math.round(doctorFix.confidence * 100)}%
                    </span>
                    <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                      {doctorRiskLabel(doctorFix.risk)}
                    </span>
                  </div>
                  <p className="mt-1 max-w-[72ch] text-xs text-slate-700">
                    {doctorFix.rationale}
                  </p>
                  {doctorFix.executable ? (
                    <p className="mt-2 font-mono text-[11px] text-slate-500">
                      {doctorFix.kind === "sheet_fix"
                        ? `${doctorFix.patch.filename} / ${doctorFix.patch.sheetName}`
                        : doctorFix.kind === "coa_mapping"
                          ? `${doctorFix.patch.filename} / ${doctorFix.patch.sheetName} / ${doctorFix.patch.sourceLabel}`
                          : doctorFix.patch.key}
                    </p>
                  ) : (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                      {doctorFix.manualSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {doctorFix.executable && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={applyDoctorFix}
                      className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
                      data-testid="btn-doctor-apply-preview"
                    >
                      {t("doctor.applyPreview")}
                    </button>
                    {doctorFix.requiresPreviewRerun && (
                      <button
                        type="button"
                        disabled={
                          files.length === 0 ||
                          isProcessing ||
                          overSizeCap ||
                          overCountCap
                        }
                        onClick={() => submit(false)}
                        className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-50"
                        data-testid="btn-doctor-rerun-preview"
                      >
                        {t("doctor.rerunPreview")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 11.67 — the strip sits ABOVE every panel it controls.
          It used to be declared between the fix panels and the read-only ones,
          so conflicts / account review / guided fixes rendered ABOVE it while
          routing / receipt / warnings / analysis rendered BELOW: the tabs
          appeared to jump from the top of the block to the bottom depending on
          which one was open. Reported the first time a real preview was driven
          through them. A tab strip has to be a fixed frame, or it is not a
          frame at all. */}
      {effectiveReviewTab && (
        <ImportReviewTabs
          tabs={reviewTabDefs}
          active={effectiveReviewTab}
          onChange={setReviewTab}
        />
      )}

      {/* Conflict banner */}
      {previewResult && hasConflicts && (
        <div
          ref={conflictBannerRef}
          className="rounded border border-red-300 bg-red-50 p-4 space-y-3"
          data-testid="conflict-banner"
          hidden={!showTab("conflicts")}
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
          hidden={!showTab("coa")}
        >
          <div>
            <h3 className="font-semibold text-amber-900">
              {t("coaReview.title", { n: coaReviewItems.length })}
            </h3>
            <p className="text-xs text-amber-800 mt-1">
              {t("coaReview.description")}
            </p>
          </div>
          {/* 11.64 — bounded like the guided-fix table, and for the same
              reason: this is the ONLY place an unresolved CoA mapping can be
              decided, so it stays visible and mounted; only its length is
              capped. */}
          <div className="max-h-[24rem] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-amber-50">
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
                      {/* 11.7x — this panel BLOCKS Apply, so its «Səbəb»
                          column was the English the client had to read to get
                          unstuck. Produced by the dynamic PLF/BS/CF adapters. */}
                      <td className="py-1.5 pr-2 align-top text-amber-900">
                        {localizeImportMessage(tShared, item.reason)}
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
          hidden={!showTab("fixes")}
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
          {/* 11.64 — bounded, NOT hidden. On a real workbook this table is 23
              rows of three dropdowns each and pushed everything below it off
              the screen. It fixes a blocker, so it must stay visible and
              mounted; capping its height gives the page a stable frame while
              the header, the count and the re-run button stay in view. The
              sticky header keeps the column meanings while you scroll. */}
          <div className="max-h-[24rem] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-violet-50">
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
          hidden={!showTab("routing")}
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
                            row.foldedInto
                              ? "bg-teal-100 text-teal-800"
                              : row.action === "write"
                                ? // 14.8 — an eliminations write is a write, but
                                  // it deliberately lands on no company, so the
                                  // entity column reads "—". Plain green "write"
                                  // beside that dash reads as a bug; the indigo
                                  // badge says which kind of write it is, the
                                  // same way the teal one does for a fold.
                                  row.reason === "elimination"
                                  ? "bg-indigo-100 text-indigo-800"
                                  : "bg-emerald-100 text-emerald-800"
                                : "bg-orange-100 text-orange-800"
                          }`}
                        >
                          {row.foldedInto
                            ? t("routing.fold", { column: row.foldedInto.viaHeader })
                            : row.action === "write"
                              ? row.reason === "elimination"
                                ? t("routing.writeElim")
                                : t("routing.write")
                              : row.reason === "elimination"
                                ? t("routing.skipElim")
                                : row.reason === "adjustment"
                                  ? t("routing.skipAdjustment")
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

      {previewResult?.safetyReceipt && (
        <div hidden={!showTab("receipt")}>
          {renderSafetyReceipt(previewResult.safetyReceipt, "preview")}
        </div>
      )}

      {/* 2026-07-30 — show WHY a preview is blocked.
          `renderWarnings` existed but was wired only to the APPLY result, so a
          preview aborted by the routing safety gate showed "RED / Blocked" and
          nothing else: the reasons (BLOCKED / COLLISION / COMPLETENESS /
          COA_REVIEW, plus every per-sheet skip) were already in the response
          and no one rendered them. Measured on production 2026-07-29 — the
          operator met a red verdict with no route to the cause, while the
          Import Doctor button, the only other path to an explanation, was
          itself failing on a truncated reply. Nothing new is computed here;
          text that already existed is finally displayed. */}
      {previewResult && (
        <div hidden={!showTab("warnings")}>
          {renderWarnings(previewResult, "preview-warnings")}
        </div>
      )}

      {/* Preview result — 2026-05-27 expanded: per-sheet dataType chip,
          AI confidence bar, and affected-indicators chip list, so the
          admin can verify both classification correctness AND downstream
          impact before clicking Apply. */}
      {previewResult && previewResult.perFile.length > 0 && (
        <div
          className="space-y-3"
          data-testid="preview-result"
          hidden={!showTab("analysis")}
        >
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
          {/* 2026-08-18 (second pass) — the outage banner also belongs HERE.
              Pass one put it only on the apply-completeness result, so at
              Step 1 — which is where the owner actually was, screenshot in
              hand — there was no banner at all and the file card carried the
              provider's raw billing text instead. `f.error` is the classified
              code now, so the whole preview can say the one true thing once
              rather than repeating it per file. */}
          {(() => {
            const outage = previewResult.perFile
              .map((f) => f.error)
              .find((c) => isAiOutageCode(c))
            return outage && isAiOutageCode(outage) ? (
              <div
                className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                data-testid="preview-ai-outage"
              >
                {localizeAiOutage(tShared, outage, "classify")}
              </div>
            ) : null
          })()}
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
                {/* 11.7x — one per uploaded file. file-type-detector.ts
                    builds 16 English template literals; the localizer
                    re-renders the recognised shapes from the catalogue. */}
                <p className="text-xs text-slate-600">
                  {localizeImportMessage(tShared, f.fileTypeResult.reasoning)}
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
                  <p className="text-xs text-red-700">
                    {/* A bare code would render as the token «ai_credits»;
                        the full sentence lives in the banner above, so this
                        stays a short per-file attribution. */}
                    ⚠{" "}
                    {isAiOutageCode(f.error)
                      ? tShared("msg.classificationFailedCode", {
                          cause: tShared(`msg.aiCause.${f.error}`),
                        })
                      : localizeImportMessage(tShared, f.error)}
                  </p>
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
                            {/* writes summary — 11.53: say it in the reader's
                                language, and in statement names rather than
                                table names. The server string is hardcoded
                                Russian (`datatype-indicator-map.ts`) and reads
                                like schema ("BudgetLine.plannedAmount"); it
                                stays as the hover title for whoever is
                                debugging, but a finance reader gets
                                "Profit & loss — 12 months". */}
                            <p
                              className="text-[10px] text-slate-500 mt-1.5"
                              title={imp.impact.writes}
                            >
                              <span className="text-slate-600">{t("preview.writes")}: </span>
                              {t.has(`preview.dataTypeWrites.${imp.dataType}` as never)
                                ? t(`preview.dataTypeWrites.${imp.dataType}` as never)
                                : imp.impact.writes}
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
                                      {/* 11.53 — was `nameRu ?? nameEn`, so an
                                          Azerbaijani page named every indicator
                                          in Russian while `nameAz` sat unused
                                          in the very same payload. */}
                                      <span>
                                        {localizedName(locale, ind, ind.code)}
                                      </span>
                                      <span className="font-mono text-[9px] text-slate-400">
                                        {ind.code}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : imp.impact.note ? (
                              // 11.53 — same treatment as `writes` above.
                              <p
                                className="text-[10px] text-slate-500 italic mt-1.5"
                                title={imp.impact.note}
                              >
                                {t.has(`preview.dataTypeNote.${imp.dataType}` as never)
                                  ? t(`preview.dataTypeNote.${imp.dataType}` as never)
                                  : imp.impact.note}
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
          {/* 11.55 — a committed import goes on to the numbers it produced.
              Gated on `committed`, deliberately: a REJECTED import must stay
              on screen, because its reason is the only thing of value and
              nothing was written to go and look at. */}
          {applyResult.perGroup.some((g) => g.committed) && (
            <ImportDoneRedirect />
          )}
          {applyResult.safetyReceipt &&
            renderSafetyReceipt(applyResult.safetyReceipt, "applied")}
          {renderIncompleteness(applyResult)}
          {renderWarnings(applyResult)}
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
                    : g.skipReason
                      ? localizeImportMessage(tShared, g.skipReason)
                      : t("result.skipped")}
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

      {/* Step 3 — shown after an apply that actually WROTE something.
          11.58: the condition was `overallVerdict !== "red"`, which put a
          green ✅ "Import complete" box directly above a YELLOW receipt —
          two contradictory verdicts on one screen — and showed the same ✅
          for an `applied_no_writes` run that committed nothing at all.
          Now it requires a committed group, and a yellow verdict is dressed
          as a caution rather than a success. */}
      {applyResult &&
        applyResult.overallVerdict !== "red" &&
        applyResult.perGroup.some((g) => g.committed) && (
        <div
          className={`rounded-lg border-2 p-5 space-y-3 ${
            applyResult.overallVerdict === "yellow"
              ? "border-amber-400 bg-amber-50"
              : "border-emerald-400 bg-emerald-50"
          }`}
          data-testid="step3-done"
          data-verdict={applyResult.overallVerdict}
        >
          <div className="flex items-center gap-2">
            <span className="text-2xl">
              {applyResult.overallVerdict === "yellow" ? "⚠️" : "✅"}
            </span>
            <div>
              <p
                className={`font-semibold ${
                  applyResult.overallVerdict === "yellow"
                    ? "text-amber-800"
                    : "text-emerald-800"
                }`}
              >
                {applyResult.overallVerdict === "yellow"
                  ? t("step3.titleWithWarnings")
                  : t("step3.title")}
              </p>
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
