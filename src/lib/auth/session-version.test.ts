import { describe, expect, it } from "vitest"
import { isSessionVersionCurrent } from "./session-version"

describe("isSessionVersionCurrent", () => {
  it("accepts an active user with the exact JWT version", () => {
    expect(
      isSessionVersionCurrent(3, { authVersion: 3, isActive: true }),
    ).toBe(true)
  })

  it("rejects a JWT issued before authVersion existed", () => {
    expect(
      isSessionVersionCurrent(undefined, { authVersion: 0, isActive: true }),
    ).toBe(false)
  })

  it("rejects a JWT after a password change increments the version", () => {
    expect(
      isSessionVersionCurrent(3, { authVersion: 4, isActive: true }),
    ).toBe(false)
  })

  it("rejects inactive or missing users", () => {
    expect(
      isSessionVersionCurrent(3, { authVersion: 3, isActive: false }),
    ).toBe(false)
    expect(isSessionVersionCurrent(3, null)).toBe(false)
  })
})
