import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import {
  passwordChangeSchema,
  hasSecurePasswordTransport,
  hasTrustedOrigin,
} from "@/lib/auth/password-change"
import {
  enforceRateLimit,
  getClientIp,
} from "@/lib/rate-limit"
import { buildAuditContext, logAuditEvent } from "@/lib/audit/log"

const PASSWORD_CHANGE_LIMIT = {
  name: "account-password-change",
  windowMs: 15 * 60_000,
  max: 5,
}

export async function PATCH(request: NextRequest) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session

  if (!hasSecurePasswordTransport(request)) {
    return NextResponse.json(
      { error: "secure_transport_required", code: "SECURE_TRANSPORT_REQUIRED" },
      { status: 426 },
    )
  }

  if (!hasTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "origin_not_allowed", code: "ORIGIN_NOT_ALLOWED" },
      { status: 403 },
    )
  }

  const userLimit = enforceRateLimit(
    `${session.orgId}:${session.userId}`,
    PASSWORD_CHANGE_LIMIT,
  )
  if (userLimit) return userLimit

  const ipLimit = enforceRateLimit(
    `ip:${getClientIp(request)}`,
    { ...PASSWORD_CHANGE_LIMIT, name: "account-password-change-ip" },
  )
  if (ipLimit) return ipLimit

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json(
      { error: "invalid_request", code: "INVALID_REQUEST" },
      { status: 400 },
    )
  }

  const parsed = passwordChangeSchema.safeParse(rawBody)
  if (!parsed.success) {
    const byteLimitFailed = parsed.error.issues.some(
      (issue) => issue.message === "password_too_many_bytes",
    )
    return NextResponse.json(
      {
        error: "invalid_password",
        code: byteLimitFailed ? "PASSWORD_TOO_MANY_BYTES" : "INVALID_PASSWORD",
      },
      { status: 400 },
    )
  }

  const account = await withOrgScope(session.orgId, (tx) =>
    tx.user.findFirst({
      where: {
        id: session.userId,
        organizationId: session.orgId,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
      },
    }),
  )

  if (!account) {
    return NextResponse.json(
      { error: "session_invalid", code: "SESSION_INVALID" },
      { status: 401 },
    )
  }

  const currentMatches = await bcrypt.compare(
    parsed.data.currentPassword,
    account.passwordHash,
  )
  if (!currentMatches) {
    return NextResponse.json(
      { error: "current_password_incorrect", code: "CURRENT_PASSWORD_INCORRECT" },
      { status: 400 },
    )
  }

  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return NextResponse.json(
      { error: "password_reuse", code: "PASSWORD_REUSE" },
      { status: 400 },
    )
  }

  // bcrypt is CPU-bound. Keep compare/hash outside the scoped transaction.
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12)

  // Compare-and-swap prevents two concurrent password changes from both
  // succeeding after validating against the same old hash.
  const changed = await withOrgScope(session.orgId, (tx) =>
    tx.user.updateMany({
      where: {
        id: account.id,
        organizationId: session.orgId,
        isActive: true,
        passwordHash: account.passwordHash,
      },
      data: {
        passwordHash,
        authVersion: { increment: 1 },
      },
    }),
  )

  if (changed.count !== 1) {
    return NextResponse.json(
      { error: "password_changed_concurrently", code: "PASSWORD_CONFLICT" },
      { status: 409 },
    )
  }

  const audit = await logAuditEvent(prisma, {
    organizationId: session.orgId,
    actorUserId: session.userId,
    event: {
      action: "user_password_change",
      entityType: "User",
      entityId: account.id,
      metadata: {
        targetEmail: account.email,
        sessionsRevoked: true,
      },
    },
    context: buildAuditContext({
      route: "/api/account/password",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  })

  return NextResponse.json({
    ok: true,
    reauthenticate: true,
    ...(audit.ok ? {} : { auditStale: true }),
  })
}
