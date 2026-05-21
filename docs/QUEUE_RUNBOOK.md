# Queue Runbook — Phase 6 (BullMQ + Redis)

**Status (2026-05-21)**: feature-flagged behind `QUEUE_BACKEND=bullmq`.
Default = `inprocess` so legacy job-runner stays the hot path. Toggle
**only** after the worker daemon is running — otherwise jobs sit in
Redis with no consumer.

## Stack

- **Redis** (single instance, brew-managed on dev Mac)
- **BullMQ** (queue + worker library, JS-native)
- **ioredis** (low-level Redis client BullMQ uses)

## Components

| File | Role |
|---|---|
| `src/lib/queue/redis-client.ts` | Singleton ioredis with BullMQ-required `maxRetriesPerRequest: null` + 5s reconnect cap |
| `src/lib/queue/queues.ts` | 4 queue singletons + helper `enqueueRecomputeBatch` / `enqueueRecomputePair` |
| `src/lib/queue/job-types.ts` | Typed payloads — `RecomputePairJob`, `RecomputeBatchJob`, `ImportJob`, `SparklineBackfillJob` |
| `src/lib/queue/worker-factory.ts` | Build workers bound to processors; logs lifecycle events |
| `src/lib/queue/processors/recompute-processor.ts` | Wraps `runRecomputeForCompanies`, emits 0..100 progress, chunks ~10 per batch |
| `src/lib/queue/feature-flag.ts` | `QUEUE_BACKEND=bullmq` env toggle |
| `scripts/run-worker.ts` | Long-running daemon — `npx tsx scripts/run-worker.ts` |
| `src/app/api/queue/jobs/[jobId]/route.ts` | GET job status (org-scoped) |
| `src/app/api/queue/jobs/[jobId]/progress/route.ts` | SSE progress stream |
| `src/app/api/admin/queue/route.ts` | Admin list-by-state REST |
| `src/app/(dashboard)/budgeting/admin/queue/page.tsx` | Admin landing UI |
| `src/hooks/useJobProgress.ts` | Client React hook over SSE |

## Day-to-day operations

### Start Redis (one-time per machine)

```bash
brew services start redis     # starts on boot
redis-cli ping                # should return PONG
```

### Start the worker daemon

```bash
npx tsx scripts/run-worker.ts
```

Heartbeats every 60s. SIGTERM gracefully closes (up to 60s for
in-flight jobs).

### Switch HTTP to BullMQ backend

```bash
# Add to .env (or LaunchAgent plist for the dev server)
QUEUE_BACKEND=bullmq
```

Restart the dev server: `launchctl kickstart -k gui/501/com.budgetpro.dev`.

### Inspect jobs

UI: `http://localhost:3000/budgeting/admin/queue` — state filter pills
(active/waiting/completed/failed/delayed) + manual refresh.

REST: `GET /api/admin/queue?state=failed&limit=100`.

Direct Redis:
```bash
redis-cli LLEN bull:recompute-batch:wait     # waiting count
redis-cli LLEN bull:recompute-batch:failed   # dead-letter count
```

## Retry + DLQ

- 3 attempts with exponential backoff (5s, 10s, 20s) — set in
  `queues.ts` `DEFAULT_JOB_OPTIONS`.
- Import queue overrides to 2 attempts (user-initiated, fail loud).
- Failed jobs retained 30 days / max 5000 (see `removeOnFail`).
- DLQ audit-event row → schema migration deferred to a separate PR
  pending explicit user authorization (additive enum change).

## Rollback

1. `unset QUEUE_BACKEND` (or delete from .env).
2. Restart dev server.
3. New requests use the in-process job-runner; in-flight BullMQ jobs
   complete via the worker daemon (no data loss).

## Monitoring (deferred)

- Redis memory usage: `redis-cli INFO memory` — alert if `used_memory_human` > 1 GB.
- Worker lag: compare `LLEN bull:<queue>:wait` between checks — growing
  unboundedly = workers not keeping up.
- DLQ depth: > 100 failed jobs in a day = real bug, investigate.

Production Prometheus exporter via `bullmq-prometheus` is the obvious
next step but deferred per single-tenant scope.
