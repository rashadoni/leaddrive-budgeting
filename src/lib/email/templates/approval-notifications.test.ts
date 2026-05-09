// @vitest-environment node
/**
 * Phase 7.G Turn LXXIII — guard tests for approval-notification templates.
 * Locks: per-event x per-locale string matrix + placeholder substitution.
 */

import { describe, it, expect } from "vitest"
import { renderApprovalEmail } from "./approval-notifications"

describe("renderApprovalEmail — created event", () => {
  it("substitutes requesterName + requestType + reason in EN", () => {
    const { subject, body } = renderApprovalEmail("created", "en", {
      requestType: "budget_line_create",
      requesterName: "Alice",
      reason: "Need to add Q1 line",
    })
    expect(subject).toContain("Alice")
    expect(body).toContain("Alice")
    expect(body).toContain("budget_line_create")
    expect(body).toContain("Need to add Q1 line")
  })

  it("falls back to em-dash when reason missing", () => {
    const { body } = renderApprovalEmail("created", "en", {
      requestType: "budget_line_create",
      requesterName: "Alice",
    })
    expect(body).toContain("Reason: —")
  })

  it("RU locale produces Cyrillic strings", () => {
    const { subject, body } = renderApprovalEmail("created", "ru", {
      requestType: "budget_line_create",
      requesterName: "Алиса",
    })
    expect(subject).toMatch(/[А-я]/)
    expect(body).toMatch(/[А-я]/)
    expect(body).toContain("Алиса")
  })

  it("AZ locale produces Latin-extended strings (ə)", () => {
    const { subject, body } = renderApprovalEmail("created", "az", {
      requestType: "budget_line_create",
      requesterName: "Aliyev",
    })
    // Azerbaijani has 'ə' character distinctly
    expect(subject + body).toMatch(/[əğşıöü]/)
    expect(body).toContain("Aliyev")
  })
})

describe("renderApprovalEmail — approved event", () => {
  it("includes reviewerName and reviewComment", () => {
    const { subject, body } = renderApprovalEmail("approved", "en", {
      requestType: "budget_line_create",
      requesterName: "Alice",
      reviewerName: "Bob",
      reviewComment: "Approved for Q1 close",
    })
    expect(subject).toMatch(/approved/i)
    expect(body).toContain("Bob")
    expect(body).toContain("Approved for Q1 close")
  })

  it("falls back to em-dash when reviewComment missing", () => {
    const { body } = renderApprovalEmail("approved", "en", {
      requestType: "budget_line_create",
      requesterName: "Alice",
      reviewerName: "Bob",
    })
    expect(body).toContain("Comment: —")
  })
})

describe("renderApprovalEmail — rejected event", () => {
  it("includes reviewerName + reviewComment + addresses requester", () => {
    const { subject, body } = renderApprovalEmail("rejected", "en", {
      requestType: "budget_line_create",
      requesterName: "Alice",
      reviewerName: "Bob",
      reviewComment: "Insufficient justification",
    })
    expect(subject).toMatch(/rejected/i)
    expect(body).toContain("Bob")
    expect(body).toContain("Insufficient justification")
  })

  it("RU rejected — Cyrillic", () => {
    const { subject } = renderApprovalEmail("rejected", "ru", {
      requestType: "budget_line_create",
      requesterName: "Алиса",
      reviewerName: "Боб",
    })
    expect(subject).toMatch(/[А-я]/)
  })

  it("AZ rejected — Azerbaijani", () => {
    const { subject } = renderApprovalEmail("rejected", "az", {
      requestType: "budget_line_create",
      requesterName: "Alice",
      reviewerName: "Bob",
    })
    expect(subject).toMatch(/[əğşıöü]/)
  })
})
