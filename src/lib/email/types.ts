/**
 * Phase 7.G Turn LXXIII (Phase 4.3 sub-3 — email notifications).
 *
 * Transport-agnostic email service interface. Implementations live in
 * sibling files: `in-memory.ts` for dev/test (default), and future
 * `smtp.ts` / `sendgrid.ts` / `resend.ts` once the user picks a
 * provider. Routes consume the interface via `getEmailService()` from
 * `./index.ts` — never reach for a concrete impl directly.
 *
 * Why interface + factory (not direct provider SDK):
 *  - Keeps approval-request routes provider-free; swap is 1-line in
 *    `index.ts` once SMTP/SendGrid/Resend is chosen.
 *  - Tests can substitute the in-memory impl + assert on `getSentEmails()`
 *    without mocking SMTP at vitest level.
 *  - The 4-string template (subject + body × lang) is kept here at the
 *    boundary; `templates/` directory holds the actual EN/RU/AZ strings
 *    so the i18n layer is decoupled from the transport.
 */

export type EmailLanguage = "en" | "ru" | "az"

export interface EmailRecipient {
  email: string
  /** Display name — used in `to: "Name <email>"` formatting. */
  name?: string
}

export interface EmailPayload {
  to: EmailRecipient | EmailRecipient[]
  subject: string
  /** Plain-text body. HTML rendering is provider-specific; v1 is text-only. */
  body: string
  /** Caller-provided language hint — implementations MAY use it for
   *  envelope-level Content-Language headers; v1 in-memory ignores. */
  lang: EmailLanguage
  /** Free-form metadata for audit/debugging — e.g. `{ kind: "approval_created", requestId: "X" }`.
   *  Implementations MUST NOT leak this to the recipient. */
  metadata?: Record<string, unknown>
}

export interface SendResult {
  ok: boolean
  /** Provider-assigned message id when ok=true. */
  messageId?: string
  /** Reason string when ok=false. */
  error?: string
}

export interface EmailService {
  /**
   * Send a transactional email. Resolves with `{ok, ...}` — NEVER throws.
   * Failure handling is per-caller policy: some flows surface a soft
   * `auditStale: true` warning, others log + continue.
   */
  send(payload: EmailPayload): Promise<SendResult>
}
