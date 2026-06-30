import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import {
  listAiImportTemplatesFromSettings,
  saveAiImportTemplate,
  type AiImportTemplateFileInput,
} from "@/lib/onboarding/ai-import/import-template-memory"
import type { SheetClassification } from "@/lib/onboarding/ai-import/sheet-classifier"
import type { WorkbookProfile } from "@/lib/onboarding/ai-import/workbook-profile"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function parseTemplateFiles(value: unknown): AiImportTemplateFileInput[] {
  if (!Array.isArray(value)) {
    throw new Error("files must be an array")
  }
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`files[${index}] must be an object`)
    const filename = typeof raw.filename === "string" ? raw.filename : null
    const workbookProfile = raw.workbookProfile
    const classifications = raw.classifications
    if (!filename) throw new Error(`files[${index}].filename is required`)
    if (!isRecord(workbookProfile)) {
      throw new Error(`files[${index}].workbookProfile is required`)
    }
    if (!Array.isArray(classifications) || classifications.length === 0) {
      throw new Error(`files[${index}].classifications is required`)
    }
    return {
      filename,
      workbookProfile: workbookProfile as unknown as WorkbookProfile,
      classifications: classifications as SheetClassification[],
    }
  })
}

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { ok: false, error: "No organization in session" },
      { status: 400 },
    )
  }

  const org = await prisma.organization.findUnique({
    where: { id: session.orgId },
    select: { settings: true },
  })
  return NextResponse.json({
    ok: true,
    templates: listAiImportTemplatesFromSettings(org?.settings),
  })
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { ok: false, error: "No organization in session" },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Body must be JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    )
  }
  if (!isRecord(body)) {
    return NextResponse.json(
      { ok: false, error: "Body must be an object" },
      { status: 400 },
    )
  }

  try {
    const files = parseTemplateFiles(body.files)
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : `AI import template (${files.map((f) => f.filename).join(", ")})`
    const templateId =
      typeof body.templateId === "string" && body.templateId.trim()
        ? body.templateId.trim()
        : undefined
    const template = await saveAiImportTemplate(prisma, session.orgId, {
      name,
      approvedBy: session.userId,
      files,
      templateId,
    })
    return NextResponse.json({ ok: true, template })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    )
  }
}
