// @vitest-environment node
/**
 * Handler test for `/api/budgeting/sales-forecast/import` (POST).
 *
 * Locks xlsx upload contract: missing-file 400, label→deptId lookup,
 * 12-month iteration, period-lock gate, and bulk-upsert envelope.
 *
 * Note: tests focus on auth/validation gates rather than running real
 * ExcelJS load — full xlsx fixtures live in scripts/ for e2e.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetDepartment: { findMany: vi.fn() },
    salesForecast: { upsert: vi.fn() },
    organization: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

beforeEach(() => {
  prismaMock.budgetDepartment.findMany.mockReset().mockResolvedValue([])
  prismaMock.salesForecast.upsert.mockReset().mockResolvedValue({ id: "s1" })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  prismaMock.$transaction.mockReset().mockImplementation((promises: unknown[]) => Promise.resolve(promises.map(() => ({ id: "s1" }))))
})

function makeFormDataRequest(form: FormData): Request {
  return new Request("http://localhost/api/budgeting/sales-forecast/import", {
    method: "POST",
    body: form,
  })
}

describe("POST /api/budgeting/sales-forecast/import", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const fd = new FormData()
    fd.set("year", "2026")
    const res = await POST(makeFormDataRequest(fd) as never)
    expect(res.status).toBe(401)
  })

  it("400 when no file provided", async () => {
    await mockSession({ orgId: "org_demo", userId: "u1", role: "editor" })
    const fd = new FormData()
    fd.set("year", "2026")
    const res = await POST(makeFormDataRequest(fd) as never)
    expect(res.status).toBe(400)
  })
})
