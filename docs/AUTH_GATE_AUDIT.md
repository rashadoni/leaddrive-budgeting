# API Auth-Gate Audit (Phase 8 G3)

**Date:** 2026-05-29 · **Scope:** all `src/app/api/**/route.ts` handlers · **Type:** read-only audit (no code changed) · **Total routes:** 143

> Closes the read-only half of ROADMAP §Group G **G3** ("51 routes without visible auth gate audit — deferred"). The "51" figure was a **grep over-count** — it flagged every route that doesn't literally call `requireRole`, which swept in the ~28 routes that are session-gated via `getOrgId` (a different, equally-valid helper) plus the deprecated/auth-provider/SSE routes. After per-route + per-method verification, **no data-accessing endpoint is unauthenticated.** Production *hardening* (rate-limit coverage, the one SSE gate) is still deferred per the 2026-05-27 localhost-only direction; this document is the prerequisite map for that work.

## Method

1. Enumerated all 143 `route.ts` files.
2. There is **no `middleware.ts`** — so auth is enforced **per-handler**, not globally. Every handler must gate itself.
3. Classified each by its gate mechanism, then **verified per-method** (a file could gate `GET` but not `POST`): flagged any file where `#exported-methods > #gate-invocations`. Only 2 files flagged — both confirmed safe below.
4. For the 3 routes with no gate symbol, read each in full to confirm intent.

## Gate taxonomy

| Mechanism | What it enforces | Count |
|---|---|---|
| `requireRole(req, role)` | authenticated **+ role ≥ X** (admin/manager/editor/viewer), 401/403 | **70** files |
| `requireAuth` / `getSession` | authenticated (any role), 401 | remainder |
| `getOrgId(req)` + `if (!orgId) → 401` | authenticated **+ org-scoped** (no role floor — correct for org-member reads) | **28** files |
| `withOrgScope(...)` | Postgres RLS tenant isolation, layered **on top of** a gate above | **16** files |
| `enforceRateLimit(...)` | abuse throttle, layered on top | **25** files |
| **none** | — | **3** files (analyzed below) |

`getOrgId` → `getSession` → NextAuth `auth()`: it returns `null` whenever there is no authenticated session carrying **both** a non-empty `organizationId` and `userId` (see `src/lib/api-auth.ts:12-49`). It does **not** read a client-supplied `x-organization-id` header, so it is **not** spoofable. All 28 `getOrgId` routes were verified to bail (401/empty) on a null org before any DB access.

## The 3 routes with no gate — all intentional / safe

| Route | Method | Verdict |
|---|---|---|
| `auth/[...nextauth]/route.ts` | (NextAuth `handlers`) | **Intentional** — this *is* the authentication provider endpoint; it must be public. |
| `budgeting/sales-forecast/import/route.ts` | POST | **Safe** — deprecated tombstone. Returns `410 Gone` with `Sunset`/`Deprecation` headers and **touches no data** (`_req` is unused by design). Superseded by `POST /api/import/ai-auto-multi`. |
| `terminal/stream/route.ts` | GET (SSE) | **Safe today, must gate before go-live** — see finding F1. Currently an "architectural skeleton" that emits only `connected` + `heartbeat` timestamps; **no DB query, no org-scoped data**. So an unauthenticated client learns nothing. |

## Findings

### F1 — ✅ RESOLVED 2026-05-29 — `terminal/stream` SSE gated
Shipped: added a `getOrgId` gate at the top of `GET` (`src/app/api/terminal/stream/route.ts`) — resolves the NextAuth session from request cookies (the authed terminal already connects with them), 401 when absent. Closes the anonymous open-connection surface now and future-proofs the line-35 real-events hookup against cross-tenant leakage. tsc 0. *(Original finding retained below for context.)*

### F1 (original) — `terminal/stream` must gate before it streams real events
`src/app/api/terminal/stream/route.ts:35` carries a TODO to "hook into your background job queue (BullMQ) / Redis Pub/Sub to listen for `indicator_computed` events." **The moment real org-scoped events are wired in, this ungated SSE becomes a cross-tenant leak** (any unauthenticated client could subscribe to every org's recompute events). It is safe *only* because it is a no-data heartbeat right now.
- **Fix (when wiring real events):** add `const orgId = await getOrgId(request as NextRequest); if (!orgId) return new Response('Unauthorized', { status: 401 })` at the top of `GET`, and filter pushed events to that `orgId`. Cheap (~5 lines), but MUST land in the same change that adds real event content.
- **Secondary (lower):** even as a heartbeat, an unauthenticated client can hold open SSE connections (a mild resource/DoS surface). A gate closes that too.

### F2 (advisory) — rate-limit coverage is partial by design
Only 25/143 routes call `enforceRateLimit` (the import / AI / mutation-heavy ones). Read endpoints rely on auth + org-scope alone. Acceptable for localhost; for production behind a public URL, consider a blanket edge rate-limit (Vercel/Cloudflare) rather than per-route calls.

### F3 (advisory — no global middleware) — defence-in-depth attempted 2026-05-29, deferred to the prod deploy
Auth is per-handler. This is **safe** (verified: every data method gates) but **fragile** — a future route author who forgets a gate has no safety net. A `middleware.ts` over `/api/:path*` would make the gate an enforced invariant.

**Attempted + reverted 2026-05-29 (empirical finding — recorded so the next attempt doesn't repeat it):** I wrote a custom edge middleware using `getToken` from `next-auth/jwt` (the "escape hatch" — avoids importing the Node-only Prisma/bcrypt auth config), whitelisting `/api/auth` + `/api/telemetry/guide-view`, gating everything else. The **gate worked** (anon `/api/budgeting/*` → 401) BUT it **broke NextAuth's own `/api/auth/*` endpoints (200 → 404)** despite the explicit whitelist + `NextResponse.next()`. This is the known Auth.js v5 behaviour: a custom non-`auth`-wrapper middleware interferes with the auth catch-all's resolution. Reverted (auth is more important than defence-in-depth; the audit already proved 0 real holes).

**Correct approach for the actual prod deploy (do NOT use the bare `getToken` middleware):** the Auth.js v5 split-config pattern —
1. Extract an edge-safe `auth.config.ts` (providers list + `callbacks.authorized` + jwt/session opts, **no** PrismaAdapter, **no** bcrypt `authorize`).
2. `auth.ts` imports it and adds the adapter + the Credentials provider's bcrypt `authorize`.
3. `middleware.ts`: `export { auth as middleware } from "@/auth.config"` (the edge instance) + `matcher: ['/api/:path*']`, with the `authorized` callback whitelisting `/api/auth` + `/api/telemetry/guide-view`.
This is a deliberate refactor of the working login config on a **beta** NextAuth — must be done with a full e2e login pass (the `visual-baseline` spec logs in + loads the terminal end-to-end), on a freshly-restarted dev server, not bolted on blind. Note: this project's secret env is `NEXTAUTH_SECRET` (Auth.js v5 default is `AUTH_SECRET`) — pass it explicitly if the auto-lookup misses it.

## Conclusion

**No exposed-data API endpoint is unauthenticated.** All 140 data-accessing routes gate every method (role-gate or auth+org-gate, verified per-method); the 3 gate-free routes are the auth provider, a 410 tombstone, and a no-data heartbeat. The deferred "51 ungated routes" concern does **not** reflect a real exposure — it was a `requireRole`-only grep that missed the `getOrgId` session-gate.

**Production hardening checklist (this audit is the map):**
- [x] **F1** — `terminal/stream` SSE gated (`getOrgId`), shipped 2026-05-29.
- [ ] **F3** — `middleware.ts` `/api/:path*` defence-in-depth: use the Auth.js v5 **split-config** pattern (above), NOT the bare `getToken` middleware (proven to break `/api/auth/*`). Requires an edge-safe `auth.config.ts` refactor + full e2e login verification on a restarted dev server.
- [ ] **F2** — edge rate-limit at the platform layer (Vercel/Cloudflare).
- [ ] (G1) rotate the dev admin password (currently kept at `Admin123!` per user direction; rotation is a credential action — owner=user).
- [ ] (G2) wire Sentry once a DSN exists.
