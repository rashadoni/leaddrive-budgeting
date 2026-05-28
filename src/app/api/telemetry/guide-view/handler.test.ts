/**
 * Phase 8 F2 (2026-05-28) — /api/telemetry/guide-view handler tests.
 *
 * Locks: body validation, optional auth (anonymous OK), insert shape,
 * graceful failure when DB write rejects.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    guideView: { create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "cmguideviewtestorg00000001"
const USER_ID = "u_guide_reader"

beforeEach(() => {
  prismaMock.guideView.create.mockReset().mockResolvedValue({})
})

describe("POST /api/telemetry/guide-view", () => {
  it("400 when lang is missing or invalid", async () => {
    await mockSession(null)
    const r1 = await POST(
      makeRequest("/api/telemetry/guide-view", { method: "POST", json: {} }),
    )
    expect(r1.status).toBe(400)
    const r2 = await POST(
      makeRequest("/api/telemetry/guide-view", {
        method: "POST",
        json: { lang: "klingon" },
      }),
    )
    expect(r2.status).toBe(400)
  })

  it("400 when body is not JSON", async () => {
    await mockSession(null)
    // makeRequest helper only exposes `json:` not raw `body:` — build
    // the NextRequest directly for this case to exercise the catch.
    const { NextRequest } = await import("next/server")
    const req = new NextRequest(
      new URL("http://localhost/api/telemetry/guide-view"),
      {
        method: "POST",
        body: "not-json",
        headers: { "content-type": "application/json" },
      } as ConstructorParameters<typeof NextRequest>[1],
    )
    const r = await POST(req)
    expect(r.status).toBe(400)
  })

  it("logs anonymous view (no session) with organizationId=null", async () => {
    await mockSession(null)
    const r = await POST(
      makeRequest("/api/telemetry/guide-view", {
        method: "POST",
        json: { lang: "ru" },
      }),
    )
    expect(r.status).toBe(200)
    expect(prismaMock.guideView.create).toHaveBeenCalledOnce()
    const data = prismaMock.guideView.create.mock.calls[0][0].data
    expect(data.lang).toBe("ru")
    expect(data.organizationId).toBeNull()
    expect(data.actorUserId).toBeNull()
    expect(data.anchor).toBeNull()
  })

  it("logs authenticated view with orgId + actorUserId stamped", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    const r = await POST(
      makeRequest("/api/telemetry/guide-view", {
        method: "POST",
        json: { lang: "en", anchor: "section-9-compliance" },
      }),
    )
    expect(r.status).toBe(200)
    const data = prismaMock.guideView.create.mock.calls[0][0].data
    expect(data.organizationId).toBe(ORG_ID)
    expect(data.actorUserId).toBe(USER_ID)
    expect(data.anchor).toBe("section-9-compliance")
  })

  it("truncates over-long anchor to 80 chars", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
    const longAnchor = "x".repeat(500)
    await POST(
      makeRequest("/api/telemetry/guide-view", {
        method: "POST",
        json: { lang: "en", anchor: longAnchor },
      }),
    )
    const data = prismaMock.guideView.create.mock.calls[0][0].data
    expect(data.anchor.length).toBeLessThanOrEqual(80)
  })

  it("returns 503 (silent failure path) when prisma write rejects", async () => {
    await mockSession(null)
    prismaMock.guideView.create.mockRejectedValueOnce(new Error("DB down"))
    const r = await POST(
      makeRequest("/api/telemetry/guide-view", {
        method: "POST",
        json: { lang: "en" },
      }),
    )
    expect(r.status).toBe(503)
  })
})
