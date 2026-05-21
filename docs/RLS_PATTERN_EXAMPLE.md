# RLS Pattern — canonical wrapped route example

**Purpose:** the per-table rollout (53 tables, Stage 2) wraps individual
API routes one at a time. This doc shows the exact pattern so the
mechanical-edit work stays consistent. New routes added during rollout
MUST follow this shape — old ones get retrofitted as their owning
table moves up the priority list (`docs/RLS_TABLE_ROLLOUT.md`).

## Read endpoint pattern

```ts
// src/app/api/<resource>/route.ts

import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  // Wrap the ENTIRE handler body in withOrgScope so every Prisma call
  // inside the closure runs through the RLS-protected transaction.
  // The `tx` argument replaces the global `prisma` import.
  return withOrgScope(session.orgId, async (tx) => {
    const rows = await tx.indicatorValue.findMany({
      where: { /* … */ },
    })
    return NextResponse.json({ rows })
  })
}
```

**Key rules:**

1. `withOrgScope` MUST be invoked at the route handler boundary, NOT
   inside a helper that's called from multiple routes. The handler
   knows the orgId; helpers don't (avoids ALS-context-leak class).
2. Inside the closure, ONLY use `tx.*` — never `prisma.*`. A mixed
   handler (some queries on `tx`, some on `prisma`) creates a leak
   surface because the `prisma.*` calls fire outside the transaction
   and see ALL orgs once RLS is enabled.
3. Return the `NextResponse` from inside the closure. The withOrgScope
   transaction commits when the closure resolves; the response object
   is returned as the resolved value.

## Write endpoint pattern (multi-table)

```ts
export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  // … input parse + validation outside the wrap (no DB access) …

  return withOrgScope(session.orgId, async (tx) => {
    const company = await tx.company.create({ data: { … } })
    await tx.auditEvent.create({
      data: { /* … */, organizationId: session.orgId },
    })
    return NextResponse.json({ id: company.id }, { status: 201 })
  })
}
```

Same rules apply — every mutation inside the closure uses `tx`.
Atomicity is a bonus: both writes succeed or both roll back.

## Background worker / cron pattern

```ts
// scripts/intel-scheduler-bootstrap.ts (example)
import { prismaAdmin } from "@/lib/db/prisma-admin"

async function main() {
  // Cross-org maintenance — use the admin client with BYPASSRLS role.
  // NO withOrgScope wrap because we explicitly want ALL orgs' rows.
  const allOrgs = await prismaAdmin.organization.findMany()
  for (const org of allOrgs) {
    // Per-org work that touches RLS-protected tables MUST switch back
    // to withOrgScope here, even from inside the admin client, because
    // app.organization_id must be set so the queries match the policy.
    await withOrgScope(org.id, async (tx) => {
      await tx.indicatorValue.deleteMany({ where: { … } })
    })
  }
}
```

## What NOT to do

```ts
// ❌ Wrong — prisma.* call outside the wrap leaks across orgs
export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  const orgInfo = await prisma.organization.findUnique({  // ← LEAK
    where: { id: session.orgId },
  })
  return withOrgScope(session.orgId, async (tx) => {
    return NextResponse.json({ orgInfo, rows: await tx.x.findMany() })
  })
}

// ✅ Right — every DB call inside the wrap
export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  return withOrgScope(session.orgId, async (tx) => {
    const orgInfo = await tx.organization.findUnique({
      where: { id: session.orgId },
    })
    return NextResponse.json({ orgInfo, rows: await tx.x.findMany() })
  })
}
```

```ts
// ❌ Wrong — withOrgScope({bypass:true}) inside an HTTP handler
// (the user's request flow MUST be tenant-scoped, no bypass)
return withOrgScope(session.orgId, fn, { bypass: true })

// ✅ Right — cron / migration uses prismaAdmin instead
import { prismaAdmin } from "@/lib/db/prisma-admin"
const rows = await prismaAdmin.x.findMany()
```

## Bypass deprecation timeline (Stage 2 Round-2 verdict)

- **2026-05-21**: console.warn added when `withOrgScope({bypass:true})` is called.
- **2026-06-04**: remove the `bypass` option entirely. Any remaining
  cron / migration paths still using it must switch to `prismaAdmin`
  before that date or break.
