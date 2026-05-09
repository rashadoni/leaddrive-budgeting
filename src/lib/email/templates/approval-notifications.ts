/**
 * Phase 7.G Turn LXXIII (Phase 4.3 sub-3 — email notifications).
 *
 * Approval-flow email templates — 3 events × 3 locales.
 *
 * Events:
 *   - `approval_request_created` → sent to all org admins+managers
 *     ("X submitted an approval request for Y, please review").
 *   - `approval_request_approved` → sent to requester ("Your request
 *     was approved by X. You can now apply the change.").
 *   - `approval_request_rejected` → sent to requester ("Your request
 *     was rejected by X. Reason: ...").
 *
 * Cancel intentionally has NO email — requester withdrew their own
 * request, no audience to notify.
 *
 * Plain-text only for v1 — HTML rendering is provider-specific and
 * deferred until provider is picked. Subject + body are localized
 * inline (small surface, no need for full i18n round-trip through
 * `messages/{en,ru,az}.json` for backend strings — keeps the route
 * handler decoupled from the next-intl runtime).
 */

import type { EmailLanguage } from "../types"

export type ApprovalEvent = "created" | "approved" | "rejected"

export interface ApprovalEmailParams {
  requestType: string // e.g. "budget_line_create"
  requesterName: string // who submitted
  reason?: string
  /** For created: the org's display name to anchor the message. */
  organizationName?: string
  /** For approved/rejected: the reviewer's name. */
  reviewerName?: string
  /** For rejected: optional review comment. */
  reviewComment?: string
}

interface Template {
  subject: string
  body: string
}

type EventTemplates = Record<EmailLanguage, Template>

function fillSubject(template: string, p: ApprovalEmailParams): string {
  return template
    .replace("{requestType}", p.requestType)
    .replace("{requesterName}", p.requesterName)
    .replace("{reviewerName}", p.reviewerName ?? "")
}

function fillBody(template: string, p: ApprovalEmailParams): string {
  return template
    .replace("{requestType}", p.requestType)
    .replace("{requesterName}", p.requesterName)
    .replace("{organizationName}", p.organizationName ?? "")
    .replace("{reviewerName}", p.reviewerName ?? "")
    .replace("{reason}", p.reason ?? "—")
    .replace("{reviewComment}", p.reviewComment ?? "—")
}

const TEMPLATES: Record<ApprovalEvent, EventTemplates> = {
  created: {
    en: {
      subject: "New approval request from {requesterName}",
      body:
        "{requesterName} submitted an approval request of type {requestType}.\n\n" +
        "Reason: {reason}\n\n" +
        "Please review and approve or reject in BudgetPro at /budgeting/admin/approval-requests.",
    },
    ru: {
      subject: "Новый запрос на согласование от {requesterName}",
      body:
        "{requesterName} подал запрос на согласование типа {requestType}.\n\n" +
        "Причина: {reason}\n\n" +
        "Пожалуйста, рассмотрите и одобрите или отклоните в BudgetPro: /budgeting/admin/approval-requests.",
    },
    az: {
      subject: "{requesterName} tərəfindən yeni təsdiq sorğusu",
      body:
        "{requesterName} {requestType} tipli təsdiq sorğusu göndərdi.\n\n" +
        "Səbəb: {reason}\n\n" +
        "Zəhmət olmasa BudgetPro-da nəzərdən keçirin və təsdiqləyin və ya rədd edin: /budgeting/admin/approval-requests.",
    },
  },
  approved: {
    en: {
      subject: "Your approval request was approved",
      body:
        "Your approval request of type {requestType} was approved by {reviewerName}.\n\n" +
        "Comment: {reviewComment}\n\n" +
        "You can now apply the change via the original mutation route with ?approvalRequestId=<id>.",
    },
    ru: {
      subject: "Ваш запрос на согласование одобрен",
      body:
        "Ваш запрос на согласование типа {requestType} был одобрен пользователем {reviewerName}.\n\n" +
        "Комментарий: {reviewComment}\n\n" +
        "Теперь вы можете применить изменение через исходный маршрут мутации с параметром ?approvalRequestId=<id>.",
    },
    az: {
      subject: "Sizin təsdiq sorğunuz təsdiqləndi",
      body:
        "Sizin {requestType} tipli təsdiq sorğunuz {reviewerName} tərəfindən təsdiqləndi.\n\n" +
        "Şərh: {reviewComment}\n\n" +
        "İndi dəyişikliyi orijinal mutasiya marşrutu ilə ?approvalRequestId=<id> parametri vasitəsilə tətbiq edə bilərsiniz.",
    },
  },
  rejected: {
    en: {
      subject: "Your approval request was rejected",
      body:
        "Your approval request of type {requestType} was rejected by {reviewerName}.\n\n" +
        "Comment: {reviewComment}\n\n" +
        "Please address the reviewer's feedback and submit a new request if needed.",
    },
    ru: {
      subject: "Ваш запрос на согласование отклонён",
      body:
        "Ваш запрос на согласование типа {requestType} был отклонён пользователем {reviewerName}.\n\n" +
        "Комментарий: {reviewComment}\n\n" +
        "Пожалуйста, учтите обратную связь и при необходимости подайте новый запрос.",
    },
    az: {
      subject: "Sizin təsdiq sorğunuz rədd edildi",
      body:
        "Sizin {requestType} tipli təsdiq sorğunuz {reviewerName} tərəfindən rədd edildi.\n\n" +
        "Şərh: {reviewComment}\n\n" +
        "Zəhmət olmasa rəyçinin geribildirişini nəzərə alın və lazım olduqda yeni sorğu göndərin.",
    },
  },
}

export function renderApprovalEmail(
  event: ApprovalEvent,
  lang: EmailLanguage,
  params: ApprovalEmailParams,
): { subject: string; body: string } {
  const template = TEMPLATES[event][lang]
  return {
    subject: fillSubject(template.subject, params),
    body: fillBody(template.body, params),
  }
}
