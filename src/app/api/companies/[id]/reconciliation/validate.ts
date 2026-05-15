/**
 * Phase 7.H Feature 5 — Zod schemas for ClientReconciliation endpoints.
 *
 * Period grammar matches IndicatorValue.period: `YYYY` | `YYYY-Q[1-4]` |
 * `YYYY-MM` (months 01-12 strict). Same regex is used by
 * `/api/indicator-disclosures/route.ts:30` so finance reviewers see the
 * same period strings everywhere.
 *
 * `indicatorKey` is an enum here (not a free string) so v1 can only
 * accept EBITDA — adding NET_MARGIN / ROE / NET_DEBT later means
 * extending the enum + UI; the DB column stays a string for forward
 * compatibility without another migration.
 *
 * `value` is `z.number().finite()` — negative values are intentional
 * (a loss-making period has negative EBITDA; rejecting them would force
 * users to type a workaround).
 *
 * `currency` is ISO 4217 three-letter code (AAA-ZZZ). Default AZN
 * matches the holding's base currency; multi-currency support is
 * essential when client submits USD-denominated audit-confirmed
 * numbers.
 *
 * `note` is capped at 500 chars so a copy-paste of an entire email
 * doesn't bloat audit metadata. Matches `IndicatorDisclosure.sourceNote`.
 */

import { z } from "zod"

export const PERIOD_REGEX = /^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/

export const INDICATOR_KEYS = ["EBITDA"] as const
export type IndicatorKey = (typeof INDICATOR_KEYS)[number]

const CURRENCY_REGEX = /^[A-Z]{3}$/

export const CreateReconciliationSchema = z.object({
  period: z
    .string()
    .regex(PERIOD_REGEX, "Invalid period (must be YYYY, YYYY-QN, or YYYY-MM)"),
  indicatorKey: z.enum(INDICATOR_KEYS),
  value: z.number().finite("Value must be a finite number"),
  currency: z.string().regex(CURRENCY_REGEX, "Currency must be an ISO 4217 code (3 uppercase letters)").default("AZN"),
  note: z.string().max(500, "Note must be ≤ 500 characters").optional(),
})

export type CreateReconciliationInput = z.infer<typeof CreateReconciliationSchema>

export const ListReconciliationQuerySchema = z.object({
  period: z.string().regex(PERIOD_REGEX).optional(),
  indicatorKey: z.enum(INDICATOR_KEYS).optional(),
})

export const DeleteReconciliationQuerySchema = z.object({
  reconciliationId: z.string().min(1, "reconciliationId query param is required"),
})
