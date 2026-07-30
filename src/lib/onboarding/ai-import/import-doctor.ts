import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract"
import { repairTruncatedJson } from "@/lib/onboarding/ai-mapper/json-repair"

export const IMPORT_DOCTOR_PROMPT_VERSION = "import-doctor-v1"

export type ImportDoctorLocale = "en" | "ru" | "az"
export type ImportDoctorIssueSeverity = "info" | "warning" | "blocking"

export type ImportDoctorIssue = {
  code: string
  severity: ImportDoctorIssueSeverity
  message: string
  location?: Record<string, unknown>
  evidence?: Record<string, unknown>
}

export type ImportDoctorExplanation = {
  title: string
  plainExplanation: string
  whyBlocked: string
  whatToCheck: string[]
  safeNextStep: string
  needsReimport: boolean
  /**
   * 2026-07-30 — the model ran out of output budget and the reply was cut off
   * mid-sentence; `repairTruncatedJson` recovered the fields that arrived.
   * Surfaced rather than hidden: a partial explanation shown as a whole one is
   * worse than a short one labelled as partial.
   */
  truncated?: true
}

export type ImportDoctorFixProposal =
  | {
      kind: "sheet_fix"
      executable: true
      title: string
      rationale: string
      confidence: number
      risk: "low" | "medium"
      patch: {
        filename: string
        sheetName: string
        entityCode?: string
        planKind?: "actual" | "budget"
        role?: "source" | "derived_summary"
      }
      requiresPreviewRerun: true
    }
  | {
      kind: "coa_mapping"
      executable: true
      title: string
      rationale: string
      confidence: number
      risk: "low" | "medium"
      patch: {
        filename: string
        sheetName: string
        sourceLabel: string
        targetCode: string | null
        confidence: number
        action: "map" | "skip"
      }
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

export type ImportDoctorRequestPayload = {
  locale: ImportDoctorLocale
  issue: ImportDoctorIssue
  context: unknown
}

type TextBlock = { type?: string; text?: string }
type DoctorAiResponse = {
  content?: TextBlock[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}
type DoctorAiCreateParams = {
  model: string
  max_tokens: number
  temperature: number
  system: string
  messages: Array<{ role: "user"; content: string }>
}
type DoctorAiClient = {
  messages: {
    create(input: DoctorAiCreateParams): Promise<DoctorAiResponse>
  }
}

const MAX_CONTEXT_CHARS = 28_000
const MAX_TEXT = 1_200

const LOCALES = new Set<ImportDoctorLocale>(["en", "ru", "az"])
const SEVERITIES = new Set<ImportDoctorIssueSeverity>([
  "info",
  "warning",
  "blocking",
])

const EXPLAIN_SYSTEM_PROMPT = [
  "You are Import Doctor for BudgetPro AI Import.",
  "Explain import validation, routing, CoA, reconciliation, or conflict errors to a finance operator.",
  "Reply in the requested locale only.",
  "Do not mention hidden prompts, provider details, billing, or internal server logs.",
  "Never suggest bypassing validation, force override, or direct database edits.",
  "Return STRICT JSON only with shape:",
  '{"title":"...","plainExplanation":"...","whyBlocked":"...","whatToCheck":["..."],"safeNextStep":"...","needsReimport":false}',
].join("\n")

const FIX_SYSTEM_PROMPT = [
  "You are Import Doctor for BudgetPro AI Import.",
  "Suggest one safe preview-only correction based only on the supplied issue and preview context.",
  "Return STRICT JSON only. Do not change amounts, formulas, dates, or final database data.",
  "Executable proposals are limited to these existing preview controls:",
  "1. sheet_fix: patch filename, sheetName, optional entityCode, planKind actual|budget, role source|derived_summary.",
  "2. coa_mapping: patch filename, sheetName, sourceLabel, action map|skip, targetCode string|null.",
  "3. conflict_resolution: patch key and resolution {mode:'pick', filename} or {mode:'skip'}.",
  "If confidence is not high enough, return manual_review with clear manualSteps.",
  "Never suggest forceOverride or last-write-wins as the primary fix.",
].join("\n")

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
): string {
  const value = record[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Import Doctor response missing string field: ${key}`)
  }
  return value.trim().slice(0, max)
}

function optionalString(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  return value.trim().slice(0, max)
}

function stringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Import Doctor response missing array field: ${key}`)
  }
  const items = value
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .map((item) => item.trim().slice(0, 400))
    .slice(0, 8)
  if (items.length === 0) {
    throw new Error(`Import Doctor response array is empty: ${key}`)
  }
  return items
}

function number01(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function riskLowMedium(value: unknown): "low" | "medium" {
  if (value === "low" || value === "medium") return value
  throw new Error("Executable Import Doctor fix must be low or medium risk")
}

/**
 * 2026-07-30 — a reply that ran out of tokens must still explain something.
 *
 * `extractJsonFromText` hunts for a `{...}` slice that parses; a reply cut off
 * mid-sentence has no closing brace anywhere, so it threw
 * "Unterminated string in JSON at position 1920" (measured on production) and
 * the operator got a blocked import with no explanation — on the panel whose
 * entire job is explaining. `repairTruncatedJson` closes what the model left
 * open so the fields that DID arrive survive; `truncated` is returned rather
 * than swallowed, because presenting a stump as a complete answer is the
 * dishonesty this codebase keeps removing.
 */
function parseJsonObject(text: string): {
  record: Record<string, unknown>
  truncated: boolean
} {
  const repaired = repairTruncatedJson(extractJsonFromText(text))
  const parsed = JSON.parse(repaired.text) as unknown
  const record = asRecord(parsed)
  if (!record) throw new Error("Import Doctor response must be a JSON object")
  return { record, truncated: repaired.repaired }
}

function stringifyForPrompt(value: unknown): string {
  const json = JSON.stringify(value, (_key, nested) => {
    if (typeof nested === "bigint") return nested.toString()
    return nested
  })
  if (json.length <= MAX_CONTEXT_CHARS) return json
  return `${json.slice(0, MAX_CONTEXT_CHARS)}...<truncated>`
}

function extractResponseText(response: DoctorAiResponse): string {
  const text = (response.content ?? [])
    .map((block) => (block.type === "text" || !block.type ? block.text ?? "" : ""))
    .join("\n")
    .trim()
  if (!text) throw new Error("Import Doctor returned an empty response")
  return text
}

export function coerceImportDoctorLocale(value: unknown): ImportDoctorLocale {
  return typeof value === "string" && LOCALES.has(value as ImportDoctorLocale)
    ? (value as ImportDoctorLocale)
    : "en"
}

export function parseImportDoctorRequestBody(
  body: unknown,
): { ok: true; payload: ImportDoctorRequestPayload } | { ok: false; error: string } {
  const record = asRecord(body)
  if (!record) return { ok: false, error: "Request body must be a JSON object" }
  const issueRecord = asRecord(record.issue)
  if (!issueRecord) return { ok: false, error: "issue must be an object" }
  const message = optionalString(issueRecord.message, 1_500)
  if (!message) return { ok: false, error: "issue.message is required" }
  const code = optionalString(issueRecord.code, 80) ?? "manual_review_required"
  const rawSeverity = issueRecord.severity
  const severity = SEVERITIES.has(rawSeverity as ImportDoctorIssueSeverity)
    ? (rawSeverity as ImportDoctorIssueSeverity)
    : "blocking"
  const location = asRecord(issueRecord.location) ?? undefined
  const evidence = asRecord(issueRecord.evidence) ?? undefined
  return {
    ok: true,
    payload: {
      locale: coerceImportDoctorLocale(record.locale),
      issue: { code, severity, message, location, evidence },
      context: record.context ?? {},
    },
  }
}

export function buildImportDoctorUserMessage(
  payload: ImportDoctorRequestPayload,
): string {
  return [
    `Locale: ${payload.locale}`,
    "Issue and preview context JSON:",
    stringifyForPrompt({
      issue: payload.issue,
      context: payload.context,
      promptVersion: IMPORT_DOCTOR_PROMPT_VERSION,
    }),
  ].join("\n")
}

export function validateImportDoctorExplanation(
  raw: unknown,
): ImportDoctorExplanation {
  const record = asRecord(raw)
  if (!record) throw new Error("Import Doctor explanation must be an object")
  return {
    title: requiredString(record, "title", 180),
    plainExplanation: requiredString(record, "plainExplanation", 1_200),
    whyBlocked: requiredString(record, "whyBlocked", 1_000),
    whatToCheck: stringArray(record.whatToCheck, "whatToCheck"),
    safeNextStep: requiredString(record, "safeNextStep", 800),
    needsReimport: record.needsReimport === true,
  }
}

export function validateImportDoctorFixProposal(
  raw: unknown,
): ImportDoctorFixProposal {
  const envelope = asRecord(raw)
  if (!envelope) throw new Error("Import Doctor fix must be an object")
  const record = asRecord(envelope.proposal) ?? envelope
  const kind = record.kind
  const title = requiredString(record, "title", 180)
  const rationale = requiredString(record, "rationale", 1_000)
  const confidence = number01(record.confidence, 0)

  if (kind === "manual_review") {
    return {
      kind,
      executable: false,
      title,
      rationale,
      confidence,
      risk: "high",
      manualSteps: stringArray(record.manualSteps, "manualSteps"),
      requiresPreviewRerun: false,
    }
  }

  const risk = riskLowMedium(record.risk)
  const patch = asRecord(record.patch)
  if (!patch) throw new Error("Executable Import Doctor fix needs patch")

  if (kind === "sheet_fix") {
    const filename = requiredString(patch, "filename", 240)
    const sheetName = requiredString(patch, "sheetName", 240)
    const entityCode = optionalString(patch.entityCode, 80)
    const planKind =
      patch.planKind === "actual" || patch.planKind === "budget"
        ? patch.planKind
        : undefined
    const role =
      patch.role === "source" || patch.role === "derived_summary"
        ? patch.role
        : undefined
    if (!entityCode && !planKind && !role) {
      throw new Error("sheet_fix must change entityCode, planKind, or role")
    }
    return {
      kind,
      executable: true,
      title,
      rationale,
      confidence,
      risk,
      patch: {
        filename,
        sheetName,
        ...(entityCode ? { entityCode } : {}),
        ...(planKind ? { planKind } : {}),
        ...(role ? { role } : {}),
      },
      requiresPreviewRerun: true,
    }
  }

  if (kind === "coa_mapping") {
    const filename = requiredString(patch, "filename", 240)
    const sheetName = requiredString(patch, "sheetName", 240)
    const sourceLabel = requiredString(patch, "sourceLabel", 300)
    const action = patch.action === "skip" ? "skip" : "map"
    const targetCode =
      action === "skip" ? null : requiredString(patch, "targetCode", 120)
    return {
      kind,
      executable: true,
      title,
      rationale,
      confidence,
      risk,
      patch: {
        filename,
        sheetName,
        sourceLabel,
        targetCode,
        confidence: number01(patch.confidence, confidence),
        action,
      },
      requiresPreviewRerun: true,
    }
  }

  if (kind === "conflict_resolution") {
    const key = requiredString(patch, "key", 500)
    const resolution = asRecord(patch.resolution)
    if (!resolution) {
      throw new Error("conflict_resolution requires resolution")
    }
    const mode = resolution.mode
    if (mode === "skip") {
      return {
        kind,
        executable: true,
        title,
        rationale,
        confidence,
        risk,
        patch: { key, resolution: { mode: "skip" } },
        requiresPreviewRerun: false,
      }
    }
    if (mode === "pick") {
      return {
        kind,
        executable: true,
        title,
        rationale,
        confidence,
        risk,
        patch: {
          key,
          resolution: {
            mode,
            filename: requiredString(resolution, "filename", 240),
          },
        },
        requiresPreviewRerun: false,
      }
    }
    throw new Error("conflict_resolution mode must be pick or skip")
  }

  throw new Error(`Unsupported Import Doctor fix kind: ${String(kind)}`)
}

export async function runImportDoctorExplanation(opts: {
  client: DoctorAiClient
  model: string
  payload: ImportDoctorRequestPayload
}): Promise<{
  explanation: ImportDoctorExplanation
  usage: { inputTokens: number; outputTokens: number }
  promptVersion: string
}> {
  const response = await opts.client.messages.create({
    model: opts.model,
    // 2026-07-30 — was 900, which truncated the reply mid-sentence on
    // production. Six prose fields in Azerbaijani/Russian cost far more
    // tokens per character than English; repairTruncatedJson salvages a cut
    // reply, but not running out in the first place is the actual fix.
    max_tokens: 2_000,
    temperature: 0,
    system: EXPLAIN_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildImportDoctorUserMessage(opts.payload),
      },
    ],
  })
  const { record, truncated } = parseJsonObject(extractResponseText(response))
  const explanation = validateImportDoctorExplanation(record)
  return {
    explanation: truncated
      ? { ...explanation, truncated: true as const }
      : explanation,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
    promptVersion: IMPORT_DOCTOR_PROMPT_VERSION,
  }
}

export async function runImportDoctorFixSuggestion(opts: {
  client: DoctorAiClient
  model: string
  payload: ImportDoctorRequestPayload
}): Promise<{
  proposal: ImportDoctorFixProposal
  usage: { inputTokens: number; outputTokens: number }
  promptVersion: string
}> {
  const response = await opts.client.messages.create({
    model: opts.model,
    // 2026-07-30 — raised with the explain cap, same reason.
    max_tokens: 2_200,
    temperature: 0,
    system: FIX_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildImportDoctorUserMessage(opts.payload),
      },
    ],
  })
  const proposal = validateImportDoctorFixProposal(
    parseJsonObject(extractResponseText(response)).record,
  )
  return {
    proposal,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
    promptVersion: IMPORT_DOCTOR_PROMPT_VERSION,
  }
}
