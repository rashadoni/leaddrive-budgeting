import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import {
  isEliminationLikeEntityValue,
  normalizeEntityAlias,
} from "@/lib/onboarding/ai-import/entity-alias-utils"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function aliasesFromSettings(settings: unknown): Record<string, string> {
  if (!isRecord(settings) || !isRecord(settings.entityAliases)) return {}
  const out: Record<string, string> = {}
  for (const [alias, code] of Object.entries(settings.entityAliases)) {
    if (typeof code !== "string") continue
    const normalized = normalizeEntityAlias(alias)
    if (normalized) out[normalized] = code
  }
  return out
}

function parseAliases(
  value: unknown,
  knownCodes: ReadonlySet<string>,
): { aliases: Record<string, string>; rejected: string[] } {
  if (!isRecord(value)) {
    throw new Error("aliases must be an object")
  }
  const aliases: Record<string, string> = {}
  const rejected: string[] = []
  for (const [rawAlias, rawCode] of Object.entries(value)) {
    const alias = normalizeEntityAlias(rawAlias)
    const code = typeof rawCode === "string" ? rawCode.trim() : ""
    if (!alias || !code) continue
    if (isEliminationLikeEntityValue(alias)) {
      rejected.push(`${alias}: elimination/consolidation aliases are skipped, not mapped`)
      continue
    }
    if (!knownCodes.has(code)) {
      rejected.push(`${alias}: target company ${code} is not active in this organization`)
      continue
    }
    aliases[alias] = code
  }
  return { aliases, rejected }
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

  // Stage 3 RLS — org settings + company list in one scope tx.
  const { org, companies } = await withOrgScope(session.orgId, async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: session.orgId },
      select: { settings: true },
    })
    const companies = await tx.company.findMany({
      where: { organizationId: session.orgId, status: { not: "archived" } },
      select: { code: true, name: true, level: true },
      orderBy: [{ level: "asc" }, { code: "asc" }],
    })
    return { org, companies }
  })

  return NextResponse.json({
    ok: true,
    aliases: aliasesFromSettings(org?.settings),
    companies,
  })
}

export async function PUT(request: NextRequest) {
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

  // Stage 3 RLS — org settings + company list in one scope tx.
  const { org, companies } = await withOrgScope(session.orgId, async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: session.orgId },
      select: { settings: true },
    })
    const companies = await tx.company.findMany({
      where: { organizationId: session.orgId, status: { not: "archived" } },
      select: { code: true, name: true, level: true },
      orderBy: [{ level: "asc" }, { code: "asc" }],
    })
    return { org, companies }
  })
  if (!org) {
    return NextResponse.json(
      { ok: false, error: "Organization not found" },
      { status: 404 },
    )
  }

  try {
    const knownCodes = new Set(companies.map((c) => c.code))
    const { aliases, rejected } = parseAliases(body.aliases, knownCodes)
    const currentSettings = isRecord(org.settings) ? org.settings : {}
    const nextSettings = {
      ...currentSettings,
      entityAliases: aliases,
    }
    await withOrgScope(session.orgId, (tx) =>
      tx.organization.update({
        where: { id: session.orgId },
        data: { settings: nextSettings as Prisma.InputJsonValue },
      }),
    )
    return NextResponse.json({
      ok: true,
      aliases,
      rejected,
      companies,
    })
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
