import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { checkRateLimit, type RateLimitConfig } from "@/lib/rate-limit"

const publicPaths = ["/login", "/api/auth"]

// Rate limit tiers for budget mutation endpoints.
// First matching rule wins. Keyed by org id so quota is per-tenant.
// Note: import-excel has its own stricter in-handler limit + file-size cap.
const RATE_RULES: Array<{ pattern: RegExp; methods: string[]; cfg: RateLimitConfig }> = [
  // Heavy operations — small bucket (5/min)
  {
    pattern: /^\/api\/budgeting\/(cash-flow\/generate|rolling\/auto-forecast|matrix-seed|templates\/seed|snapshot-actuals|sync-actuals|resolve-costs|reports\/export|plans\/[^/]+\/create-version|plans\/[^/]+\/apply-templates)(\/|$)/,
    methods: ["POST"],
    cfg: { name: "budget-heavy", windowMs: 60_000, max: 5 },
  },
  // Bulk destructive operations on plans (reset / deleteAll)
  {
    pattern: /^\/api\/budgeting\/plans(\/|$)/,
    methods: ["DELETE"],
    cfg: { name: "budget-plan-destroy", windowMs: 60_000, max: 5 },
  },
  // Normal CRUD — generous (120/min) to support bulk UI editing
  {
    pattern: /^\/api\/budgeting\//,
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    cfg: { name: "budget-crud", windowMs: 60_000, max: 120 },
  },
]

function matchRule(pathname: string, method: string) {
  for (const r of RATE_RULES) {
    if (r.methods.includes(method) && r.pattern.test(pathname)) return r
  }
  return null
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public paths
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    // Inject locale header
    const response = NextResponse.next()
    const locale = req.cookies.get("locale")?.value || "en"
    response.headers.set("x-locale", locale)
    return response
  }

  // Allow static files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next()
  }

  // Check authentication
  const session = await auth()
  if (!session?.user) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Per-org rate limit for mutation endpoints
  const rule = matchRule(pathname, req.method)
  if (rule) {
    const orgId = (session.user as any).organizationId || "unknown"
    const result = checkRateLimit(orgId, rule.cfg)
    if (!result.ok) {
      return NextResponse.json(
        {
          error: "Too many requests",
          message: `Rate limit exceeded. Retry in ${result.retryAfterSec}s.`,
          retryAfterSec: result.retryAfterSec,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(result.retryAfterSec),
            "X-RateLimit-Limit": String(rule.cfg.max),
            "X-RateLimit-Remaining": "0",
          },
        },
      )
    }
  }

  // Inject org context + locale
  const response = NextResponse.next()
  response.headers.set("x-organization-id", (session.user as any).organizationId || "")
  const locale = req.cookies.get("locale")?.value || "en"
  response.headers.set("x-locale", locale)

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|wallpapers).*)"],
}
