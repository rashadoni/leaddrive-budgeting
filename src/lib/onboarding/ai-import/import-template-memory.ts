/**
 * Approved template memory for the multi-file AI Import flow.
 *
 * This stores workbook-level routing decisions after a reviewer accepts a GREEN
 * preview. Reuse is intentionally narrow: a template can only replace the AI
 * sheet classifier. Parsing, safety gates, reconciliation, and apply still run.
 *
 * Storage lives in Organization.settings.aiImportWorkbookTemplates to avoid a
 * migration while preserving versioned, org-scoped template history.
 */
import { createHash, randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import type { SheetClassification } from "./sheet-classifier"
import type { PlanKind, SheetRole } from "./sheet-routing"
import type { WorkbookProfile } from "./workbook-profile"

export const AI_IMPORT_TEMPLATE_SETTINGS_KEY = "aiImportWorkbookTemplates"

export interface AiImportTemplateSheetRule {
  sheetName: string
  dataType: SheetClassification["dataType"]
  planKind: PlanKind | null
  role: SheetRole
  entityCode: string | null
  entityCodeOverride?: string
  confidence: number
  reasoning: string
  planKindSignal?: SheetClassification["planKindSignal"]
  roleSignal?: SheetClassification["roleSignal"]
  /** Reserved for Task 4: semantic CoA mappings confirmed by review UI. */
  coaMappings?: Array<{
    sourceLabel: string
    targetCode: string
    confidence: number
  }>
  /** Reserved for future adapter-specific column-role review. */
  columnRoles?: Array<{
    sourceIndex: number
    role: string
    confidence: number
  }>
}

export interface AiImportTemplateFile {
  filename: string
  structureHash: string
  sheetCount: number
  workbookPlanHint: WorkbookProfile["workbookPlanHint"]
  sourceLikeSheets: number
  summaryLikeSheets: number
  sheetsWithBuColumns: number
  sheetsWithEliminations: number
  sheetRules: AiImportTemplateSheetRule[]
}

export interface AiImportTemplate {
  id: string
  structureHash: string
  version: number
  name: string
  approvedBy: string
  approvedAt: string
  updatedAt: string
  sourceFiles: string[]
  files: AiImportTemplateFile[]
  applyCount: number
  lastUsedAt?: string
}

export interface AiImportTemplateFileInput {
  filename: string
  workbookProfile: WorkbookProfile
  classifications: SheetClassification[]
}

export interface AiImportTemplateMatch {
  template: AiImportTemplate
  files: Array<{
    profileIndex: number
    templateFile: AiImportTemplateFile
    classifications: SheetClassification[]
  }>
}

type TemplateBook = Record<string, AiImportTemplate[]>

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 24)
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

function band(value: number, size: number): number {
  return Math.round(value / size) * size
}

export function computeWorkbookStructureHash(profile: WorkbookProfile): string {
  return hashPayload({
    sheetCount: profile.sheetCount,
    totalRowsBand: band(profile.totalRows, 25),
    totalColumnsBand: band(profile.totalColumns, 5),
    workbookPlanHint: profile.workbookPlanHint,
    sourceLikeSheets: profile.sourceLikeSheets,
    summaryLikeSheets: profile.summaryLikeSheets,
    monthLikeSheets: profile.monthLikeSheets,
    sheetsWithBuColumns: profile.sheetsWithBuColumns,
    sheetsWithEliminations: profile.sheetsWithEliminations,
    sheets: profile.sheets.map((s) => ({
      sheetName: normalizeName(s.sheetName),
      rowsBand: band(s.totalRows, 25),
      colsBand: band(s.totalColumns, 5),
      headerRowIndex: s.headerRowIndex,
      roleHint: s.roleHint,
      planHint: s.planHint,
      monthHeaderCount: s.monthHeaderCount,
      buColumns: s.buColumns.map(normalizeName).sort(),
      codeLikeBand: band(s.codeLikeCells, 10),
      totalRowsBand: band(s.totalRowsCount, 5),
      subtotalRowsBand: band(s.subtotalRowsCount, 5),
      hasFormulaCells: s.formulaCells > 0,
      hasEliminations: s.eliminationSignals.length > 0,
      duplicateGroupId: s.duplicateGroupId,
    })),
  })
}

export function computeBatchStructureHash(fileHashes: readonly string[]): string {
  return hashPayload([...fileHashes].sort())
}

function bookOf(settings: unknown): TemplateBook {
  if (settings && typeof settings === "object") {
    const raw = (settings as Record<string, unknown>)[AI_IMPORT_TEMPLATE_SETTINGS_KEY]
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as TemplateBook
    }
  }
  return {}
}

export function listAiImportTemplatesFromSettings(
  settings: unknown,
): AiImportTemplate[] {
  return Object.values(bookOf(settings))
    .flat()
    .sort((a, b) => {
      const at = a.lastUsedAt ?? a.updatedAt
      const bt = b.lastUsedAt ?? b.updatedAt
      return bt.localeCompare(at)
    })
}

function latestTemplateVersions(settings: unknown): AiImportTemplate[] {
  const latestById = new Map<string, AiImportTemplate>()
  for (const template of listAiImportTemplatesFromSettings(settings)) {
    const prior = latestById.get(template.id)
    if (!prior || template.version > prior.version) {
      latestById.set(template.id, template)
    }
  }
  return [...latestById.values()]
}

function buildFileTemplate(input: AiImportTemplateFileInput): AiImportTemplateFile {
  const profile = input.workbookProfile
  const sheetNames = new Set(profile.sheets.map((s) => s.sheetName))
  const sheetRules = input.classifications
    .filter((c) => sheetNames.has(c.sheetName))
    .map((c): AiImportTemplateSheetRule => {
      const rule: AiImportTemplateSheetRule = {
        sheetName: c.sheetName,
        dataType: c.dataType,
        planKind: c.planKind ?? null,
        role: c.role ?? "source",
        entityCode: c.entityCode ?? null,
        confidence: Math.max(0, Math.min(1, c.confidence)),
        reasoning: c.reasoning,
      }
      if (c.entityCodeOverride) rule.entityCodeOverride = c.entityCodeOverride
      if (c.planKindSignal) rule.planKindSignal = c.planKindSignal
      if (c.roleSignal) rule.roleSignal = c.roleSignal
      return rule
    })

  return {
    filename: input.filename,
    structureHash: computeWorkbookStructureHash(profile),
    sheetCount: profile.sheetCount,
    workbookPlanHint: profile.workbookPlanHint,
    sourceLikeSheets: profile.sourceLikeSheets,
    summaryLikeSheets: profile.summaryLikeSheets,
    sheetsWithBuColumns: profile.sheetsWithBuColumns,
    sheetsWithEliminations: profile.sheetsWithEliminations,
    sheetRules,
  }
}

export function buildAiImportTemplateDraft(input: {
  name: string
  approvedBy: string
  files: readonly AiImportTemplateFileInput[]
  templateId?: string
}): Omit<AiImportTemplate, "version" | "approvedAt" | "updatedAt" | "applyCount" | "lastUsedAt"> {
  const files = input.files.map(buildFileTemplate)
  if (files.length === 0) {
    throw new Error("Cannot save an AI import template without files")
  }
  if (files.some((file) => file.sheetRules.length === 0)) {
    throw new Error("Cannot save an AI import template without sheet decisions")
  }
  const structureHash = computeBatchStructureHash(files.map((f) => f.structureHash))
  return {
    id: input.templateId ?? randomUUID(),
    structureHash,
    name: input.name.trim() || "AI import template",
    approvedBy: input.approvedBy,
    sourceFiles: files.map((f) => f.filename),
    files,
  }
}

export function upsertAiImportTemplateInSettings(
  settings: unknown,
  draft: Omit<AiImportTemplate, "version" | "approvedAt" | "updatedAt" | "applyCount" | "lastUsedAt">,
  approvedAtIso: string,
): { settings: Record<string, unknown>; template: AiImportTemplate } {
  const base =
    settings && typeof settings === "object"
      ? { ...(settings as Record<string, unknown>) }
      : {}
  const book: TemplateBook = { ...bookOf(settings) }
  const priorVersions = Object.values(book).flat().filter((t) => t.id === draft.id)
  const latestPrior = priorVersions.sort((a, b) => b.version - a.version)[0]
  const next: AiImportTemplate = {
    ...draft,
    version: (latestPrior?.version ?? 0) + 1,
    approvedAt: approvedAtIso,
    updatedAt: approvedAtIso,
    applyCount: latestPrior?.applyCount ?? 0,
    ...(latestPrior?.lastUsedAt ? { lastUsedAt: latestPrior.lastUsedAt } : {}),
  }
  book[draft.structureHash] = [...(book[draft.structureHash] ?? []), next]
  base[AI_IMPORT_TEMPLATE_SETTINGS_KEY] = book
  return { settings: base, template: next }
}

function classificationsFromTemplateFile(
  template: AiImportTemplate,
  file: AiImportTemplateFile,
  profile: WorkbookProfile,
): SheetClassification[] | null {
  const bySheet = new Map(file.sheetRules.map((rule) => [rule.sheetName, rule]))
  const classifications: SheetClassification[] = []
  for (const sheet of profile.sheets) {
    const rule = bySheet.get(sheet.sheetName)
    if (!rule) return null
    classifications.push({
      sheetName: sheet.sheetName,
      dataType: rule.dataType,
      entityCode: rule.entityCode,
      confidence: rule.confidence,
      reasoning: `Approved template "${template.name}" v${template.version}: ${rule.reasoning}`,
      planKind: rule.planKind,
      role: rule.role,
      planKindSignal: rule.planKindSignal ?? "config",
      roleSignal: rule.roleSignal ?? "config",
      ...(rule.entityCodeOverride
        ? { entityCodeOverride: rule.entityCodeOverride }
        : {}),
    })
  }
  return classifications
}

export function findMatchingAiImportTemplate(
  settings: unknown,
  profiles: readonly WorkbookProfile[],
): AiImportTemplateMatch | null {
  const profileHashes = profiles.map(computeWorkbookStructureHash)
  const batchHash = computeBatchStructureHash(profileHashes)
  const candidates = latestTemplateVersions(settings)
    .filter((template) => template.structureHash === batchHash)
    .sort((a, b) => b.version - a.version)

  for (const template of candidates) {
    const available = template.files.map((file, index) => ({ file, index, used: false }))
    const files: AiImportTemplateMatch["files"] = []
    let ok = true

    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
      const hash = profileHashes[profileIndex]
      const hit = available.find((candidate) => !candidate.used && candidate.file.structureHash === hash)
      if (!hit) {
        ok = false
        break
      }
      const classifications = classificationsFromTemplateFile(
        template,
        hit.file,
        profiles[profileIndex],
      )
      if (!classifications) {
        ok = false
        break
      }
      hit.used = true
      files.push({ profileIndex, templateFile: hit.file, classifications })
    }

    if (ok && files.length === profiles.length) {
      return { template, files }
    }
  }

  return null
}

export function markAiImportTemplateUsedInSettings(
  settings: unknown,
  templateId: string,
  usedAtIso: string,
): Record<string, unknown> {
  const base =
    settings && typeof settings === "object"
      ? { ...(settings as Record<string, unknown>) }
      : {}
  const book: TemplateBook = { ...bookOf(settings) }
  let best: { hash: string; index: number; template: AiImportTemplate } | null = null
  for (const [hash, versions] of Object.entries(book)) {
    for (let index = 0; index < versions.length; index++) {
      const template = versions[index]
      if (template.id !== templateId) continue
      if (!best || template.version > best.template.version) {
        best = { hash, index, template }
      }
    }
  }
  if (!best) return base
  const nextVersions = [...(book[best.hash] ?? [])]
  nextVersions[best.index] = {
    ...best.template,
    applyCount: best.template.applyCount + 1,
    lastUsedAt: usedAtIso,
    updatedAt: usedAtIso,
  }
  book[best.hash] = nextVersions
  base[AI_IMPORT_TEMPLATE_SETTINGS_KEY] = book
  return base
}

export async function saveAiImportTemplate(
  prisma: PrismaClient,
  organizationId: string,
  input: {
    name: string
    approvedBy: string
    files: readonly AiImportTemplateFileInput[]
    templateId?: string
  },
): Promise<AiImportTemplate> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  })
  if (!org) throw new Error("Organization not found")
  const draft = buildAiImportTemplateDraft(input)
  const { settings, template } = upsertAiImportTemplateInSettings(
    org.settings,
    draft,
    new Date().toISOString(),
  )
  await prisma.organization.update({
    where: { id: organizationId },
    data: { settings: settings as Prisma.InputJsonValue },
  })
  return template
}

export async function markAiImportTemplateUsed(
  prisma: PrismaClient,
  organizationId: string,
  templateId: string,
): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  })
  if (!org) return
  const settings = markAiImportTemplateUsedInSettings(
    org.settings,
    templateId,
    new Date().toISOString(),
  )
  await prisma.organization.update({
    where: { id: organizationId },
    data: { settings: settings as Prisma.InputJsonValue },
  })
}
