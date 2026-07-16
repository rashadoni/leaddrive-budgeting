import { describe, expect, it } from "vitest"

import { hasRole, type Role } from "./permissions"

const roles: Role[] = ["admin", "manager", "editor", "viewer"]

describe("hasRole", () => {
  const allowed: Record<Role, Role[]> = {
    admin: roles,
    manager: ["manager", "editor", "viewer"],
    editor: ["editor", "viewer"],
    viewer: ["viewer"],
  }

  it.each(roles)("enforces the hierarchy for %s", (role) => {
    for (const minimum of roles) {
      expect(hasRole(role, minimum)).toBe(allowed[role].includes(minimum))
    }
  })

  it.each([undefined, null, "", "owner", "ADMIN"])(
    "denies unknown or missing role %s",
    (role) => {
      for (const minimum of roles) {
        expect(hasRole(role, minimum)).toBe(false)
      }
    },
  )
})
