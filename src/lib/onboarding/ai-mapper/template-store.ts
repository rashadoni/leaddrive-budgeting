/**
 * Approved-template memory — Phase B (2026-06-20). "Learn each format once."
 *
 * When a human approves an import, we persist the APPROVED mapping keyed by the
 * file's structure-hash (a fingerprint of its column/header shape — see
 * structure-hash.ts). The next file of the same shape can be pre-filled from
 * the approved template instead of re-running the LLM, and — crucially —
 * commit still goes through the Phase-A validation engine (reuse is gated on
 * validation passing, NOT on a hash match alone; Codex review 2026-06-20).
 *
 * Storage: `Organization.settings.importTemplates` (JSON), keyed by hash, with
 * an array of versions per hash (never mutate in place — a re-approval appends
 * a new version; the latest is used). This mirrors the existing config-in-
 * settings pattern (importConfig, intelFreshnessSources) and avoids a schema
 * migration; graduating to a dedicated `ImportTemplate` table is a future step
 * if cross-org queries / richer invalidation are needed.
 *
 * The pure merge/read helpers are unit-tested; the DB wrappers are thin.
 */
import { Prisma, type PrismaClient } from "@prisma/client"
import type { MappingProposal } from "./types"

/** The mapping a template carries — the parts that define how to parse the
 *  sheet (column roles + per-code accountType overrides). */
export type TemplateMapping = Pick<MappingProposal, "columns" | "accountTypeOverrides">

export interface ApprovedTemplate {
  structureHash: string
  sheetName: string
  mapping: TemplateMapping
  approvedBy: string
  approvedAt: string // ISO
  version: number
  sourceFile: string
}

type TemplateBook = Record<string, ApprovedTemplate[]>

const KEY = "importTemplates"

/** Read the template book out of an Organization.settings JSON blob. */
function bookOf(settings: unknown): TemplateBook {
  if (settings && typeof settings === "object" && KEY in settings) {
    const b = (settings as Record<string, unknown>)[KEY]
    if (b && typeof b === "object") return b as TemplateBook
  }
  return {}
}

/** PURE: latest approved template for a structure hash, or null. */
export function readTemplateFromSettings(
  settings: unknown,
  structureHash: string,
): ApprovedTemplate | null {
  const versions = bookOf(settings)[structureHash]
  if (!versions || versions.length === 0) return null
  return versions[versions.length - 1]
}

/** PURE: append a new approved-template version, returning the new settings
 *  object. Never mutates an existing version (audit-safe versioning). */
export function upsertTemplateInSettings(
  settings: unknown,
  t: Omit<ApprovedTemplate, "version" | "approvedAt">,
  approvedAtIso: string,
): Record<string, unknown> {
  const base =
    settings && typeof settings === "object"
      ? { ...(settings as Record<string, unknown>) }
      : {}
  const book: TemplateBook = { ...bookOf(settings) }
  const prior = book[t.structureHash] ?? []
  const next: ApprovedTemplate = {
    ...t,
    version: prior.length + 1,
    approvedAt: approvedAtIso,
  }
  book[t.structureHash] = [...prior, next]
  base[KEY] = book
  return base
}

/** DB: latest approved template for (org, structureHash), or null. */
export async function getApprovedTemplate(
  prisma: PrismaClient,
  organizationId: string,
  structureHash: string,
): Promise<ApprovedTemplate | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  })
  if (!org) return null
  return readTemplateFromSettings(org.settings, structureHash)
}

/** DB: persist an approved template (appends a version). Best-effort — a
 *  failure here must NOT fail the import that already committed; callers
 *  should `.catch()` and log. */
export async function saveApprovedTemplate(
  prisma: PrismaClient,
  organizationId: string,
  t: Omit<ApprovedTemplate, "version" | "approvedAt">,
): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  })
  if (!org) return
  const nextSettings = upsertTemplateInSettings(
    org.settings,
    t,
    new Date().toISOString(),
  )
  await prisma.organization.update({
    where: { id: organizationId },
    data: { settings: nextSettings as Prisma.InputJsonValue },
  })
}
