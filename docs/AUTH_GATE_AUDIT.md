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

### F1 (real — pre-production blocker) — `terminal/stream` must gate before it streams real events
`src/app/api/terminal/stream/route.ts:35` carries a TODO to "hook into your background job queue (BullMQ) / Redis Pub/Sub to listen for `indicator_computed` events." **The moment real org-scoped events are wired in, this ungated SSE becomes a cross-tenant leak** (any unauthenticated client could subscribe to every org's recompute events). It is safe *only* because it is a no-data heartbeat right now.
- **Fix (when wiring real events):** add `const orgId = await getOrgId(request as NextRequest); if (!orgId) return new Response('Unauthorized', { status: 401 })` at the top of `GET`, and filter pushed events to that `orgId`. Cheap (~5 lines), but MUST land in the same change that adds real event content.
- **Secondary (lower):** even as a heartbeat, an unauthenticated client can hold open SSE connections (a mild resource/DoS surface). A gate closes that too.

### F2 (advisory) — rate-limit coverage is partial by design
Only 25/143 routes call `enforceRateLimit` (the import / AI / mutation-heavy ones). Read endpoints rely on auth + org-scope alone. Acceptable for localhost; for production behind a public URL, consider a blanket edge rate-limit (Vercel/Cloudflare) rather than per-route calls.

### F3 (advisory) — no global middleware
Auth is per-handler. This is **safe** (verified: every data method gates) but **fragile** — a future route author who forgets to call a gate has no safety net. **Recommendation for production:** add a `middleware.ts` with a `matcher: ['/api/:path*']` that rejects unauthenticated requests as defence-in-depth, excluding `auth/[...nextauth]` (and any deliberately-public route). This converts "remember to gate every handler" from a convention into an enforced invariant.

## Conclusion

**No exposed-data API endpoint is unauthenticated.** All 140 data-accessing routes gate every method (role-gate or auth+org-gate, verified per-method); the 3 gate-free routes are the auth provider, a 410 tombstone, and a no-data heartbeat. The deferred "51 ungated routes" concern does **not** reflect a real exposure — it was a `requireRole`-only grep that missed the `getOrgId` session-gate.

**Production hardening checklist (deferred per user direction; this audit is the map):**
- [ ] **F1** — gate `terminal/stream` in the same PR that wires real SSE events (blocker).
- [ ] **F3** — add `middleware.ts` `/api/:path*` auth as defence-in-depth.
- [ ] **F2** — edge rate-limit at the platform layer.
- [ ] (G1) rotate the dev admin password.
- [ ] (G2) wire Sentry once a DSN exists.
