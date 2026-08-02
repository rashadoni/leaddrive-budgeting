import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/permissions"
import { checkRateLimit, type RateLimitConfig } from "@/lib/rate-limit"
import { LOCALE_COOKIE_NAME } from "@/i18n/routing"

// Phase 8 2026-05-29 — `/api/telemetry/guide-view` added: the F2 /guide
// view-beacon is PUBLIC by design (its handler reads the session via
// getSession().catch(()=>null) and logs anon views with org/user = null —
// that's the whole point, "anonymous /guide traffic counts surface"). It was
// missing here, so proxy.ts `auth()`-gated it → every anon beacon got 401 and
// no anon view was ever recorded, in dev AND prod (nginx F3 whitelists it at
// the edge, but this layer runs behind nginx and still 401'd it). Caught by
// deploy/smoke-test.sh. The route is rate-limited (10/min/IP) and writes only
// a telemetry row — no data exposure. Mirrors the nginx public exception +
// docs/AUTH_GATE_AUDIT.md.
// R4 (2026-07-07): /api/cron/* is session-less by design — every cron
// route enforces its own `Authorization: Bearer $CRON_SECRET` gate
// (503 when unconfigured, 401 on mismatch), so the middleware must let
// the VM crontab curl through. Without this the trade-digest cron was
// 401'd HERE before its own auth ever ran.
const publicPaths = ["/login", "/api/auth", "/api/telemetry/guide-view", "/api/cron"]

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

/**
 * Phase 12 / A05 (2026-08-02) — a write floor, enforced centrally.
 *
 * The audit that prompted this: 42 of 117 mutating API routes call no
 * `requireRole` at all. That is NOT "unauthenticated" — this proxy already
 * 401s every `/api/*` outside `publicPaths`, and the RATE_RULES above are
 * rate limits, not authorization, which is easy to misread as RBAC because
 * they are keyed on the same paths. It does mean any logged-in user could
 * write: a `viewer` — the role whose entire purpose is read-only — could POST
 * budget lines, PUT and DELETE saved reports and templates, seed templates,
 * edit the chart of accounts, remove integrations and patch approval
 * requests.
 *
 * Exposure today is nil: production has one user and they are an admin. Same
 * shape as the RLS gap found the same day — a fact about the data, not about
 * the control — and the product ships a role-management UI, so it expires the
 * first time someone is invited as a viewer.
 *
 * Fixed HERE rather than by editing 42 handlers, for two reasons. One
 * central floor cannot be forgotten by the forty-third route, and picking a
 * specific minimum role for each of 42 endpoints is forty-two guesses about
 * someone else's business rules; a floor of `editor` is the one claim that
 * needs no guessing — a viewer does not write. Handlers that already demand
 * `manager` or `admin` keep doing so; this only raises the base.
 *
 * The exemptions are writes a viewer legitimately performs on their OWN
 * workspace, not on the business's books.
 */
const VIEWER_WRITABLE = [
  // A viewer arranging their own terminal panels. Stored per user.
  /^\/api\/terminal\/layouts(\/|$)/,
  // Pin / dismiss an intel card for oneself.
  /^\/api\/intel\/[^/]+\/(pin|dismiss)(\/|$)/,
  // Anonymous guide telemetry is already in publicPaths and never reaches
  // here; listed so a future tightening of publicPaths does not silently
  // start 403ing the beacon.
  /^\/api\/telemetry\//,
]

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/** True when this request must be refused for lacking write privilege. */
function belowWriteFloor(pathname: string, method: string, role: string | undefined): boolean {
  if (!MUTATING_METHODS.has(method)) return false
  if (VIEWER_WRITABLE.some((re) => re.test(pathname))) return false
  return !hasRole(role, "editor")
}

function matchRule(pathname: string, method: string) {
  for (const r of RATE_RULES) {
    if (r.methods.includes(method) && r.pattern.test(pathname)) return r
  }
  return null
}

// Renamed from `middleware()` to `proxy()` for Next 16 file-convention
// transition (was `src/middleware.ts`). Same body, same matcher; only
// the file + function name changed per the migration.
// Migration doc: https://nextjs.org/docs/messages/middleware-to-proxy
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public paths
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    // Inject locale on REQUEST headers so `next-intl/server` `headers()`
    // (in `i18n/request.ts`) can read it during the server render.
    // Cookie name MUST match the LanguageSwitcher writer (`NEXT_LOCALE`).
    const locale = req.cookies.get(LOCALE_COOKIE_NAME)?.value || "en"
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set("x-locale", locale)
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
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
    // API routes must return JSON 401 — never redirect to the HTML login
    // page. If they redirect, fetch() follows to HTML (status 200) and
    // res.json() throws "Unexpected token '<', <!DOCTYPE ..." everywhere
    // in the terminal (MarketTicker, TodayBrief, VarianceExplainer, etc.)
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // A05 write floor — before the rate limiter, so a refused write does not
  // also consume the caller's quota.
  if (pathname.startsWith("/api/") && belowWriteFloor(pathname, req.method, session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden", message: "This action requires editor access or above." },
      { status: 403 },
    )
  }

  // Per-org rate limit for mutation endpoints
  const rule = matchRule(pathname, req.method)
  if (rule) {
    const orgId = session.user.organizationId || "unknown"
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

  // Inject org context + locale on REQUEST headers so server components
  // (including `next-intl/server` `headers()` in `i18n/request.ts`) can
  // read them during the render. Setting these on `response.headers`
  // (the previous bug) made them visible to the BROWSER but invisible
  // to the server-render — `useTranslations()` always saw the default
  // locale ("en") regardless of LanguageSwitcher selection.
  // Cookie name MUST match the LanguageSwitcher writer (`NEXT_LOCALE`).
  const locale = req.cookies.get(LOCALE_COOKIE_NAME)?.value || "en"
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-organization-id", session.user.organizationId || "")
  requestHeaders.set("x-locale", locale)

  return NextResponse.next({
    request: { headers: requestHeaders },
  })
}

// 2026-05-27 — added `_next/data` (RSC payload fetches) and `_next/webpack-hmr`
// / `_next/turbopack-hmr` (dev HMR streams) to the skip list. These never
// need auth() and previously paid the proxy.ts cost on every keystroke
// during hot reload, contributing to «локалка долго перезагружается».
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|_next/webpack-hmr|_next/turbopack-hmr|favicon.ico|wallpapers).*)",
  ],
}
