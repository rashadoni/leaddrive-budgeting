import { NextRequest, NextResponse } from "next/server"
import { auth } from "./auth"
import { hasRole, type Role } from "./permissions"
import { getLogger } from "./log"

// Preserve the existing server-side import surface while keeping the pure
// hierarchy in a client-safe module for components such as Sidebar.
export { hasRole, type Role } from "./permissions"

interface AuthResult {
  orgId: string
  userId: string
  role: string
  email: string
  name: string
}

const log = getLogger("api-auth")

export async function getSession(req: NextRequest): Promise<AuthResult | null> {
  try {
    // Auth.js v5's documented App Router API is `auth(handler)`: it resolves
    // the signed cookie from the concrete request and exposes the validated
    // result as `request.auth`. Build the wrapper for this request instead of
    // relying on zero-argument `auth()`, whose implicit next/headers context
    // is not preserved in this nested helper under Next.js 16.
    const resolveRequestAuth = auth((request) =>
      NextResponse.json(request.auth ?? null),
    )
    if (typeof resolveRequestAuth !== "function") return null
    const response = await resolveRequestAuth(req, {
      params: Promise.resolve({}),
    })
    if (!(response instanceof Response)) return null
    const session = await response.json()
    if (!session?.user) return null
    // Treat an authenticated user without an organization as unauthenticated
    // for org-scoped endpoints — otherwise all such users would share an
    // implicit `organizationId = ""` scope.
    if (!session.user.organizationId) return null
    // Empty userId is treated as unauthenticated so it cannot flow into audit
    // records or org-scoped data access.
    if (!session.user.id) return null

    return {
      orgId: session.user.organizationId,
      userId: session.user.id,
      role: session.user.role || "viewer",
      email: session.user.email || "",
      name: session.user.name || "",
    }
  } catch (error) {
    log.error("Session resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function getOrgId(req: NextRequest): Promise<string | null> {
  const session = await getSession(req)
  return session?.orgId || null
}

export async function requireAuth(req: NextRequest): Promise<AuthResult | NextResponse> {
  const session = await getSession(req)
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return session
}

export function isAuthError(result: AuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse
}

/**
 * Guard for route handlers: resolves the session and rejects if the caller's
 * role is below `minRole`. Returns either the session or a ready-to-send 403/401 response.
 *
 * Usage:
 *   const session = await requireRole(req, "manager")
 *   if (session instanceof NextResponse) return session
 *   // use session.orgId, session.userId, ...
 */
export async function requireRole(
  req: NextRequest,
  minRole: Role,
): Promise<AuthResult | NextResponse> {
  const session = await getSession(req)
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!hasRole(session.role, minRole)) {
    return NextResponse.json(
      { error: `Forbidden — requires ${minRole} role or higher` },
      { status: 403 },
    )
  }
  return session
}
