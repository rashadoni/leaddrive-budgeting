/**
 * Phase 7.G Turn LXXIII (Phase 4.3 sub-3 — email notifications).
 *
 * Approval-flow notification helpers. Routes call these after the
 * primary mutation completes; helpers do NOT throw — email failures
 * are logged but never reverse the underlying state change.
 *
 * Why a separate file from the routes:
 *   - Keeps route handlers focused on the HTTP contract.
 *   - The user-set lookup (org admins for `created`, requester for
 *     approved/rejected) is shared logic — single source of truth.
 *   - Tests can mock this module directly via `vi.mock`.
 */

import type { PrismaClient } from "@prisma/client"
import { getEmailService } from "@/lib/email"
import {
  renderApprovalEmail,
  type ApprovalEvent,
  type ApprovalEmailParams,
} from "@/lib/email/templates/approval-notifications"
import type { EmailLanguage, EmailRecipient } from "@/lib/email/types"

/**
 * Returns the user's preferred language, falling back to English. v1
 * always returns "en" — per-user language pref isn't stored yet (it's
 * a separate Phase 4.4 ask). When stored, this is the only place to
 * change the lookup.
 */
function preferredLang(_userId: string): EmailLanguage {
  return "en"
}

/**
 * Emit `approval_request_created` to all org admins+managers (the
 * audience that can approve). Best-effort — email failures don't
 * surface in the response.
 */
export async function notifyApprovalCreated(
  prisma: Pick<PrismaClient, "user">,
  opts: {
    orgId: string
    requestType: string
    requesterUserId: string
    requesterName: string
    reason: string | null
  },
): Promise<void> {
  // Find admins+managers in the org. Exclude the requester (they
  // already know they submitted; no point self-notifying).
  const reviewers = await prisma.user.findMany({
    where: {
      organizationId: opts.orgId,
      role: { in: ["admin", "manager"] },
      isActive: true,
      id: { not: opts.requesterUserId },
    },
    select: { id: true, email: true, name: true },
  })
  if (reviewers.length === 0) return

  const recipients: EmailRecipient[] = reviewers.map(
    (r: { email: string; name: string }) => ({ email: r.email, name: r.name }),
  )
  const lang = preferredLang(opts.requesterUserId) // v1: always en
  const params: ApprovalEmailParams = {
    requestType: opts.requestType,
    requesterName: opts.requesterName,
    reason: opts.reason ?? undefined,
  }
  const { subject, body } = renderApprovalEmail("created", lang, params)
  await getEmailService()
    .send({
      to: recipients,
      subject,
      body,
      lang,
      metadata: { kind: "approval_request_created", requesterUserId: opts.requesterUserId },
    })
    .catch(() => {})
}

/**
 * Emit `approval_request_approved` or `_rejected` to the original
 * requester. Reads the requester's email + name from the User table.
 */
export async function notifyApprovalReviewed(
  prisma: Pick<PrismaClient, "user">,
  opts: {
    event: Extract<ApprovalEvent, "approved" | "rejected">
    requesterUserId: string
    reviewerUserId: string
    requestType: string
    reviewComment: string | null
  },
): Promise<void> {
  const [requester, reviewer] = await Promise.all([
    prisma.user.findFirst({
      where: { id: opts.requesterUserId, isActive: true },
      select: { email: true, name: true },
    }),
    prisma.user.findFirst({
      where: { id: opts.reviewerUserId },
      select: { name: true },
    }),
  ])
  if (!requester) return // requester deactivated mid-flight; skip silently

  const lang = preferredLang(opts.requesterUserId)
  const params: ApprovalEmailParams = {
    requestType: opts.requestType,
    requesterName: requester.name,
    reviewerName: reviewer?.name ?? opts.reviewerUserId,
    reviewComment: opts.reviewComment ?? undefined,
  }
  const { subject, body } = renderApprovalEmail(opts.event, lang, params)
  await getEmailService()
    .send({
      to: { email: requester.email, name: requester.name },
      subject,
      body,
      lang,
      metadata: {
        kind: `approval_request_${opts.event}`,
        requesterUserId: opts.requesterUserId,
        reviewerUserId: opts.reviewerUserId,
      },
    })
    .catch(() => {})
}
