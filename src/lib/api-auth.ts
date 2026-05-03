import { NextRequest, NextResponse } from "next/server"
import { auth } from "./auth"

interface AuthResult {
  orgId: string
  userId: string
  role: string
  email: string
  name: string
}

export async function getSession(req: NextRequest): Promise<AuthResult | null> {
  try {
    const session = await auth()
    if (!session?.user) return null
    // Treat an authenticated user without an organization as unauthenticated
    // for org-scoped endpoints — otherwise all such users would share an
    // implicit `organizationId = ""` scope.
    if (!session.user.organizationId) return null
    // Phase 7.G Turn O — same defensive shape as orgId: empty userId
    // (NextAuth session-callback misconfig leaving id unset) is treated
    // as unauthenticated. Closes the side-discovery from Turn-38-sub8
    // architect ⚠️: previously `userId: session.user.id || ""` allowed
    // empty-string userId to flow into 8 audit-emission sites where
    // `|| null` fallbacks mapped it to null at the audit-log layer.
    // Now both the empty-string flow AND those fallbacks are dead.
    //
    // Why empty `id` is reachable: `auth.ts:81` casts `token.sub as string`
    // (NextAuth's `JWT.sub` is typed as `string | undefined`). On a
    // corrupt-token edge or session-callback misconfig, this guard
    // catches the resulting empty string before it propagates.
    if (!session.user.id) return null

    return {
      orgId: session.user.organizationId,
      userId: session.user.id,
      role: session.user.role || "viewer",
      email: session.user.email || "",
      name: session.user.name || "",
    }
  } catch {
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
 * Role hierarchy used for plan write operations.
 *  - admin   — full control (organization owner)
 *  - manager — can edit/apply templates, create versions, but cannot delete org-level data
 *  - editor  — can edit lines/actuals, cannot touch plan structure
 *  - viewer  — read-only
 *
 * `viewer` is the default for users created without explicit role; deny by default.
 */
export type Role = "admin" | "manager" | "editor" | "viewer"

const ROLE_RANK: Record<string, number> = {
  admin: 40,
  manager: 30,
  editor: 20,
  viewer: 10,
}

/**
 * Check whether `role` has at least the privilege level of `minRole`.
 * Unknown roles are treated as lowest (deny).
 */
export function hasRole(role: string | undefined | null, minRole: Role): boolean {
  const r = ROLE_RANK[role ?? ""] ?? 0
  return r >= ROLE_RANK[minRole]
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
