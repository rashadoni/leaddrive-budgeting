/**
 * Phase 7.K Phase 5a — Per-org API key management.
 *
 * GET /api/admin/api-keys
 *   Returns redacted view of currently-stored keys per source
 *   (eia / usda / gtrends). Never leaks the raw value.
 *
 * PATCH /api/admin/api-keys
 *   Body: `{ updates: { eia?: string|null, usda?: string|null, gtrends?: string|null } }`
 *   - String → set/replace that source's key
 *   - null / empty string → clear that source's key
 *   - Unknown source names → 400 error
 *   - Key shape validated (8-256 chars) before write
 *
 * Admin-only. Audit-logged via `api_key_update` action.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import {
  KNOWN_API_KEY_SOURCES,
  listApiKeys,
  setApiKeys,
  redactApiKey,
  type ApiKeySource,
} from "@/lib/intel/api-keys"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const raw = await listApiKeys(prisma, session.orgId)
  const redacted: Record<ApiKeySource, { configured: boolean; preview: string }> = {
    eia: { configured: !!raw.eia, preview: redactApiKey(raw.eia) },
    usda: { configured: !!raw.usda, preview: redactApiKey(raw.usda) },
    gtrends: { configured: !!raw.gtrends, preview: redactApiKey(raw.gtrends) },
  }
  return NextResponse.json({
    sources: KNOWN_API_KEY_SOURCES,
    keys: redacted,
    docs: {
      eia: {
        name: "EIA Energy v2",
        signupUrl: "https://www.eia.gov/opendata/register.php",
        notes: "Free, instant. One key per org. Drives BRENT / WTI / NATGAS feeds.",
      },
      usda: {
        name: "USDA NASS Quick Stats",
        signupUrl: "https://quickstats.nass.usda.gov/api",
        notes: "Free, email-verified. Drives BROILER / EGG / CHICK-PLACEMENT feeds (poultry sector).",
      },
      gtrends: {
        name: "Google Trends Proxy (SerpAPI / ScrapingDog)",
        signupUrl: "https://serpapi.com/users/sign_up",
        notes: "Paid (SerpAPI has free tier ~100 searches/mo). Drives AZ search-trend signals.",
      },
    },
  })
}

export async function PATCH(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const updates = ((body as { updates?: unknown })?.updates ?? {}) as Record<string, unknown>
  if (typeof updates !== "object" || updates === null) {
    return NextResponse.json(
      { error: "Body must have shape { updates: { source: keyOrNull } }" },
      { status: 400 },
    )
  }

  // Coerce updates to the typed shape (string | null per source).
  const typedUpdates: Partial<Record<ApiKeySource, string | null>> = {}
  for (const [k, v] of Object.entries(updates)) {
    if (!KNOWN_API_KEY_SOURCES.includes(k as ApiKeySource)) {
      return NextResponse.json(
        { error: `Unknown source "${k}". Allowed: ${KNOWN_API_KEY_SOURCES.join(", ")}` },
        { status: 400 },
      )
    }
    if (v === null || v === undefined) {
      typedUpdates[k as ApiKeySource] = null
    } else if (typeof v === "string") {
      typedUpdates[k as ApiKeySource] = v
    } else {
      return NextResponse.json(
        { error: `Source "${k}" value must be a string or null` },
        { status: 400 },
      )
    }
  }

  const result = await setApiKeys(prisma, session.orgId, typedUpdates)
  if (result.errors.length > 0) {
    return NextResponse.json(
      { error: "Validation errors", details: result.errors },
      { status: 400 },
    )
  }

  // Audit-log (never throws — soft-fails per audit/log contract).
  await logAuditEvent(prisma, {
    organizationId: session.orgId,
    actorUserId: session.userId,
    event: {
      action: "api_key_update",
      entityType: "Organization",
      entityId: session.orgId,
      metadata: {
        updated: result.updated,
        cleared: result.cleared,
      },
    },
    context: buildAuditContext({
      route: "/api/admin/api-keys",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  })

  return NextResponse.json({
    ok: true,
    updated: result.updated,
    cleared: result.cleared,
  })
}
