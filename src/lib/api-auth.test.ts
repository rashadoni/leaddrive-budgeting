import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { authMock, resolveRequestAuthMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  resolveRequestAuthMock: vi.fn(),
}))

vi.mock("./auth", () => ({
  auth: authMock,
}))

import { getSession } from "./api-auth"

function request() {
  return new NextRequest("https://budget.example/api/users", {
    headers: { cookie: "__Secure-authjs.session-token=opaque" },
  })
}

function sessionResponse(
  user: Record<string, unknown> | null | undefined,
) {
  return new Response(JSON.stringify({ user }), {
    headers: { "content-type": "application/json" },
  })
}

describe("getSession", () => {
  beforeEach(() => {
    authMock.mockReset()
    authMock.mockReturnValue(resolveRequestAuthMock)
    resolveRequestAuthMock.mockReset()
  })

  it("resolves auth from the explicit App Router request", async () => {
    resolveRequestAuthMock.mockResolvedValue(
      sessionResponse({
        id: "user-1",
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
        organizationId: "org-1",
      }),
    )
    const req = request()

    await expect(getSession(req)).resolves.toEqual({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      email: "admin@example.com",
      name: "Admin",
    })
    expect(resolveRequestAuthMock).toHaveBeenCalledWith(req, {
      params: expect.any(Promise),
    })
  })

  it.each([
    ["missing user", null],
    ["missing organization", { id: "user-1", organizationId: "" }],
    ["missing user id", { id: "", organizationId: "org-1" }],
  ])("fails closed for %s", async (_label, user) => {
    resolveRequestAuthMock.mockResolvedValue(sessionResponse(user))

    await expect(getSession(request())).resolves.toBeNull()
  })

  it("fails closed when Auth.js session resolution throws", async () => {
    resolveRequestAuthMock.mockRejectedValue(new Error("request context lost"))

    await expect(getSession(request())).resolves.toBeNull()
  })
})
