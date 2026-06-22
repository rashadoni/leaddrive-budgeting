/**
 * Phase 7.M Tier 4 (2026-05-19) — AI Import: Sheet classifier.
 *
 * Takes a batch of sheet metadata (from `sheet-meta-extractor.ts`) and
 * asks the LLM to classify each one (P&L / BS / CF / KPI / CAPEX / Land /
 * Sales / Descriptions / Unknown) AND extract the entity code it belongs
 * to (AZSEKER-CPC etc.).
 *
 * Design:
 *   • One LLM call per workbook (batched across all sheets) — keeps token
 *     spend bounded at ~3-5k input + ~2k output tokens regardless of
 *     workbook size.
 *   • SDK seam (`anthropicClient` injected) for test isolation.
 *   • JSON-only output with strict shape validation.
 *   • Section separators (sheets with `>>>` in name) are skipped
 *     pre-LLM — emit INFO_SUMMARY directly without burning tokens.
 *   • Empty workbooks emit zero classifications, no LLM call.
 *
 * Mirrors `AnthropicLLMService.generateMapping()` pattern.
 */
import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract"
import {
  SHEET_CLASSIFIER_SYSTEM_PROMPT,
  SHEET_CLASSIFIER_PROMPT_VERSION,
  buildSheetClassifierUserMessage,
} from "@/lib/llm/prompts/sheet-classifier-system"
import type { SheetMeta } from "./sheet-meta-extractor"
import type { LLMUsage } from "@/lib/llm/types"
import {
  resolveSheetRouting,
  type PlanKind,
  type SheetRole,
  type PlanKindSignal,
  type RoleSignal,
  type SheetMap,
} from "./sheet-routing"

export type SheetDataType =
  | "PLF"
  | "BS"
  | "CF"
  | "KPI_FARMING"
  | "KPI_PROCESSING"
  | "CAPEX"
  | "SALES"
  | "LAND_REGISTRY"
  | "DESCRIPTIONS"
  | "INFO_SUMMARY"
  // Phase 7.M Tier 6 — onboarding consolidation. COMPANIES is a
  // structural sheet listing the org's entity tree (code / name /
  // industry / level / parentCompanyCode). Detected by header shape —
  // see companies-import.canonicalizeHeaders for the canonical column set.
  | "COMPANIES"
  // Phase 7.M Tier 7 — import consolidation. OPS_FACTS is a flat
  // tabular operational-facts sheet (headers: companyCode | metric |
  // date | value | unit | sourceNote). Distinct from KPI_FARMING /
  // KPI_PROCESSING / SALES which are Azik-shape sheets with hardcoded
  // metric positions. Writes to the same `operational_facts` table via
  // runKpiBatch — see operational-facts-import.parseOperationalFactsWorkbook.
  | "OPS_FACTS"
  // Phase 7.M Tier 7 — import consolidation (Phase 3 of 5). BUDGET_ACTUALS
  // is a flat tabular budget-actuals sheet (headers: category | department |
  // amount | date | description | lineType [optional: companyCode]).
  // Each row = one expense/revenue actual transaction. Distinct from PLF
  // (which has rows × period-month columns) — BUDGET_ACTUALS has one row
  // per transaction with date in a column. Writes to `budget_actuals`
  // table (separate from BudgetLine/PLF) via runActualsBatch.
  | "BUDGET_ACTUALS"
  // Phase 7.M Tier 7 — import consolidation (Phase 4 of 5). SALES_FORECAST
  // is a department×month forecast grid: col 1 = department label, cols
  // 2-13 = 12 month columns (Jan..Dec, full or short, EN/RU/AZ accepted).
  // Each cell = forecast amount for (department, month). Distinct from
  // PLF (whose rows are P&L line items like Revenue/COGS/Gross Profit),
  // and from existing SALES dataType (which writes operational_facts via
  // Azik KPI handler). Writes to `sales_forecasts` table via runSalesForecastBatch.
  | "SALES_FORECAST"
  // 2026-06-21 — counterparty register (top customers / suppliers by turnover,
  // typically per entity side-by-side). Each block: counterparty name + turnover.
  // The adapter derives sharePct and writes the `Counterparty` table, which
  // counterpartyHhiResolver reads to compute CUSTOMER_HHI / SUPPLIER_HHI.
  // Distinct from SALES (Azik KPI shape) — DO NOT classify a top-customers
  // table as SALES (that misroutes turnover into operational_facts).
  | "COUNTERPARTY"
  // 2026-06-21 — active court cases / legal disputes register (rows: case #,
  // date, court, claimant, defendant entity, claim amount, status). Writes to
  // Company.settings.courtDisputes; feeds LEGAL_CASES_ACTIVE.
  | "LEGAL_CASES"
  // 2026-06-21 — internal-audit findings / observations register (rows:
  // observation, severity major/minor, responsible unit, status). Writes to
  // Company.settings.auditFindings; feeds AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN.
  | "AUDIT_FINDINGS"
  // 2026-06-21 — enterprise risk register / KRI taxonomy (Level 1/2/3 risk
  // categories + criticality + description). Recognized so it is NOT
  // misclassified; a dedicated importer is added once a KRI consumer exists.
  | "RISK_REGISTER"
  | "UNKNOWN"

export interface SheetClassification {
  sheetName: string
  dataType: SheetDataType
  /** Resolved canonical entity code (e.g. AZSEKER-CPC) or null for cross-entity sheets. */
  entityCode: string | null
  /** 0..1 — below 0.6 means LLM was guessing. */
  confidence: number
  /** One-line explanation citing the signal. */
  reasoning: string
  /**
   * actual vs budget routing target (decouple plan). Stamped by `withPlanKind`
   * via the deterministic `resolveSheetRouting` authority chain (>>> section >
   * config > tab-name keyword > dataType rule). `null` = NO trusted signal
   * fired — the orchestrator must NOT silently treat it as actual (it blocks a
   * mixed workbook, defaults actual only for a pure-actuals one). `undefined`
   * only before `withPlanKind` runs.
   */
  planKind?: PlanKind | null
  /**
   * Source-of-record vs a derived/summary view (consolidation, pivot,
   * comparison, margin). Derived sheets are SKIPPED on write so the multiple
   * same-dataType views in a reporting pack can't clean-slate the source.
   */
  role?: SheetRole
  /** Which signal resolved planKind / role — surfaced in the import report. */
  planKindSignal?: PlanKindSignal
  roleSignal?: RoleSignal
}

/** Decide whether a classified sheet is realized ACTUALs or a forward BUDGET. */
export function planKindForSheet(
  dataType: SheetDataType,
  sectionContext: "actual" | "budget" | "kpi" | "capex" | null,
): "actual" | "budget" {
  if (sectionContext === "budget") return "budget"
  if (sectionContext === "actual") return "actual"
  // No explicit section signal → infer from dataType:
  //  • SALES / SALES_FORECAST — forward plans (revenue targets).
  //  • BUDGET_ACTUALS — realized spend recorded AGAINST a budget; its
  //    BudgetActual rows must share the budget plan's planId so execution
  //    % (Σactual ÷ Σplanned within one plan) computes. Routing them to
  //    the actuals plan would orphan them from the budgeted lines.
  //  • everything else (PLF/BS/CF realized statements) → actuals plan
  //    (the Risk Terminal's P&L source).
  if (
    dataType === "SALES" ||
    dataType === "SALES_FORECAST" ||
    dataType === "BUDGET_ACTUALS"
  ) {
    return "budget"
  }
  return "actual"
}

/**
 * Stamp planKind + role onto each classification via the deterministic
 * `resolveSheetRouting` chain — the sheet's section context (from the
 * meta-extractor) plus an optional per-shape config map. Supersedes the
 * section-only `planKindForSheet`: it adds tab-name keyword resolution, a
 * source-vs-derived `role`, and a `null` planKind (instead of a silent
 * "actual" default) when no trusted signal fires.
 */
function withPlanKind(
  classifications: SheetClassification[],
  metas: SheetMeta[],
  config?: SheetMap,
): SheetClassification[] {
  const sectionByName = new Map(metas.map((m) => [m.sheetName, m.sectionContext]))
  return classifications.map((c) => {
    const r = resolveSheetRouting({
      dataType: c.dataType,
      sheetName: c.sheetName,
      section: sectionByName.get(c.sheetName) ?? null,
      config,
    })
    return {
      ...c,
      planKind: r.planKind,
      role: r.role,
      planKindSignal: r.planKindSignal,
      roleSignal: r.roleSignal,
    }
  })
}

export interface SheetClassifierInput {
  sheetMetas: SheetMeta[]
  /** Optional: known entity codes in this org (e.g. ['AZSEKER-CPC',...]). */
  knownEntityCodes?: string[]
  /** Optional: org primary industry hint. */
  orgIndustry?: string
  /** Phase 7.M Tier 5 — optional filename hint as soft prior for the
   *  classifier (e.g. "Farming strategy - Guvven.xlsx" → suggests
   *  forward-forecast). Does NOT override sheet-shape evidence. */
  filenameHint?: string
  /** Optional per-shape sheet-map (deterministic role/planKind overrides),
   *  forwarded to resolveSheetRouting via withPlanKind. */
  sheetMap?: SheetMap
}

export interface SheetClassifierResult {
  classifications: SheetClassification[]
  usage: LLMUsage
  /** True if no LLM call was made (e.g. all sheets were separators). */
  skippedLLM: boolean
}

/** Anthropic-style client seam — minimal interface so we can test with a stub. */
export interface SheetClassifierAnthropicLike {
  messages: {
    create: (params: {
      model: string
      max_tokens: number
      system: string
      messages: Array<{ role: "user"; content: string }>
    }) => Promise<{
      stop_reason: string | null
      content: Array<{ type: string; text?: string }>
      usage?: { input_tokens: number; output_tokens: number }
    }>
  }
}

export interface ClassifySheetsOptions {
  model?: string
  maxTokens?: number
}

const VALID_DATA_TYPES = new Set<SheetDataType>([
  "PLF",
  "BS",
  "CF",
  "KPI_FARMING",
  "KPI_PROCESSING",
  "CAPEX",
  "SALES",
  "LAND_REGISTRY",
  "DESCRIPTIONS",
  "INFO_SUMMARY",
  "COMPANIES",
  "OPS_FACTS",
  "BUDGET_ACTUALS",
  "SALES_FORECAST",
  "COUNTERPARTY",
  "LEGAL_CASES",
  "AUDIT_FINDINGS",
  "RISK_REGISTER",
  "UNKNOWN",
])

/**
 * Reduce a `SheetMeta` to the compact shape the LLM needs to see. Trims
 * cell content + column profiles to keep payload small.
 */
function metaForLLM(meta: SheetMeta) {
  return {
    sheetName: meta.sheetName,
    totalRows: meta.totalRows,
    totalColumns: meta.totalColumns,
    headers: meta.headers.slice(0, 12),
    sample: meta.sample.slice(0, 3).map((row) => row.slice(0, 12)),
    columnProfiles: meta.columnProfiles.slice(0, 12).map((p) => ({
      header: p.header,
      types: p.types,
      sampleValues: p.sampleValues.slice(0, 3),
    })),
  }
}

/**
 * Pre-LLM classification for sheets that don't need AI:
 *   • Section separators (sheet name has `>>>`) → INFO_SUMMARY
 *   • Empty sheets → UNKNOWN with confidence 0.0
 */
function preClassify(meta: SheetMeta): SheetClassification | null {
  if (meta.isSectionSeparator) {
    return {
      sheetName: meta.sheetName,
      dataType: "INFO_SUMMARY",
      entityCode: null,
      confidence: 1.0,
      reasoning: "Section separator pattern '>>>' in sheet name",
    }
  }
  if (meta.totalRows === 0) {
    return {
      sheetName: meta.sheetName,
      dataType: "UNKNOWN",
      entityCode: null,
      confidence: 0.0,
      reasoning: "Sheet is empty",
    }
  }
  return null
}

function validateClassification(
  raw: unknown,
  index: number,
): SheetClassification {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `Classification[${index}] is not an object (got: ${typeof raw})`,
    )
  }
  const r = raw as Record<string, unknown>
  const sheetName = typeof r.sheetName === "string" ? r.sheetName : null
  if (!sheetName)
    throw new Error(
      `Classification[${index}]: missing or non-string sheetName`,
    )
  const dataType = String(r.dataType) as SheetDataType
  if (!VALID_DATA_TYPES.has(dataType))
    throw new Error(
      `Classification[${index}] sheetName="${sheetName}" has invalid dataType "${r.dataType}"`,
    )
  const entityCode =
    r.entityCode === null || r.entityCode === undefined
      ? null
      : typeof r.entityCode === "string"
        ? r.entityCode
        : null
  const confidence =
    typeof r.confidence === "number" && Number.isFinite(r.confidence)
      ? Math.max(0, Math.min(1, r.confidence))
      : 0
  const reasoning =
    typeof r.reasoning === "string" ? r.reasoning : "(no reasoning supplied)"
  return { sheetName, dataType, entityCode, confidence, reasoning }
}

/**
 * Main entry: classify a batch of sheets via one LLM call. Pure function
 * relative to (input, anthropicClient, opts) — no DB writes, no global
 * state.
 */
export async function classifySheets(
  input: SheetClassifierInput,
  anthropicClient: SheetClassifierAnthropicLike,
  model: string,
  opts: ClassifySheetsOptions = {},
): Promise<SheetClassifierResult> {
  // Pre-classify separators + empty sheets locally.
  const preClassified: SheetClassification[] = []
  const needsLLM: SheetMeta[] = []
  for (const meta of input.sheetMetas) {
    const pre = preClassify(meta)
    if (pre) preClassified.push(pre)
    else needsLLM.push(meta)
  }

  if (needsLLM.length === 0) {
    return {
      classifications: withPlanKind(preClassified, input.sheetMetas, input.sheetMap),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        modelName: opts.model ?? model,
        promptVersion: SHEET_CLASSIFIER_PROMPT_VERSION,
      },
      skippedLLM: true,
    }
  }

  const maxTokens = opts.maxTokens ?? 8192
  const usedModel = opts.model ?? model

  const userMessage = buildSheetClassifierUserMessage({
    sheets: needsLLM.map(metaForLLM),
    knownEntityCodes: input.knownEntityCodes,
    orgIndustry: input.orgIndustry,
    filenameHint: input.filenameHint,
  })

  const response = await anthropicClient.messages.create({
    model: usedModel,
    max_tokens: maxTokens,
    system: SHEET_CLASSIFIER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  })

  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `Sheet classifier truncated at max_tokens=${maxTokens}. Re-run with higher maxTokens (response clipped mid-JSON).`,
    )
  }
  const textBlocks = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
  if (textBlocks.length === 0) {
    throw new Error("Sheet classifier response had no text content")
  }
  const raw = textBlocks.join("\n").trim()
  const jsonText = extractJsonFromText(raw)

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new Error(
      `Sheet classifier returned invalid JSON: ${err instanceof Error ? err.message : err}.\nFirst 300 chars: ${jsonText.slice(0, 300)}`,
    )
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Sheet classifier returned non-object: ${typeof parsed}`)
  }
  const root = parsed as Record<string, unknown>
  if (!Array.isArray(root.classifications)) {
    throw new Error(
      `Sheet classifier response missing "classifications" array (keys: ${Object.keys(root).join(", ")})`,
    )
  }
  const llmClassifications: SheetClassification[] = root.classifications.map(
    (raw, i) => validateClassification(raw, i),
  )

  // Cross-check: every sheet sent to LLM should be in response.
  const llmSheetNames = new Set(llmClassifications.map((c) => c.sheetName))
  for (const meta of needsLLM) {
    if (!llmSheetNames.has(meta.sheetName)) {
      // LLM dropped this sheet — fill with UNKNOWN so caller doesn't
      // silently lose data.
      llmClassifications.push({
        sheetName: meta.sheetName,
        dataType: "UNKNOWN",
        entityCode: null,
        confidence: 0,
        reasoning: "LLM did not return a classification for this sheet",
      })
    }
  }

  // Merge: pre-classified + LLM, preserving original sheet order.
  const byName = new Map<string, SheetClassification>()
  for (const c of preClassified) byName.set(c.sheetName, c)
  for (const c of llmClassifications) byName.set(c.sheetName, c)
  const ordered: SheetClassification[] = []
  for (const meta of input.sheetMetas) {
    const c = byName.get(meta.sheetName)
    if (c) ordered.push(c)
  }

  return {
    classifications: withPlanKind(ordered, input.sheetMetas, input.sheetMap),
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      modelName: usedModel,
      promptVersion: SHEET_CLASSIFIER_PROMPT_VERSION,
    },
    skippedLLM: false,
  }
}
