import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { auth, handlers } from "./auth"
import { prismaAdmin } from "./db/prisma-admin"
import { isSessionVersionCurrent } from "./auth/session-version"
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

function toAuthResult(user: Record<string, unknown>): AuthResult | null {
  if (typeof user.organizationId !== "string" || !user.organizationId) return null
  if (typeof user.id !== "string" || !user.id) return null

  return {
    orgId: user.organizationId,
    userId: user.id,
    role: typeof user.role === "string" ? user.role : "viewer",
    email: typeof user.email === "string" ? user.email : "",
    name: typeof user.name === "string" ? user.name : "",
  }
}

function sessionCookieName(cookieHeader: string): string | null {
  const names = cookieHeader.split(";").map((part) => part.trim().split("=", 1)[0])
  const secure = "__Secure-authjs.session-token"
  const plain = "authjs.session-token"
  if (names.some((name) => name === secure || name.startsWith(`${secure}.`))) return secure
  if (names.some((name) => name === plain || name.startsWith(`${plain}.`))) return plain
  return null
}

async function getSessionWithoutRecognizedCookie(
  req: NextRequest,
): Promise<AuthResult | null> {
  try {
    // This path primarily preserves Auth.js-compatible non-cookie callers and
    // the shared route-test harness. Production browser requests carrying an
    // Auth.js session cookie never enter it; they use the explicit decoder
    // below, which avoids the Next.js 16 nested-wrapper cookie loss.
    const resolveRequestAuth = auth((request) =>
      NextResponse.json(request.auth ?? null),
    )
    if (typeof resolveRequestAuth !== "function") return null
    const response = await resolveRequestAuth(req, {
      params: Promise.resolve({}),
    })
    // Next.js can bundle Auth.js with a different Web Response realm. An
    // `instanceof Response` check then rejects a perfectly valid response in
    // production even though its body is readable. Check the contract rather
    // than constructor identity.
    if (!response || typeof response.json !== "function") return null
    const session = await response.json()
    if (!session?.user) return null
    return toAuthResult(session.user)
  } catch (error) {
    log.error("Cookieless Auth.js session resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function getSessionFromAuthRoute(
  req: NextRequest,
): Promise<AuthResult | null> {
  try {
    const configuredOrigin = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
    if (!configuredOrigin) return null
    const endpoint = new URL("/api/auth/session", configuredOrigin)
    if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") return null

    // Call the exact Auth.js route handler that powers the proven public
    // `/api/auth/session` endpoint, but keep the fallback in-process: no
    // network loop, nginx dependency, Host-header trust, or recursive API call.
    const internalRequest = new NextRequest(endpoint, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
    })
    const response = await handlers.GET(internalRequest)
    if (!response || typeof response.json !== "function") return null
    if (typeof response.status === "number" && (response.status < 200 || response.status >= 300)) {
      return null
    }
    const session = await response.json()
    if (!session?.user) return null
    return toAuthResult(session.user)
  } catch (error) {
    log.error("Direct Auth.js session route resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function getSession(req: NextRequest): Promise<AuthResult | null> {
  try {
    const cookie = req.headers.get("cookie") ?? ""
    const cookieName = sessionCookieName(cookie)
    if (!cookieName) return getSessionWithoutRecognizedCookie(req)

    const wrappedSession = await getSessionWithoutRecognizedCookie(req)
    if (wrappedSession) return wrappedSession

    const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
    if (secret) {
      const token = await getToken({
        req,
        secret,
        cookieName,
        secureCookie: cookieName.startsWith("__Secure-"),
      })
      if (token && typeof token.sub === "string" && token.sub) {
        const user = await prismaAdmin.user.findUnique({
          where: { id: token.sub },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            organizationId: true,
            isActive: true,
            authVersion: true,
          },
        })
        const tokenAuthVersion =
          typeof token.authVersion === "number" ? token.authVersion : undefined
        if (isSessionVersionCurrent(tokenAuthVersion, user) && user) {
          // The database is authoritative for current role and organization.
          return toAuthResult(user)
        }
      }
    }

    // Auth.js's own public session handler is the final authority when the
    // standalone bundle's JWT decoder is not byte-compatible with the issuer.
    // The origin is deployment configuration, never the request Host header.
    return getSessionFromAuthRoute(req)
  } catch (error) {
    log.error("Explicit-request token session resolution failed", {
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
