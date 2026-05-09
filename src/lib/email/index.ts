/**
 * Phase 7.G Turn LXXIII (Phase 4.3 sub-3 — email notifications).
 *
 * Singleton factory for the active `EmailService` impl. Routes call
 * `getEmailService()` and consume the interface — they never reach
 * for a concrete impl directly. This keeps the swap to a real provider
 * (SMTP / SendGrid / Resend) a 1-line edit here.
 *
 * Selection rule:
 *   - For now: always returns `InMemoryEmailService` (singleton).
 *   - Future Turn LXXIV+ wire-up: read `process.env.EMAIL_PROVIDER`,
 *     branch on `"smtp" | "sendgrid" | "resend" | "in-memory"`.
 *
 * Singleton scope:
 *   - One in-memory store per Node process. In dev (LaunchAgent), this
 *     means sent emails accumulate across requests — useful for "show
 *     me what would have been emailed" debugging via /api/dev/sent-emails
 *     (future endpoint, not shipped this turn).
 *   - Tests that need fresh state: import `resetEmailServiceForTests`
 *     from this module.
 */

import { InMemoryEmailService } from "./in-memory"
import type { EmailService } from "./types"

let instance: EmailService | null = null

export function getEmailService(): EmailService {
  if (!instance) instance = new InMemoryEmailService()
  return instance
}

/**
 * Test-only: reset the singleton. Call in `beforeEach` so per-test
 * `getSentEmails()` reads a clean log. Production callers MUST NOT use.
 */
export function resetEmailServiceForTests(): void {
  instance = null
}

export { InMemoryEmailService } from "./in-memory"
export type { EmailService, EmailPayload, EmailRecipient, EmailLanguage, SendResult } from "./types"
