# Rate Limiting — current state + production recommendation (Phase 8 F2)

**Date:** 2026-05-29 · **Status:** recommendation (no platform access from here — apply on the VM/edge) · **Source:** 🔍 single-source (Perplexity → official `nginx.org` docs; Sonar was out of credits)

> Closes the advisory half of the G3 audit finding **F2** ("rate-limit coverage is partial — 25/143 routes"). This is the map for adding a blanket edge limit at deploy time; the per-route limiter stays as the app-layer backstop.

## 1. What exists today (app layer)

- **25 / 143** API routes call `enforceRateLimit(...)` (`src/lib/rate-limit.ts`) — the abuse-prone ones: import / AI / mutation-heavy endpoints. Read endpoints rely on auth + org-scope alone.
- The limiter is **in-memory** (`const buckets = new Map<...>()`, `src/lib/rate-limit.ts:15`). That means:
  - It is **per-process**. With >1 app instance/pod (horizontal scale), each holds its own buckets, so the effective limit is `N × configured`. The file already notes: *"For horizontal scaling, swap to a Redis-backed implementation."*
  - It resets on every deploy/restart.
- **Verdict:** fine for a single-instance localhost / single-VM deploy. For a public URL or multi-instance, add an edge limit (below) — it is the cheaper, instance-independent layer and protects the routes that have no per-route call.

## 2. Recommended: blanket edge rate-limit at nginx (this deploy's edge)

This deploy already terminates at nginx (`deploy/nginx/budgetpro.conf`), so nginx is the natural place for an IP-based blanket limit in front of `/api/`. nginx's `limit_req` is token-bucket, in-process to nginx (instance-independent of the app), and costs nothing extra.

### 2a. Declare the zone — in the `http {}` context

`limit_req_zone` **must** live in `http {}` (NOT `server`/`location`). `budgetpro.conf` is only the `server {}` block, so put this in the parent `nginx.conf` `http {}` or a `conf.d/*.conf` snippet that loads before it:

```nginx
# http {} context (nginx.conf or conf.d/ratelimit.conf)
# 10 MB zone holds ~160k unique IPs. rate = sustained average per IP.
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
# A second, stricter zone for auth/login brute-force protection.
limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=1r/s;
```

### 2b. Apply per location — in `budgetpro.conf`

Add `limit_req` inside the existing `location /api/ { ... }` block (and a tighter one on the NextAuth login path). `limit_req` is valid in `server`/`location`:

```nginx
# inside `location /api/ { ... }` — alongside the auth_request gate
limit_req zone=api_limit burst=20 nodelay;
limit_req_status 429;   # default is 503; 429 = "Too Many Requests" is correct

# tighter limit on the login/credential endpoints (brute-force defense)
location ^~ /api/auth/ {
    limit_req zone=auth_limit burst=5 nodelay;
    limit_req_status 429;
    # ... existing proxy_pass block ...
}
```

**Semantics** (per nginx.org): `rate=10r/s` is the sustained per-IP average; `burst=20` queues up to 20 excess requests; `nodelay` serves that burst immediately (instead of delaying to the rate) and rejects only what exceeds the burst. So a client gets ~10 req/s sustained, can spike to 20, and excess gets a `429`.

### 2c. CRITICAL if a CDN/LB sits in front of nginx (Cloudflare etc.)

If anything proxies INTO nginx, `$binary_remote_addr` becomes the **CDN's** IP, so every client shares one bucket and the limit is useless (or it rate-limits the CDN as a whole). Fix with `ngx_http_realip_module` so nginx resolves the true client IP **before** `limit_req` evaluates:

```nginx
# http {} or server {} — list the trusted proxy ranges (e.g. Cloudflare's)
set_real_ip_from 173.245.48.0/20;   # ... all CF ranges, or your LB subnet
real_ip_header   X-Forwarded-For;
real_ip_recursive on;
```

If nginx is the true edge (no CDN in front — the current `budgetpro.conf` assumption), `$binary_remote_addr` is already the client IP and this is not needed.

### 2d. When TLS is enabled

`budgetpro.conf` has an HTTPS server block to uncomment later. Mirror the `limit_req` lines into the HTTPS `/api/` + `/api/auth/` locations too (same note as the F3 auth blocks), or the limit is lost over TLS.

## 3. Platform alternatives (if NOT deployed behind our nginx)

- **Vercel:** nginx `limit_req` does not apply. Use Vercel's WAF / [Firewall rate-limiting rules](https://vercel.com/docs/security) (dashboard-configured, per-path), or `@upstash/ratelimit` + Vercel KV in `middleware` — but note this stack's Next middleware is non-viable (see `docs/AUTH_GATE_AUDIT.md` F3), so prefer the platform WAF.
- **Cloudflare (in front of any origin):** Cloudflare Rate Limiting Rules (dashboard) — the simplest blanket limit; configure a rule on `/api/*` with a threshold + a 429/challenge action.

## 4. Suggested starting thresholds (tune from real traffic)

| Surface | Zone rate | burst | Rationale |
|---|---|---|---|
| `/api/*` (general) | 10 r/s per IP | 20 | Generous for a logged-in analyst clicking around; sheds scrapers/bots. |
| `/api/auth/*` (login/csrf) | 1 r/s per IP | 5 | Brute-force defense; humans log in rarely. |
| import / AI routes | (keep per-route `enforceRateLimit`) | — | These are already app-gated with stricter per-org/hour caps; the edge limit is an additional outer bound. |

Start loose, watch the nginx `error.log` for `limiting requests` lines, tighten if abuse appears. Over-tight limits break the SPA (which fans out many `/api` calls per page).

## 5. Apply + verify (on the VM — cannot be tested from the dev box)

1. Add the `limit_req_zone` lines to `http {}`; add `limit_req` to the `/api/` + `/api/auth/` locations in `budgetpro.conf`.
2. `nginx -t` (syntax check) — `limit_req_zone` in the wrong context is the #1 mistake; this catches it.
3. Reload: `nginx -s reload` (or restart the nginx container).
4. Smoke test: `for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} " https://<host>/api/companies; done` — should show `200`s then `429`s once the burst is exhausted.
5. Confirm a normal browser session is unaffected (the SPA's per-page `/api` fan-out stays under the burst).

## 6. Decision: app-layer Redis limiter (optional, later)

If you scale the app to >1 instance AND want the per-route `enforceRateLimit` caps to be globally accurate (not per-process), swap `src/lib/rate-limit.ts`'s `Map` for a Redis-backed store (the same Redis already wired for BullMQ — `REDIS_URL`). Not needed while single-instance; the edge limit above covers the blanket case regardless of instance count.
