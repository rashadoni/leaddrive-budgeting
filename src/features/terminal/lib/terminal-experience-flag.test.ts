/**
 * Phase 10 / Stage A4 — Risk Terminal 2.0 rollout flags.
 *
 * The suite name is mandated by `05-TEST-UAT-ROLLOUT.md` §6
 * (`terminal-experience-flag.test.ts`), which also requires the behavioural
 * assertion "feature flags resolve consistently in server and client render".
 *
 * The load-bearing test here is E-1: an empty allowlist enables nobody, even
 * with the master flag on. Everything else is a rollout convenience; that one
 * is the difference between a 3-5 company pilot and an unreviewed cutover for
 * the whole holding.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  resolveTerminalExperienceFlags,
  TERMINAL_EXPERIENCE_VIEWS,
  type TerminalExperienceInitialState,
} from "./terminal-experience-flag"

const FLAG_VARS = [
  "RISK_TERMINAL_V2_ENABLED",
  "RISK_TERMINAL_V2_ORG_ALLOWLIST",
  "RISK_TERMINAL_V2_DEFAULT_VIEW",
  "RISK_TERMINAL_V2_AI_AUTORUN",
] as const

describe("terminal-experience-flag", () => {
  const original = new Map<string, string | undefined>()

  beforeEach(() => {
    // Snapshot then clear: an inherited value from the developer's real .env
    // would otherwise silently decide these assertions.
    for (const key of FLAG_VARS) {
      original.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of FLAG_VARS) {
      const value = original.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  describe("all flags off by default", () => {
    it("resolves disabled/expert/no-autorun when nothing is configured", () => {
      expect(resolveTerminalExperienceFlags("org-1")).toEqual({
        v2Enabled: false,
        defaultView: "expert",
        aiAutorun: false,
      })
    })

    it("stays disabled for a null or empty organization", () => {
      for (const orgId of [null, undefined, ""]) {
        expect(resolveTerminalExperienceFlags(orgId).v2Enabled).toBe(false)
      }
    })
  })

  describe("empty allowlist is a valid disabled state (rule E-1)", () => {
    it("enables nobody even when the master flag is on", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = ""

      for (const orgId of ["org-1", "org-2", "", null]) {
        expect(resolveTerminalExperienceFlags(orgId)).toEqual({
          v2Enabled: false,
          defaultView: "expert",
          aiAutorun: false,
        })
      }
    })

    it.each([" ", ",", " , , ", "\t\n"])(
      "treats the effectively-empty allowlist %j as disabled",
      (allowlist) => {
        process.env.RISK_TERMINAL_V2_ENABLED = "true"
        process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = allowlist

        expect(resolveTerminalExperienceFlags("org-1").v2Enabled).toBe(false)
      },
    )

    it("does not treat '*' as a wildcard", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "*"

      expect(resolveTerminalExperienceFlags("org-1").v2Enabled).toBe(false)
      // ...though an org literally named "*" would match, which is a
      // non-issue for cuid org IDs and keeps the rule "exact match, no magic".
      expect(resolveTerminalExperienceFlags("*").v2Enabled).toBe(true)
    })
  })

  describe("organization absent from the allowlist", () => {
    it("stays disabled while a listed sibling is enabled", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"

      expect(resolveTerminalExperienceFlags("org-other").v2Enabled).toBe(false)
      expect(resolveTerminalExperienceFlags("org-pilot").v2Enabled).toBe(true)
    })

    it("compares organization IDs case-sensitively", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-Pilot"

      expect(resolveTerminalExperienceFlags("org-pilot").v2Enabled).toBe(false)
      expect(resolveTerminalExperienceFlags("org-Pilot").v2Enabled).toBe(true)
    })

    it("does not match on a prefix or substring", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot-1"

      expect(resolveTerminalExperienceFlags("org-pilot").v2Enabled).toBe(false)
      expect(resolveTerminalExperienceFlags("org").v2Enabled).toBe(false)
    })

    it("keeps the master flag authoritative over allowlist membership", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "false"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"

      expect(resolveTerminalExperienceFlags("org-pilot").v2Enabled).toBe(false)
    })
  })

  describe("organization present in the allowlist", () => {
    it("enables V2 and honours the configured default view", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
      process.env.RISK_TERMINAL_V2_DEFAULT_VIEW = "today"

      expect(resolveTerminalExperienceFlags("org-pilot")).toEqual({
        v2Enabled: true,
        defaultView: "today",
        aiAutorun: false,
      })
    })

    it("matches any entry in a multi-org list, ignoring padding and blanks", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST =
        " org-a , org-b ,, org-c ,org-a "

      for (const orgId of ["org-a", "org-b", "org-c"]) {
        expect(resolveTerminalExperienceFlags(orgId).v2Enabled).toBe(true)
      }
      expect(resolveTerminalExperienceFlags("org-d").v2Enabled).toBe(false)
    })

    it.each(TERMINAL_EXPERIENCE_VIEWS)("accepts the canonical view %s", (view) => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
      process.env.RISK_TERMINAL_V2_DEFAULT_VIEW = view

      expect(resolveTerminalExperienceFlags("org-pilot").defaultView).toBe(view)
    })

    it("enables AI autorun only when explicitly turned on", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
      process.env.RISK_TERMINAL_V2_AI_AUTORUN = "true"

      expect(resolveTerminalExperienceFlags("org-pilot").aiAutorun).toBe(true)
    })

    it("keeps autorun subordinate to V2 for a non-piloted org", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
      process.env.RISK_TERMINAL_V2_AI_AUTORUN = "true"
      process.env.RISK_TERMINAL_V2_DEFAULT_VIEW = "today"

      // Neither paid AI nor the modern view may leak to an org outside the pilot.
      expect(resolveTerminalExperienceFlags("org-other")).toEqual({
        v2Enabled: false,
        defaultView: "expert",
        aiAutorun: false,
      })
    })
  })

  describe("malformed env values fail closed", () => {
    it.each(["1", "yes", "on", "TRUE!", "garbage", " ", "0", "false"])(
      "does not accept %j as a truthy master flag",
      (raw) => {
        process.env.RISK_TERMINAL_V2_ENABLED = raw
        process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"

        expect(resolveTerminalExperienceFlags("org-pilot").v2Enabled).toBe(false)
      },
    )

    it.each(["TRUE", "True", " true "])(
      "accepts %j as the literal true",
      (raw) => {
        process.env.RISK_TERMINAL_V2_ENABLED = raw
        process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"

        expect(resolveTerminalExperienceFlags("org-pilot").v2Enabled).toBe(true)
      },
    )

    it.each(["1", "yes", "on", "garbage", ""])(
      "does not accept %j as a truthy autorun flag",
      (raw) => {
        process.env.RISK_TERMINAL_V2_ENABLED = "true"
        process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
        process.env.RISK_TERMINAL_V2_AI_AUTORUN = raw

        expect(resolveTerminalExperienceFlags("org-pilot").aiAutorun).toBe(false)
      },
    )

    it.each(["dashboard", "TODAY!", "data_health", "", " ", "expert2"])(
      "falls back to expert for the unknown view %j",
      (raw) => {
        process.env.RISK_TERMINAL_V2_ENABLED = "true"
        process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
        process.env.RISK_TERMINAL_V2_DEFAULT_VIEW = raw

        expect(resolveTerminalExperienceFlags("org-pilot").defaultView).toBe(
          "expert",
        )
      },
    )

    it.each([" TODAY ", "Data-Health"])(
      "normalizes case and padding for the known view %j",
      (raw) => {
        process.env.RISK_TERMINAL_V2_ENABLED = "true"
        process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
        process.env.RISK_TERMINAL_V2_DEFAULT_VIEW = raw

        expect(resolveTerminalExperienceFlags("org-pilot").defaultView).toBe(
          raw.trim().toLowerCase(),
        )
      },
    )
  })

  describe("SSR/client contract", () => {
    it("returns only JSON primitives, so props cannot diverge in transit", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
      process.env.RISK_TERMINAL_V2_DEFAULT_VIEW = "today"
      process.env.RISK_TERMINAL_V2_AI_AUTORUN = "true"

      const state = resolveTerminalExperienceFlags("org-pilot")

      // Exactly the decision — no allowlist, no raw env, no Set/Date/function.
      expect(Object.keys(state).sort()).toEqual([
        "aiAutorun",
        "defaultView",
        "v2Enabled",
      ])
      expect(typeof state.v2Enabled).toBe("boolean")
      expect(typeof state.aiAutorun).toBe("boolean")
      expect(typeof state.defaultView).toBe("string")
      expect(JSON.parse(JSON.stringify(state))).toEqual(state)
    })

    it("hydrates from the serialized server payload without divergence", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
      process.env.RISK_TERMINAL_V2_DEFAULT_VIEW = "today"

      const serverState = resolveTerminalExperienceFlags("org-pilot")
      const wire = JSON.stringify(serverState)

      // The browser bundle has no rollout env vars at all. Simulate that: if
      // any client code re-read env instead of consuming the prop, it would now
      // compute expert/disabled and hydration would mismatch the server HTML.
      for (const key of FLAG_VARS) delete process.env[key]

      const clientState = JSON.parse(wire) as TerminalExperienceInitialState

      expect(clientState).toEqual(serverState)
      expect(clientState.v2Enabled).toBe(true)
      expect(clientState.defaultView).toBe("today")
    })

    it("reads env per call so a flag flip does not need a redeploy", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
      expect(resolveTerminalExperienceFlags("org-pilot").v2Enabled).toBe(true)

      // The documented emergency rollback (05 §13).
      process.env.RISK_TERMINAL_V2_ENABLED = "false"
      expect(resolveTerminalExperienceFlags("org-pilot").v2Enabled).toBe(false)
    })

    it("resolves identically for repeated calls with unchanged env", () => {
      process.env.RISK_TERMINAL_V2_ENABLED = "true"
      process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST = "org-pilot"
      process.env.RISK_TERMINAL_V2_DEFAULT_VIEW = "today"

      // Whatever the server render computed, a second render of the same
      // request resolves the same — no module-load cache, no call-order effect.
      expect(resolveTerminalExperienceFlags("org-pilot")).toEqual(
        resolveTerminalExperienceFlags("org-pilot"),
      )
    })
  })
})
