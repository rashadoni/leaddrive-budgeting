import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { authMock, resolveRequestAuthMock, handlersGetMock, getTokenMock, userFindUniqueMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  resolveRequestAuthMock: vi.fn(),
  handlersGetMock: vi.fn(),
  getTokenMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}))

vi.mock("./auth", () => ({
  auth: authMock,
  handlers: { GET: handlersGetMock },
}))

vi.mock("next-auth/jwt", () => ({
  getToken: getTokenMock,
}))

vi.mock("./db/prisma-admin", () => ({
  prismaAdmin: { user: { findUnique: userFindUniqueMock } },
}))

import { getSession } from "./api-auth"

function request(cookie = "__Secure-authjs.session-token=opaque") {
  return new NextRequest("https://budget.example/api/users", {
    headers: { cookie },
  })
}

describe("getSession", () => {
  beforeEach(() => {
    authMock.mockReset()
    authMock.mockReturnValue(resolveRequestAuthMock)
    resolveRequestAuthMock.mockReset()
    resolveRequestAuthMock.mockResolvedValue(
      new Response(JSON.stringify(null), {
        headers: { "content-type": "application/json" },
      }),
    )
    handlersGetMock.mockReset()
    handlersGetMock.mockResolvedValue(
      new Response(JSON.stringify(null), {
        headers: { "content-type": "application/json" },
      }),
    )
    getTokenMock.mockReset()
    userFindUniqueMock.mockReset()
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret")
    vi.stubEnv("NEXTAUTH_URL", "https://budget.example")
  })

  it("decodes the explicit secure request cookie and revalidates the user", async () => {
    getTokenMock.mockResolvedValue({ sub: "user-1", authVersion: 4 })
    userFindUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      organizationId: "org-1",
      isActive: true,
      authVersion: 4,
    })
    const req = request()

    await expect(getSession(req)).resolves.toEqual({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      email: "admin@example.com",
      name: "Admin",
    })
    expect(getTokenMock).toHaveBeenCalledWith({
      req,
      secret: "test-secret",
      cookieName: "__Secure-authjs.session-token",
      secureCookie: true,
    })
  })

  it.each([
    ["plain cookie", "authjs.session-token=opaque", "authjs.session-token", false],
    ["chunked secure cookie", "__Secure-authjs.session-token.0=part; __Secure-authjs.session-token.1=part", "__Secure-authjs.session-token", true],
  ])("detects the %s name", async (_label, cookie, cookieName, secureCookie) => {
    getTokenMock.mockResolvedValue(null)
    const req = request(cookie)

    await expect(getSession(req)).resolves.toBeNull()
    expect(getTokenMock).toHaveBeenCalledWith({
      req,
      secret: "test-secret",
      cookieName,
      secureCookie,
    })
  })

  it.each([
    ["stale password version", { sub: "user-1", authVersion: 3 }, true, 4],
    ["inactive user", { sub: "user-1", authVersion: 4 }, false, 4],
    ["legacy token without version", { sub: "user-1" }, true, 4],
  ])("fails closed for %s in the explicit-token fallback", async (_label, token, isActive, authVersion) => {
    getTokenMock.mockResolvedValue(token)
    userFindUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      organizationId: "org-1",
      isActive,
      authVersion,
    })

    await expect(getSession(request())).resolves.toBeNull()
  })

  it("does not decode without a recognized session cookie", async () => {
    await expect(getSession(request("other=value"))).resolves.toBeNull()
    expect(getTokenMock).not.toHaveBeenCalled()
    expect(userFindUniqueMock).not.toHaveBeenCalled()
    expect(resolveRequestAuthMock).toHaveBeenCalled()
  })

  it("fails closed when token decoding throws", async () => {
    getTokenMock.mockRejectedValue(new Error("bad token"))
    await expect(getSession(request())).resolves.toBeNull()
    expect(userFindUniqueMock).not.toHaveBeenCalled()
  })

  it("uses the direct Auth.js session route when bundled JWT decoding returns null", async () => {
    getTokenMock.mockResolvedValue(null)
    handlersGetMock.mockResolvedValue(
      new Response(JSON.stringify({
        user: {
          id: "user-1",
          email: "admin@example.com",
          name: "Admin",
          role: "admin",
          organizationId: "org-1",
        },
      }), { headers: { "content-type": "application/json" } }),
    )
    const req = request()

    await expect(getSession(req)).resolves.toEqual({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      email: "admin@example.com",
      name: "Admin",
    })
    expect(handlersGetMock).toHaveBeenCalledTimes(1)
    const internalRequest = handlersGetMock.mock.calls[0][0] as NextRequest
    expect(internalRequest.url).toBe("https://budget.example/api/auth/session")
    expect(internalRequest.headers.get("cookie")).toBe(
      "__Secure-authjs.session-token=opaque",
    )
  })
})
