/**
 * Phase 7.G Turn LXXIII (Phase 4.3 sub-3 — email notifications).
 *
 * In-memory `EmailService` implementation. Records every send into an
 * internal log; never throws. Default implementation in dev + tests
 * until a real provider (SMTP / SendGrid / Resend) is wired.
 *
 * Test usage:
 *   const svc = new InMemoryEmailService()
 *   await svc.send({ to: {email: "x@y"}, subject: "...", body: "...", lang: "en" })
 *   expect(svc.getSentEmails()).toHaveLength(1)
 *
 * Production usage:
 *   - Until env var `EMAIL_PROVIDER` is set (Turn LXXIV+ task), the
 *     factory in `./index.ts` returns this impl. Sent emails accumulate
 *     in process memory and are visible via the `getSentEmails()`
 *     accessor — useful for dev demos but NOT for end-user delivery.
 *   - The dev server logs `[email/in-memory] sent {kind: ...}` per send
 *     so you can see what would have been emailed without a provider.
 */

import type { EmailService, EmailPayload, SendResult } from "./types"
import { getLogger } from "@/lib/log"

// Phase 8 D4 final (2026-05-29) — structured logger (muted in tests by
// default, so the in-memory stub no longer floods vitest stdout).
const log = getLogger("email:in-memory")

interface SentEmail extends EmailPayload {
  messageId: string
  sentAt: Date
}

export class InMemoryEmailService implements EmailService {
  private sent: SentEmail[] = []
  private nextId = 1

  async send(payload: EmailPayload): Promise<SendResult> {
    const messageId = `mem-${this.nextId++}-${Date.now()}`
    const record: SentEmail = { ...payload, messageId, sentAt: new Date() }
    this.sent.push(record)
    // Best-effort dev trace — short, doesn't leak body to logs.
    const kind = payload.metadata?.kind ?? "email"
    // Count both `to` and `bcc` — bcc-only broadcasts (e.g. notifyApprovalCreated)
    // would otherwise log "0 recipients" and look like noop. Single recipient
    // (object form, not array) counts as 1.
    const toCount = Array.isArray(payload.to) ? payload.to.length : 1
    const bccCount = payload.bcc?.length ?? 0
    const total = toCount + bccCount
    log.info("sent", { kind, recipients: total })
    return { ok: true, messageId }
  }

  /** Test/dev accessor — returns all sent emails since instance creation. */
  getSentEmails(): readonly SentEmail[] {
    return this.sent
  }

  /** Test helper — clears the sent log. */
  clear(): void {
    this.sent = []
    this.nextId = 1
  }
}
