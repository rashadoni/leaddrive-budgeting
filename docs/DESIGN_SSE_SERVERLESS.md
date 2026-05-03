# Design — SSE LISTEN/NOTIFY infrastructure for serverless deploy

**Status:** Draft (Phase 7.G Turn C, 2026-05-03). Recommendation given,
no code change yet — picks up when prod target shifts to Vercel/Lambda
OR multi-tenant SaaS launches.

**Decision class:** Architecture Decision Record (ADR). Picks the
infra-shape for real-time push notifications when the runtime model
changes.

**Audience:** Architect / SRE making the call before Vercel deploy
(or any serverless migration).

---

## 1. Context — what does the app do today?

The app pushes "something changed" events to connected browsers via
Server-Sent Events. Used by:

- AlertsPanel — refreshes when a new audit event lands (e.g. someone
  approves a budget plan elsewhere)
- HeatMap — refreshes when an `IndicatorValue` row updates (e.g.
  recompute pipeline finishes)
- Audit feed — live-updates new entries

The transport flow today (`src/lib/events/postgres-listener.ts` +
`src/app/api/events/stream/route.ts`):

```
Mutation (e.g. INSERT INTO audit_events)
  ↓
Postgres trigger (notify_audit_events_changed)
  ↓
pg_notify('audit_events_changed', json_payload)
  ↓
Long-lived pg.Client.LISTEN audit_events_changed
  (singleton in `app` Node process)
  ↓
listeners.forEach(...) → forward to all SSE handlers in same process
  ↓
Each SSE handler filters by orgId → ReadableStream.enqueue(event)
  ↓
Browser EventSource onmessage → React component refresh
```

Supporting facts:

- 1 Postgres `pg.Client` per Node process (singleton via
  `clientPromise` module-level promise)
- Module-level `Map<channel, Set<listener>>` registers per-handler
  callbacks
- `/api/events/stream` opens a `ReadableStream` per browser tab; on
  abort → unsubscribe + close
- Migrations: `20260427195305_sse_listen_notify_triggers` defines the
  pg_notify triggers
- Heartbeat every 25s to keep proxies/browsers from killing the idle
  connection
- Client reconnect: `use-event-stream.ts` hook with exponential backoff

---

## 2. Why it works on Docker Compose / single VM

The current production target (`deploy/README.md`) runs the Next.js app
as a single long-lived Node process per container.

| Property | Why it works |
|----------|--------------|
| Module-level singleton | Survives entire app lifetime (until container restart) |
| Long-lived `pg.Client` LISTEN | Connection held for hours/days; one Postgres connection total for ALL SSE clients |
| Multiple SSE handlers share connection | Each registers a closure into the module-level `listeners` Map; one LISTEN feeds N browser tabs |
| Reconnect on `client.on('error')` | `clientPromise = null` + lazy re-init on next subscribe — module survives Postgres restart blip |

Per-event cost: ~1 Postgres notification + N event-source forwards
(N = active browser tabs in same org). Resource use: 1 Postgres
connection + 1 file descriptor per browser tab.

**Operational ceiling on a single VM:** ~50-100 concurrent SSE clients
on a 4-core / 8GB Ubuntu VM. Beyond that, vertical-scale only (no
cluster mode in deploy/README.md target).

---

## 3. Why it breaks on Vercel serverless

Vercel deploys each Next.js route as an independent serverless function.
Two distinct breakage modes:

### 3a. Module-level singleton doesn't survive

Each function invocation starts in a (possibly fresh, possibly warm)
container. Module-level state — including `clientPromise` — does NOT
survive across invocations reliably:

- Cold start: fresh module init → new `pg.Client` → new LISTEN → connection lifetime = single function invocation duration (max 25s on Hobby, 300s on Pro)
- Warm start: module reused → `clientPromise` cached → BUT the underlying TCP connection may have been killed by Vercel's idle reaper (no docs guarantee on lifetime for the underlying socket pool)
- Concurrent invocations: each warm container has its own `clientPromise` — **N parallel SSE clients = N parallel LISTEN connections** to Postgres

Even if a single function stays warm for hours, 100 concurrent SSE
clients × 1 LISTEN per warm container = 100 Postgres connections.
Default `max_connections=100` is exhausted instantly. Vercel Postgres
("hobby" tier) caps at 60 concurrent.

### 3b. Function-execution time limits

The `ReadableStream` returned by `/api/events/stream` is an
indefinitely-long response. Vercel function-timeout caps:

- Hobby: 10s (free tier — useless for SSE)
- Pro: 60s default, 300s max
- Enterprise: 900s

After timeout, the function is killed mid-stream; client sees
disconnect; reconnect-loop hammers Vercel + Postgres. At 300s × 100
clients × 24h = ~28k function invocations/day per stream = real cost.

### 3c. Other serverless platforms

Same problems on AWS Lambda (15-min max), Cloudflare Workers (CPU-time
caps, no long-lived TCP), Netlify Functions (10s default). The SSE +
LISTEN pattern fundamentally assumes stateful long-lived runtime.

---

## 4. Options analyzed

Five candidates evaluated. Three are viable migrations (A, B, C); two
are non-migrations preserved for completeness (D, E).

### Option A — Redis pub/sub bridge

**Architecture:**
```
Postgres trigger → pg_notify
  ↓
Bridge worker (long-lived): LISTEN audit_events_changed
  → Redis PUBLISH "audit:org-<id>" payload
  ↓
Vercel function: SUBSCRIBE "audit:org-<id>"
  → forward to SSE client
  → on function timeout: client reconnects, RE-SUBSCRIBE
```

**What changes:**
- NEW long-lived "bridge worker" service (single small container or
  lightweight Render/Railway/Fly.io worker) that holds the Postgres
  LISTEN and republishes to Redis.
- `postgres-listener.ts` replaced with a `redis-subscriber.ts` that
  opens a per-request short-lived Redis subscription.
- Per-org Redis channels (`audit:org-<id>`) — server-side filtering
  becomes "subscribe to your org's channel" instead of "filter every
  payload by orgId".

**Infrastructure:**
- 1 small container running the bridge (~256MB RAM, ~0.1 vCPU)
- Redis instance (Upstash serverless ~$0.20/100k requests, or
  managed Redis ~$15/mo for 256MB)

**Strengths:**
- Vercel functions are stateless → no per-function state to manage
- Per-org channels → no payload-filter waste
- Redis pub/sub is well-understood + has rich client libs
- Bridge can run on a cheap always-on box (Fly.io, Render free tier)
- Scales horizontally — multiple Vercel functions can subscribe to
  same Redis channel without multiplying Postgres connections

**Weaknesses:**
- New infra component to monitor (the bridge)
- Bridge becomes a single-point-of-failure (mitigate: 2 bridges +
  health-check leader election, OR accept eventual reconnect on bridge
  restart)
- Adds ~10-50ms latency per event (Postgres → bridge → Redis → Vercel
  function → browser) vs ~1-5ms direct LISTEN
- Cost: ~$5-30/mo (bridge container + Redis tier)

**Effort estimate:** 2-3 days
- Day 1: bridge worker (Node script that LISTENs + PUBLISHes)
- Day 2: replace `postgres-listener.ts` with Redis subscriber
- Day 3: deploy + monitoring + per-org channel migration

### Option B — Dedicated long-lived Node service

**Architecture:**
```
Postgres trigger → pg_notify
  ↓
"Events broker" service (long-lived Node process):
  - Holds Postgres LISTEN
  - Exposes WebSocket OR SSE endpoint at /events/stream
  ↓
Browser connects DIRECTLY to broker (bypasses Vercel function for SSE)
```

**What changes:**
- NEW "events broker" service deployed separately (Fly.io, Render,
  small VM) — runs the SSE endpoint instead of Vercel.
- Vercel functions handle everything else (REST APIs, page renders).
- Browser opens 2 connections: REST → Vercel, SSE → broker domain.
- Auth: broker validates session token via Vercel REST (or shares
  NEXTAUTH_SECRET to verify JWTs locally).

**Infrastructure:**
- 1 small always-on container (~256MB RAM, ~0.25 vCPU for ~100 SSE
  clients)
- DNS subdomain for the broker (`events.budget.fo.az`)

**Strengths:**
- Architecturally cleanest — long-lived runtime IS the right place for
  long-lived connections
- No Redis needed (cuts one component)
- Lowest event latency (1 hop instead of 2)
- Bridge IS the SSE endpoint — no protocol conversion

**Weaknesses:**
- 2 services to deploy / monitor / version
- Auth coupling — broker needs Vercel session validation (or shared
  secret + JWT verify)
- CORS / cookie-domain setup for cross-subdomain auth (cookies have
  to be `domain=.budget.fo.az` to flow to events subdomain)
- Single-point-of-failure same as Option A bridge

**Effort estimate:** 3-4 days
- Day 1-2: broker service (auth + LISTEN + SSE endpoint)
- Day 3: client-side switch from `/api/events/stream` to broker URL
- Day 4: deploy + DNS + cookie-domain config

### Option C — Stay on long-lived runtime (Docker Compose / VM / Render web service)

**Architecture:** unchanged from today. App runs as a single Next.js
process per container; no Vercel migration.

**What changes:** nothing in code. Operationally:
- Keep Docker Compose deploy as the prod target indefinitely
- For HA: 2 VMs behind a load balancer (sticky sessions for SSE;
  events fan out from each VM independently — different connections see
  different latency but eventual consistency holds)

**Strengths:**
- Zero engineering effort
- All current operational knowledge applies
- Predictable cost (1 VM ≈ $20-50/mo on Hetzner / DigitalOcean)
- Single Postgres connection per VM — clean resource model

**Weaknesses:**
- No serverless cost-elasticity (paying for idle VM 24/7)
- Vertical-scale ceiling around 50-100 concurrent SSE clients per VM
- Manual VM ops (security patches, OS upgrades, backups)

**Effort estimate:** 0 days. This is the do-nothing baseline.

### Option D — Polling fallback (drop LISTEN/NOTIFY entirely)

**Architecture:** browser polls REST endpoints every N seconds for
freshness. No server push.

**What changes:**
- Delete `/api/events/stream` route + `postgres-listener.ts` +
  trigger migrations
- Add polling to consumers (AlertsPanel, HeatMap, Audit feed) at
  10-30s intervals
- Lose real-time UX (stale-up-to-N-seconds)

**Strengths:**
- Zero infra (everything fits Vercel functions)
- Simplest debugging (no long-lived connections to reason about)
- Cheapest to host (just function invocations)

**Weaknesses:**
- Polling cost at scale: 100 clients × 6 polls/min × 3 endpoints =
  1800 function invocations/min = 2.6M/day = ~$5-15/mo on Vercel Pro
- UX degradation — alerts surface up to N seconds late
- Wasted bandwidth on no-change polls
- Can't cleanly notify "operation completed" (e.g. async recompute
  finished) without polling-with-job-ID dance

**Effort estimate:** 1-2 days (delete + add polling hooks).

### Option E — Vercel Postgres / Neon LISTEN-supported tier

**Architecture:** unchanged client-side; switch DB host to a managed
Postgres that allows persistent LISTEN connections from serverless.

**Reality check (2026-05-03):**
- **Vercel Postgres**: powered by Neon. Standard tier compute scales
  to zero on idle — LISTEN connection KILLED after ~5 min idle.
  Always-on compute is paid tier; pricing similar to a small dedicated
  Postgres.
- **Neon directly**: same limitations (Vercel Postgres is a Neon
  resale).
- **Supabase**: managed Postgres with realtime replication via
  WebSocket — actually a different protocol than LISTEN/NOTIFY (uses
  logical replication slots). Migration path is bigger than just
  swapping connection strings.

**Strengths:**
- Minimal code changes if Neon always-on works
- Managed-DB benefits (backups, point-in-time recovery, etc.)

**Weaknesses:**
- Doesn't actually solve the serverless function-timeout problem
  (function still gets killed mid-LISTEN at 60s)
- Cost: always-on Neon ≈ $20-50/mo for the same resource floor as a
  dedicated VM
- Vendor lock-in to Vercel ecosystem
- Supabase realtime requires complete protocol rewrite (use their
  client SDK instead of pg.Client)

**Effort estimate:** 1-3 days (Neon switch is mostly env-var;
Supabase is 3-5 days).

**Verdict:** does not solve the actual problem (function timeouts);
deferred unless Vercel ships a documented "long-lived stream" runtime.

---

## 5. Comparison matrix

| Dimension | A: Redis bridge | B: Dedicated Node service | C: Stay on VM (current) | D: Polling | E: Managed PG tier |
|-----------|-----------------|---------------------------|-------------------------|-----------|--------------------|
| **Code change** | Medium (replace `postgres-listener.ts`) | Medium (extract `/api/events/stream` to broker) | None | Medium (delete SSE, add polling) | None to small |
| **New infra to operate** | 2 (bridge + Redis) | 1 (broker service) | 0 | 0 | 0 (managed) |
| **Per-event latency** | ~10-50ms | ~5-20ms | ~1-5ms (current) | N/A (poll-stale) | Same as current IF works |
| **Concurrent SSE ceiling** | 1000s (Redis fan-out) | 1000s (broker resource-bound) | 50-100 / VM | Function-throughput-bound | Doesn't help |
| **Vercel function-timeout problem** | SOLVED (subscribe per-fn) | SOLVED (browser → broker direct) | N/A (no Vercel) | SOLVED (no long-lived) | NOT SOLVED |
| **Postgres connection count** | 1 (bridge) | 1 (broker) | 1 (current) | 0 | N (per warm fn) |
| **Single point of failure** | Bridge OR Redis | Broker | VM (or LB) | None | Managed-PG outage |
| **Monthly infra cost** | $5-30 | $5-20 | $20-50 | ~$5-15 (function calls) | $20-50 |
| **Effort to ship** | 2-3 days | 3-4 days | 0 days | 1-2 days | 1-3 days |
| **Effort to maintain** | Medium (2 services) | Medium (1 service + auth coupling) | Low (current) | Low | Low |
| **Vendor lock-in** | Low (Redis is portable) | Low (broker is just Node) | None | None | High (Vercel ecosystem) |
| **Real-time UX preserved** | Yes | Yes | Yes (current) | NO (stale-up-to-N-sec) | Yes if works |
| **Phase 7.E AI Web Crawler synergy** | High (Redis natural for LLM job queue) | Low | Low | Low | Low |

---

## 6. Recommendation

**Default recommendation: Option C (stay on long-lived runtime) until
the trigger event below.**

Rationale:
- FO Holding's deployment is a single-VM, single-tenant, internal-use
  installation — Vercel migration has no business case today
- Phase 7's customer count is 1 (FO Holding); 50-100 SSE-client
  ceiling is ~50× headroom over real load
- Operational simplicity matters more than serverless cost-elasticity
  at this scale
- Engineering hours are better spent on Phase 7.G E2E + customer
  feedback than on a serverless rewrite for hypothetical future scale

**Trigger to revisit:** when ANY of these become true:
1. Multi-tenant SaaS launch (≥3 customers on shared infra) — vertical
   scale ceiling becomes a real wall
2. Customer asks for Vercel/cloud-native deploy as a procurement
   requirement (banking, gov sectors often do)
3. Concurrent SSE clients across all orgs exceeds ~80 — single VM
   approaches its ceiling
4. Background scheduler (BullMQ + Redis) ships separately for unrelated
   reasons — Redis becomes "free", Option A becomes nearly-zero-marginal-cost

**At the trigger event: ship Option A (Redis pub/sub bridge).**

Rationale for A over B:
- Redis is also useful for the BullMQ scheduler (CARRYOVER 🔄), so
  one infra component serves multiple needs
- Bridge worker is dead-simple Node script (~50 LOC) vs broker service
  with auth surface (~200-300 LOC + cookie/CORS plumbing)
- Per-org channels at the Redis level are operationally cleaner than
  per-payload filtering at the Vercel function level
- Latency cost (~10-50ms) is invisible for the use case (Alert
  surfacing, audit feed updates — none are sub-100ms-critical)

Rationale against B:
- Adds auth-coupling complexity (broker needs to validate Vercel
  sessions OR share NEXTAUTH_SECRET)
- Requires DNS subdomain + cookie-domain setup
- Higher single-point-of-failure risk (broker IS the SSE endpoint;
  outage = all SSE down)

Rationale against D:
- UX downgrade is real (stale alerts up to 30s on a tool sold for
  real-time risk visibility)
- Phase 7.E AI components (Variance Explainer, Predictive forecasts)
  benefit from "operation done" push notifications when polling alone
  is awkward

Rationale against E:
- Doesn't solve function-timeout problem (the actual blocker)
- Vendor lock-in to Vercel ecosystem
- Supabase migration is 3-5 days for protocol switch — not a "small"
  alternative

---

## 7. Migration plan IF Option A is chosen

For traceability when the trigger event hits:

### 7.1 Prerequisites

- Redis instance provisioned (Upstash, Render, or self-hosted)
- Bridge worker host chosen (Fly.io app, Render Background Worker,
  or small VM)
- `REDIS_URL` env var added to:
  - Bridge worker config
  - Vercel app config

### 7.2 Bridge worker (~50-80 LOC)

```typescript
// bridge.ts — runs on Fly.io / Render / etc.
import { Client } from 'pg';
import { createClient as createRedis } from 'redis';

const pg = new Client({ connectionString: process.env.DATABASE_URL });
const redis = createRedis({ url: process.env.REDIS_URL });
await pg.connect();
await redis.connect();

pg.on('notification', (msg) => {
  if (!msg.channel || !msg.payload) return;
  const payload = JSON.parse(msg.payload);
  // Per-org Redis channel — server-side filter at Vercel function
  // becomes "subscribe to my org's channel".
  const orgChannel = `${msg.channel}:org-${payload.organizationId}`;
  redis.publish(orgChannel, msg.payload);
});

await pg.query('LISTEN audit_events_changed');
await pg.query('LISTEN indicator_values_changed');

console.log('[bridge] running, forwarding pg→redis');
```

### 7.3 Vercel SSE handler refactor

Replace `subscribe()` from `postgres-listener.ts` with Redis-subscribe:

```typescript
// In /api/events/stream/route.ts
import { createClient } from 'redis';

// Per-request short-lived Redis subscriber
const sub = createClient({ url: process.env.REDIS_URL });
await sub.connect();
const orgChannel = `audit_events_changed:org-${orgId}`;
await sub.subscribe(orgChannel, (payload) => {
  sendEvent('audit:changed', JSON.parse(payload));
});
// On request abort:
await sub.unsubscribe(orgChannel);
await sub.quit();
```

Function timeout still kills the connection after 60-300s — client
reconnects via existing `use-event-stream.ts` exponential backoff.

### 7.4 Migration steps

1. Provision Redis + deploy bridge worker
2. Bridge starts forwarding events to Redis (parallel to current
   Postgres LISTEN — both work simultaneously)
3. Verify bridge: `redis-cli SUBSCRIBE audit_events_changed:org-<id>`
   shows events flowing
4. Deploy refactored `/api/events/stream` to Vercel as a feature flag
   (`USE_REDIS_SSE=true`)
5. Canary 10% of clients → 50% → 100% over 3 days
6. Once 100% on Redis path: tear down `postgres-listener.ts`
7. Delete LISTEN/NOTIFY trigger migrations? NO — keep them; they're
   idempotent with bridge's LISTEN. Cost is one extra Postgres
   notification per write (microseconds).

### 7.5 Rollback

Keep the old `postgres-listener.ts` codepath behind the feature flag
for 30 days post-100%-rollout. If Redis bridge has any incident:
1. Flip `USE_REDIS_SSE=false`
2. Vercel functions revert to Postgres-LISTEN path (which still has
   all the function-timeout problems described in §3, but at least
   restores some functionality at low scale).
3. Once incident root-caused → re-enable Redis path.

After 30 days clean: delete the legacy code.

---

## 8. Open questions (resolve before migration)

1. **Redis hosting choice**: Upstash (per-request pricing, ideal for
   serverless) vs always-on Render/Railway (~$10-20/mo flat). Upstash
   is the natural Vercel pairing.
2. **Bridge HA**: single bridge with health-check restart, or
   active-active with leader election? Single bridge is fine for
   <1000 req/sec NOTIFY rate; HA needed only at scale.
3. **Per-org channel naming**: `audit_events_changed:org-<id>` vs
   `events:audit:org-<id>` — purely cosmetic; pick once + lock.
4. **Auth on the bridge → Vercel function path**: bridge has no auth
   (it's behind private network). Vercel function authenticates the
   browser via session cookie as today; no broker-side auth needed
   since Redis subscription is read-only.

---

## 9. Cross-references

- **Current implementation**: `src/lib/events/postgres-listener.ts`,
  `src/app/api/events/stream/route.ts`, `src/lib/events/use-event-stream.ts`
- **Postgres triggers**: `prisma/migrations/20260427195305_sse_listen_notify_triggers`
- **Why Vercel breaks SSE**: `docs/DEPLOYMENT_READINESS.md` §4.3
  (KNOWN INFRASTRUCTURE GAPS)
- **Background scheduler context** (where Redis becomes free
  marginal cost): CARRYOVER 🔄 "BullMQ scheduler for periodic alert
  re-evaluation"
- **Phase 7.G context**: `docs/ROADMAP.md` §7.G

---

## Versioning

Doc is **v1** (2026-05-03), Phase 7.G Turn C deliverable.

### Changelog

- **2026-05-03 — v1** — Initial ADR. Recommendation: stay on Option C
  (long-lived runtime); ship Option A (Redis pub/sub bridge) at
  trigger event. No code change yet.
