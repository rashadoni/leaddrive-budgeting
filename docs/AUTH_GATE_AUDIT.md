# API Auth-Gate Audit (Phase 8 G3)

**Date:** 2026-05-29 · **Scope:** all `src/app/api/**/route.ts` handlers · **Type:** read-only audit (no code changed) · **Total routes:** 143

> Closes the read-only half of ROADMAP §Group G **G3** ("51 routes without visible auth gate audit — deferred"). The "51" figure was a **grep over-count** — it flagged every route that doesn't literally call `requireRole`, which swept in the ~28 routes that are session-gated via `getOrgId` (a different, equally-valid helper) plus the deprecated/auth-provider/SSE routes. After per-route + per-method verification, **no data-accessing endpoint is unauthenticated.** Production *hardening* (rate-limit coverage, the one SSE gate) is still deferred per the 2026-05-27 localhost-only direction; this document is the prerequisite map for that work.

## Method

1. Enumerated all 143 `route.ts` files.
2. **Correction (2026-05-29):** an earlier draft said "there is no `middleware.ts`, so auth is per-handler only." That was a missed-file error. There is **no file literally named `middleware.ts`** because **Next.js 16 renamed the convention to `proxy.ts`** (function `middleware` → `proxy`; [official migration doc](https://nextjs.org/docs/messages/middleware-to-proxy)). `src/proxy.ts` **is** that middleware — it runs on every matched request in dev AND production (incl. `output: 'standalone'`, verified against the v16 docs) and **globally gates auth**: any non-public path with no session → `/api/*` gets JSON 401, pages redirect to `/login` (`src/proxy.ts:44-82`). So auth is enforced at **two** layers — the global `proxy.ts` gate AND per-handler gates. Per-handler remains the authoritative source of truth (Next 16 explicitly discourages relying on middleware/proxy for auth), with `proxy.ts` as the global defence-in-depth net. This was proved empirically: `deploy/smoke-test.sh` found `proxy.ts` 401-ing an anon request to the *public* `/api/telemetry/guide-view` (a route that does NOT self-gate) — that 401 could only have come from `proxy.ts`.
3. Classified each by its gate mechanism, then **verified per-method** (a file could gate `GET` but not `POST`): flagged any file where `#exported-methods > #gate-invocations`. Only 2 files flagged — both confirmed safe below.
4. For the 3 routes with no gate symbol, read each in full to confirm intent.

## Gate taxonomy

| Mechanism | What it enforces | Count |
|---|---|---|
| **`proxy.ts` (global)** | Next 16 middleware — EVERY non-public request hits it first; no session → 401 (`/api/*`) or redirect-to-`/login` (pages). The outer net over everything below. | all (global) |
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

### F3 — ✅ ALREADY SATISFIED — the global `/api` gate exists as `proxy.ts` (correction 2026-05-29)
**The earlier framing of F3 ("auth is per-handler only, no global gate, fragile") was wrong** — same missed-file error as Method #2. `src/proxy.ts` **is** the Next 16 middleware (renamed from `middleware.ts`), and it already gates every non-public `/api/*` with a 401 before any handler runs (`src/proxy.ts:44-82`). The "defence-in-depth global gate" F3 asked for **was already in place the whole time** — `proxy.ts` predates this audit. So auth is two-layered: global `proxy.ts` net + per-handler gates. (Next 16 *discourages* treating middleware/proxy as the auth source of truth, so the per-handler gates — verified 0-exposed — stay authoritative; `proxy.ts` is the net. That ordering is correct.)

**Why the two `middleware.ts` attempts failed — root cause, corrected:** NOT "NextAuth-beta × proxy × Turbopack interact badly." Simply: **Next 16 honors ONE middleware file, and it is `proxy.ts`.** Adding a second `src/middleware.ts` alongside the existing `proxy.ts` is the deprecated convention colliding with the current one — that is why both attempts broke. The earlier note even described `proxy.ts` as a mysterious "custom request layer (visible as `proxy.ts: Xms`)" — it was the middleware all along. The fix was never to add a file.

<details><summary>Empirical attempt record (retained — do not re-try adding a middleware.ts)</summary>

- **getToken edge middleware** (whitelist `/api/auth` + beacon, gate the rest): gate worked (anon `/api/budgeting/*` → 401) but broke `/api/auth/*` (200 → 404). Reverted.
- **split-config** (edge-safe `auth.config.ts` + `src/middleware.ts` with the `auth()` wrapper, matcher `"/api/((?!auth).*)"`): tsc clean but wedged the whole server (every request incl. `/login` → `000`). Reverted.

Both failed for the same reason now understood: a 2nd middleware file fighting `proxy.ts`. To extend the global gate, **edit `proxy.ts`** (its `publicPaths` + `auth()` block) — never add `middleware.ts`.
</details>

**nginx `auth_request` (shipped 2026-05-29) is a BONUS third layer, not a fix for a hole.** `src/app/api/_authcheck/route.ts` (decode-only validator → 204/401, no DB) + the `auth_request` blocks in `deploy/nginx/budgetpro.conf` shed unauthenticated `/api/*` traffic at the **edge**, before it reaches the app — useful for DoS reduction + perimeter defence-in-depth, but NOT required for the global-gate property (`proxy.ts` already provides that). Keep it; it layers cleanly. Verify on the VM with `nginx -t` + `deploy/smoke-test.sh` (the smoke test confirms the gates from outside).

## Conclusion

**No exposed-data API endpoint is unauthenticated.** All 140 data-accessing routes gate every method (role-gate or auth+org-gate, verified per-method); the 3 gate-free routes are the auth provider, a 410 tombstone, and a no-data heartbeat. The deferred "51 ungated routes" concern does **not** reflect a real exposure — it was a `requireRole`-only grep that missed the `getOrgId` session-gate. **And it is belt-and-braces:** `src/proxy.ts` (the Next 16 middleware) already imposes a global 401 on every non-public `/api/*` ahead of the per-handler gates — so a future route author who forgets a gate is still caught by the global net (though per-handler remains the verified source of truth).

**Production hardening checklist (this audit is the map):**
- [x] **F1** — `terminal/stream` SSE gated (`getOrgId`), shipped 2026-05-29.
- [x] **F3** — global defence-in-depth `/api` gate **already exists** as `src/proxy.ts` (the Next 16 middleware), confirmed 2026-05-29 + proven by `deploy/smoke-test.sh`. The two `middleware.ts` attempts failed only because Next 16 honors ONE middleware file (`proxy.ts`) — not a stack incompatibility (see F3 above). nginx `auth_request` shipped as a bonus edge layer. No further action — extend via `proxy.ts` if ever needed, never add `middleware.ts`.
- [~] **F2** — edge rate-limit. **Recommendation + ready nginx config documented 2026-05-29 in `docs/RATE_LIMITING.md`** (blanket `limit_req` on `/api/` + tighter on `/api/auth/`, real-IP handling for CDN, 429 override, thresholds, verify steps). Apply on the VM/edge at deploy time — cannot be tested from the dev box. The per-route `enforceRateLimit` (25 routes) remains the app-layer backstop.
- [ ] (G1) rotate the dev admin password (currently kept at `Admin123!` per user direction; rotation is a credential action — owner=user).
- [x] **G2** — Sentry wired DSN-ready 2026-05-29 (`@sentry/nextjs` 10.55.0; instrumentation + global-error + DSN-gated `withSentryConfig`). Inert until `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` is set — then it activates with no code change. Set the DSN(s) per `.env.production.example`.
