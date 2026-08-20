import { beforeEach, describe, expect, it, vi } from "vitest"

const { nextAuthMock, prismaMock } = vi.hoisted(() => ({
  nextAuthMock: vi.fn((_config: unknown) => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
  })),
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("next-auth", () => ({ default: nextAuthMock }))
vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((config: unknown) => config),
}))
vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: vi.fn(() => ({})),
}))
vi.mock("./db/prisma-admin", () => ({ prismaAdmin: prismaMock }))
vi.mock("./log", () => ({
  getLogger: vi.fn(() => ({ error: vi.fn() })),
}))
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn() },
}))

import "./auth"

type AuthConfig = {
  callbacks: {
    jwt: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
    session: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
  }
}

const config = nextAuthMock.mock.calls[0]?.[0] as AuthConfig

function activeUser(authVersion: number) {
  return {
    role: "viewer",
    isActive: true,
    authVersion,
    organizationId: "org-1",
    organization: { name: "Org One" },
  }
}

beforeEach(() => {
  prismaMock.user.findUnique.mockReset().mockResolvedValue(activeUser(4))
})

describe("Auth.js session version callbacks", () => {
  it("looks up the immutable token subject, not a tenant-ambiguous email", async () => {
    await config.callbacks.jwt({
      token: {
        sub: "user-in-org-1",
        email: "shared@example.com",
        authVersion: 4,
      },
      user: null,
    })
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-in-org-1" } }),
    )
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it("rejects a JWT after password rotation increments authVersion", async () => {
    const token = await config.callbacks.jwt({
      token: { sub: "user-1", authVersion: 3 },
      user: null,
    })
    expect(token.invalidated).toBe(true)

    const session = await config.callbacks.session({
      session: { user: { id: "user-1" } },
      token,
    })
    expect(session.user).toBeUndefined()
  })

  it("fails legacy JWTs without a version closed", async () => {
    const token = await config.callbacks.jwt({
      token: { sub: "user-1" },
      user: null,
    })
    expect(token.invalidated).toBe(true)
  })

  it("rejects inactive users even when the version matches", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...activeUser(4),
      isActive: false,
    })
    const token = await config.callbacks.jwt({
      token: { sub: "user-1", authVersion: 4 },
      user: null,
    })
    expect(token.invalidated).toBe(true)
  })

  it("accepts a fresh login and records the database version", async () => {
    const token = await config.callbacks.jwt({
      token: {},
      user: { id: "user-1" },
    })
    expect(token.sub).toBe("user-1")
    expect(token.authVersion).toBe(4)
    expect(token.invalidated).toBe(false)
  })
})
