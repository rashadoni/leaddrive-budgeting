import { getToken } from "next-auth/jwt"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Phase 8 G3 F3 (nginx variant) — lightweight session validator for nginx's
 * `auth_request` directive (see deploy/nginx/budgetpro.conf).
 *
 * Decode-only: `getToken` verifies the NextAuth session JWT in the request
 * cookies using the secret — NO database hit, NO jwt-callback refresh. Returns
 * 204 (no content) when a valid session exists, 401 when not. nginx treats the
 * 2xx as "allow, proxy the original request" and the 401 as "deny".
 *
 * Why this works where the Next.js middleware did NOT: this runs in the normal
 * Node route runtime, AFTER the proxy.ts layer + routing — not in the edge
 * middleware layer that wedges this stack (NextAuth v5-beta + proxy.ts +
 * Turbopack). See docs/AUTH_GATE_AUDIT.md F3.
 *
 * This is defence-in-depth: every /api route already self-gates (audit: 0
 * exposed endpoints). nginx using this just sheds unauthenticated traffic at
 * the edge before it reaches the app. Excluded from the gate (must stay
 * public): /api/auth/* (NextAuth) + /api/telemetry/guide-view (anon beacon) +
 * this endpoint itself (nginx marks it `internal`).
 *
 * Secret env is NEXTAUTH_SECRET here (Auth.js v5 default is AUTH_SECRET) — passed
 * explicitly so getToken verifies against the same key auth.ts signs with.
 */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  return new NextResponse(null, { status: token ? 204 : 401 })
}
