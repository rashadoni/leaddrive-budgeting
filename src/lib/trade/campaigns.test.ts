import { describe, expect, it } from "vitest";

import {
  campaignCodeFromName,
  campaignCreateSchema,
  campaignUpdateSchema,
  canSubmitCampaign,
  isCampaignEditable,
  isRunning,
  statusAfterDecision,
} from "./campaigns";

describe("campaignCreateSchema", () => {
  const valid = {
    name: "Yay kampaniyası",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    plannedBudgetAmount: 50000,
    scopes: [{ scopeType: "channel", scopeValue: "Modern Trade" }],
  };

  it("accepts a valid campaign and defaults scope.include", () => {
    const parsed = campaignCreateSchema.parse(valid);
    expect(parsed.scopes[0].include).toBe(true);
    expect(parsed.code).toBeUndefined();
  });

  it("rejects endDate before startDate", () => {
    expect(() =>
      campaignCreateSchema.parse({ ...valid, endDate: "2026-07-01" })
    ).toThrow();
  });

  it("rejects a scope with neither id nor value", () => {
    expect(() =>
      campaignCreateSchema.parse({ ...valid, scopes: [{ scopeType: "brand" }] })
    ).toThrow();
  });

  it("rejects negative budget and bad code shape", () => {
    expect(() =>
      campaignCreateSchema.parse({ ...valid, plannedBudgetAmount: -1 })
    ).toThrow();
    expect(() =>
      campaignCreateSchema.parse({ ...valid, code: "lower case!" })
    ).toThrow();
  });
});

describe("campaignUpdateSchema", () => {
  it("allows partial updates and nullable clears", () => {
    const parsed = campaignUpdateSchema.parse({ goal: null, plannedBudgetAmount: 100 });
    expect(parsed.goal).toBeNull();
    expect(parsed.plannedBudgetAmount).toBe(100);
  });
});

describe("status helpers", () => {
  it("draft and rejected are editable/submittable; others are not", () => {
    for (const s of ["draft", "rejected"] as const) {
      expect(isCampaignEditable(s)).toBe(true);
      expect(canSubmitCampaign(s)).toBe(true);
    }
    for (const s of ["pending_approval", "approved", "paused", "completed", "cancelled"] as const) {
      expect(isCampaignEditable(s)).toBe(false);
      expect(canSubmitCampaign(s)).toBe(false);
    }
  });

  it("maps reviewer decisions to campaign statuses", () => {
    expect(statusAfterDecision("approve")).toBe("approved");
    expect(statusAfterDecision("reject")).toBe("rejected");
    expect(statusAfterDecision("cancel")).toBe("draft");
  });
});

describe("isRunning", () => {
  const base = {
    status: "approved" as const,
    startDate: new Date("2026-08-01"),
    endDate: new Date("2026-08-31"),
  };

  it("true only for approved campaigns inside the date range", () => {
    expect(isRunning(base, new Date("2026-08-15"))).toBe(true);
    expect(isRunning(base, new Date("2026-09-01"))).toBe(false);
    expect(isRunning({ ...base, status: "draft" }, new Date("2026-08-15"))).toBe(false);
  });
});

describe("campaignCodeFromName", () => {
  it("transliterates Azeri characters and slugs", () => {
    expect(campaignCodeFromName("Yay kampaniyası 2026")).toBe("YAY_KAMPANIYASI_2026");
    expect(campaignCodeFromName("Şəki: Gəncə promo")).toBe("SEKI_GENCE_PROMO");
  });

  it("caps at 40 chars and never returns empty", () => {
    expect(campaignCodeFromName("x".repeat(100)).length).toBeLessThanOrEqual(40);
    expect(campaignCodeFromName("!!!")).toBe("CAMPAIGN");
  });
});
