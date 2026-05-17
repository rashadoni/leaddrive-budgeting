/**
 * Phase 7.B v2 Day 5 — Revoke an AI Mapper template.
 *
 * DELETE /api/onboarding/ai-mapper/templates/<encoded-cache-key>
 *
 * `cacheKey` is the URI-encoded full key from `listTemplates()` output:
 *   `${orgId}:${structureHash}:${promptVersion}:${modelName}`
 *
 * The handler:
 *   1. URI-decodes the path segment.
 *   2. Parses the four parts.
 *   3. Verifies the cacheKey's `orgId` matches `session.orgId` —
 *      prevents an admin in org A from deleting org B's template via
 *      crafted URL (defense-in-depth alongside the lib function's own
 *      org scoping).
 *   4. Calls `deleteTemplate()` which removes from Prisma + in-memory
 *      fallback.
 *
 * Returns 200 `{ deleted: true }` on success, 404 when no such key.
 * Auth: `manager` role.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { deleteTemplate } from "@/lib/onboarding/ai-mapper/proposal-cache"

const RATE_LIMIT = { name: "ai-mapper-template-delete", max: 30, windowMs: 60_000 }

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ cacheKey: string }> },
) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const rateLimitError = enforceRateLimit(
    `${session.orgId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  const { cacheKey: encodedKey } = await params
  let cacheKey: string
  try {
    cacheKey = decodeURIComponent(encodedKey)
  } catch {
    return NextResponse.json(
      { error: "Malformed cacheKey (must be URI-encoded)" },
      { status: 400 },
    )
  }

  // Cross-tenant guard — first segment of the cacheKey is the orgId
  // that the template belongs to. Reject mismatch with 404 (not 403)
  // to avoid leaking the existence of templates in other orgs.
  const parts = cacheKey.split(":")
  if (parts.length !== 4) {
    return NextResponse.json(
      { error: "Invalid cacheKey shape (expected orgId:structureHash:promptVersion:modelName)" },
      { status: 400 },
    )
  }
  const [keyOrgId] = parts
  if (keyOrgId !== session.orgId) {
    // Don't reveal whether the template exists in another org.
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }

  const removed = await deleteTemplate(cacheKey)
  if (!removed) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }
  return NextResponse.json({ deleted: true })
}
