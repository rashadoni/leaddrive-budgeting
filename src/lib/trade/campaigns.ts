// Phase 9.4 — Trade campaign helpers: validation + status transitions.
// Design: docs/TRADE_SPEND_CONTROL_TOWER_PLAN.md §4/§5 step 4.
//
// Lifecycle: draft → pending_approval → approved | rejected.
// rejected is editable and can be resubmitted; cancel of a pending
// request returns the campaign to draft. "Running" is NOT a stored
// status — an approved campaign is running when today falls inside
// [startDate, endDate] (see isRunning).

import { z } from "zod";
import type { TradeCampaignStatus } from "@prisma/client";

export const CAMPAIGN_SCOPE_TYPES = [
  "region",
  "channel",
  "rep",
  "outlet",
  "sku",
  "brand",
  "category",
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd");

export const campaignScopeSchema = z
  .object({
    scopeType: z.enum(CAMPAIGN_SCOPE_TYPES),
    scopeId: z.string().min(1).optional(),
    scopeValue: z.string().min(1).max(120).optional(),
    include: z.boolean().default(true),
  })
  .refine((s) => s.scopeId != null || s.scopeValue != null, {
    message: "scope needs scopeId or scopeValue",
  });

export const campaignCreateSchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, "2-40 chars: A-Z 0-9 _ -")
      .optional(),
    name: z.string().min(2).max(160),
    goal: z.string().max(1000).optional(),
    startDate: isoDate,
    endDate: isoDate,
    plannedBudgetAmount: z.number().min(0).max(1e12),
    expectedSalesUpliftAmount: z.number().min(0).max(1e12).optional(),
    expectedSalesUpliftPct: z.number().min(0).max(1000).optional(),
    scopes: z.array(campaignScopeSchema).max(50).default([]),
  })
  .refine((c) => c.endDate >= c.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

// PATCH accepts the same fields, all optional; date-order revalidated
// against the merged row in the route (needs the existing row).
export const campaignUpdateSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  goal: z.string().max(1000).nullable().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  plannedBudgetAmount: z.number().min(0).max(1e12).optional(),
  expectedSalesUpliftAmount: z.number().min(0).max(1e12).nullable().optional(),
  expectedSalesUpliftPct: z.number().min(0).max(1000).nullable().optional(),
  scopes: z.array(campaignScopeSchema).max(50).optional(),
});

export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;

/** Draft-like statuses where fields may be edited / the row soft-deleted. */
export function isCampaignEditable(status: TradeCampaignStatus): boolean {
  return status === "draft" || status === "rejected";
}

/** Statuses from which the campaign can be sent for approval. */
export function canSubmitCampaign(status: TradeCampaignStatus): boolean {
  return status === "draft" || status === "rejected";
}

/** Campaign status after a reviewer decision on the activation request. */
export function statusAfterDecision(
  action: "approve" | "reject" | "cancel"
): TradeCampaignStatus {
  switch (action) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "cancel":
      // Requester withdrew — back to editable draft.
      return "draft";
  }
}

/** An approved campaign is running when `on` falls inside its date range. */
export function isRunning(
  campaign: { status: TradeCampaignStatus; startDate: Date; endDate: Date },
  on: Date = new Date()
): boolean {
  return (
    campaign.status === "approved" &&
    on >= campaign.startDate &&
    on <= campaign.endDate
  );
}

/** Campaign code from a display name: "Yay kampaniyası 2026" -> "YAY_KAMPANIYASI_2026". */
export function campaignCodeFromName(name: string): string {
  const translit: Record<string, string> = {
    ə: "E", Ə: "E", ü: "U", Ü: "U", ö: "O", Ö: "O", ğ: "G", Ğ: "G",
    ş: "S", Ş: "S", ç: "C", Ç: "C", ı: "I", İ: "I",
  };
  const code = name
    .split("")
    .map((ch) => translit[ch] ?? ch)
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, 40);
  return code || "CAMPAIGN";
}
