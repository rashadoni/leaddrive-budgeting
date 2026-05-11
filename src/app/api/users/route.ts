/**
 * Phase 7.F sub-group RBAC admin v2 — user list endpoint.
 *
 * GET /api/users — list users in the caller's org with their current
 * RBAC scope (allowedSubGroupIds). Admin-only.
 *
 * Used by the /budgeting/admin/users page to render the access-control
 * table.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"

const ALLOWED_ROLES = ["admin", "manager", "editor", "viewer"] as const
type Role = (typeof ALLOWED_ROLES)[number]
function isRole(s: unknown): s is Role {
  return typeof s === "string" && (ALLOWED_ROLES as readonly string[]).includes(s)
}

/** Generate a 12-char URL-safe temp password — random + readable.
 *  Returned to the admin once; user must change it on first login. */
function generateTempPassword(): string {
  return randomBytes(9).toString("base64url")
}

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const users = await prisma.user.findMany({
    where: { organizationId: session.orgId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLogin: true,
      allowedSubGroupIds: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  })

  return NextResponse.json({ users })
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  let body: { email?: unknown; name?: unknown; role?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""
  const role = isRole(body.role) ? body.role : null
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 })
  }
  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Name (≥2 chars) required" }, { status: 400 })
  }
  if (!role) {
    return NextResponse.json(
      { error: `role must be one of: ${ALLOWED_ROLES.join(", ")}` },
      { status: 400 },
    )
  }

  // Duplicate email guard — same org cannot have two users with the same email.
  const existing = await prisma.user.findFirst({
    where: { organizationId: orgId, email },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json(
      { error: "User with this email already exists in your organization", code: "EMAIL_TAKEN" },
      { status: 409 },
    )
  }

  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 10)
  const created = await prisma.user.create({
    data: {
      organizationId: orgId,
      email,
      name,
      role,
      passwordHash,
      allowedSubGroupIds: [],
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLogin: true,
      allowedSubGroupIds: true,
    },
  })

  await logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "user_create",
      entityType: "User",
      entityId: created.id,
      metadata: { targetEmail: email, targetName: name, role },
    },
    context: buildAuditContext({
      route: "/api/users",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  })

  // Return the temp password ONCE — the admin shows it to the new user.
  // Never persisted in plaintext, never returned in subsequent fetches.
  return NextResponse.json({ user: created, tempPassword })
}
