import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"
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
