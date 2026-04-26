/**
 * Phase 7.D — terminal layout single-item endpoint.
 *
 * GET    — read one named layout (the load path).
 * DELETE — remove it. Idempotent: 404 on missing matches the user's
 *          mental model ("it's not there → 404") and avoids a separate
 *          207-multi-status path for the UI.
 *
 * Auth: any authenticated user. Layouts are USER-scoped; no
 * cross-user read even within the same org.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { validateLayoutName } from "@/features/terminal/lib/layout-sizes"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const { name: rawName } = await params
  const decoded = (() => {
    try {
      return decodeURIComponent(rawName)
    } catch {
      return null
    }
  })()
  const name = validateLayoutName(decoded)
  if (!name) {
    return NextResponse.json({ error: "Invalid layout name" }, { status: 400 })
  }

  const layout = await prisma.userLayoutPreference.findUnique({
    where: { userId_name: { userId: session.userId, name } },
    select: {
      id: true,
      name: true,
      sizes: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!layout) {
    return NextResponse.json({ error: "Layout not found" }, { status: 404 })
  }
  return NextResponse.json({ layout })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const { name: rawName } = await params
  const decoded = (() => {
    try {
      return decodeURIComponent(rawName)
    } catch {
      return null
    }
  })()
  const name = validateLayoutName(decoded)
  if (!name) {
    return NextResponse.json({ error: "Invalid layout name" }, { status: 400 })
  }

  // deleteMany so the 0-rows-affected case returns gracefully rather
  // than throwing P2025. Compose the org-scope into the where clause as
  // defense-in-depth, even though the (userId, name) compound unique
  // already handles the cross-tenant case.
  const result = await prisma.userLayoutPreference.deleteMany({
    where: {
      userId: session.userId,
      organizationId: session.orgId,
      name,
    },
  })
  if (result.count === 0) {
    return NextResponse.json({ error: "Layout not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true, name })
}
