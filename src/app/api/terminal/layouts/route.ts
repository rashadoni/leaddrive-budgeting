/**
 * Phase 7.D — terminal layout collection endpoint.
 *
 * GET  — list current user's saved layouts (name + sizes only).
 * POST — create-or-update a named layout. Body:
 *        `{ name: string, sizes: LayoutSizes }`. Upsert semantics on
 *        `(userId, name)` so re-saving an existing name overwrites
 *        without a delete-then-create dance.
 *
 * Auth: any authenticated user. Org-scoped via `session.orgId` so a
 * malicious user can't read another org's layouts even if their userId
 * is leaked. Rate-limit at 30/min per user — saves are cheap, but
 * unbounded UI-driven save calls would still hit the DB hot path.
 */

import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import {
  validateLayoutName,
  validateLayoutSizes,
} from "@/features/terminal/lib/layout-sizes"

// Reads (LayoutMenu re-fetches on every menu open) get a generous 60/min
// quota; writes are stricter at 30/min since each upsert hits the DB
// hot path. Both keyed per-user so users in shared NAT don't choke each
// other out (consistent with `/api/onboarding/*` defensive defaults).
const READ_RATE_LIMIT = { name: "terminal-layouts-read", max: 60, windowMs: 60_000 }
const WRITE_RATE_LIMIT = { name: "terminal-layouts-write", max: 30, windowMs: 60_000 }

export async function GET(request: NextRequest) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const rateLimitError = enforceRateLimit(
    `${session.userId}:${getClientIp(request)}`,
    READ_RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  const layouts = await withOrgScope(session.orgId, (tx) =>
    tx.userLayoutPreference.findMany({
      where: { userId: session.userId, organizationId: session.orgId },
      select: {
        id: true,
        name: true,
        sizes: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
  )

  return NextResponse.json({ layouts })
}

export async function POST(request: NextRequest) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const rateLimitError = enforceRateLimit(
    `${session.userId}:${getClientIp(request)}`,
    WRITE_RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  let body: unknown
  try {
    body = await request.json()
  } catch (err) {
    return NextResponse.json(
      {
        error: `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    )
  }
  if (body == null || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 })
  }
  const { name: rawName, sizes: rawSizes } = body as {
    name?: unknown
    sizes?: unknown
  }

  const name = validateLayoutName(rawName)
  if (!name) {
    return NextResponse.json(
      {
        error:
          "Invalid `name`: 1-40 chars, no leading/trailing whitespace, no control chars.",
      },
      { status: 400 },
    )
  }

  const sizes = validateLayoutSizes(rawSizes)
  if (!sizes) {
    return NextResponse.json(
      {
        error:
          'Invalid `sizes`: expected `{ outer: { "row-top": pct, "row-bottom": pct }, top: { p1, p2 }, bottom: { p3, p4 } }` where each panel-id map sums to 100. Panel ids must match the current PanelGrid structure (`PANEL_IDS` const).',
      },
      { status: 400 },
    )
  }

  // Upsert on the (userId, name) unique key. Re-saving a name overwrites
  // without a separate DELETE call. `LayoutSizes` is a struct with named
  // keys (no index signature), so it needs an explicit shape conversion
  // to `Prisma.InputJsonObject` — `JSON.parse(JSON.stringify(sizes))` is
  // the simplest type-safe way and round-trips through plain JSON values
  // (the same form Prisma will store anyway).
  const sizesJson: Prisma.InputJsonValue = JSON.parse(JSON.stringify(sizes))
  const layout = await withOrgScope(session.orgId, (tx) =>
    tx.userLayoutPreference.upsert({
      where: { userId_name: { userId: session.userId, name } },
      create: {
        organizationId: session.orgId,
        userId: session.userId,
        name,
        sizes: sizesJson,
      },
      update: { sizes: sizesJson },
      select: {
        id: true,
        name: true,
        sizes: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  )

  return NextResponse.json({ layout }, { status: 200 })
}
