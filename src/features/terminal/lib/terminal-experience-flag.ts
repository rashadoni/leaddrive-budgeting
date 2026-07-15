/**
 * Phase 10 / Stage A4 — server-resolved operational flags for Risk Terminal 2.0.
 *
 *   RISK_TERMINAL_V2_ENABLED=false        master switch
 *   RISK_TERMINAL_V2_ORG_ALLOWLIST=       comma-separated exact org IDs
 *   RISK_TERMINAL_V2_DEFAULT_VIEW=expert  view for enabled orgs
 *   RISK_TERMINAL_V2_AI_AUTORUN=false     paid-AI-on-entry permission
 *
 * These are operational rollout flags, not commercial entitlements
 * (`04-TECHNICAL-IMPLEMENTATION-PLAN.md` §9, ADR Experience Shell §5).
 *
 * **Server-only.** Resolve here, on the server, and pass the returned DTO to
 * the client as initial state. A client component must never read these env
 * vars itself: the values are absent in the browser bundle, so a client-side
 * read renders `false`/`expert` while the server rendered the real value —
 * exactly the SSR/hydration divergence the plan names as a `medium/high` risk.
 * Nothing here may be re-exported through a `"use client"` module, and none of
 * these vars may ever be renamed to `NEXT_PUBLIC_*`.
 *
 * **Fails closed (approved rule E-1).** V2 needs the master flag AND exact
 * membership in the allowlist. An empty allowlist is a valid *disabled* state,
 * not a wildcard: `RISK_TERMINAL_V2_ENABLED=true` with an empty list enables
 * nobody. `*` is not special. This is the difference between a deliberate
 * pilot and an accidental holding-wide cutover.
 *
 * Env is read inside the exported function on every call, per the pattern in
 * `src/lib/queue/feature-flag.ts` — a module-level constant would freeze at
 * import time and make the documented rollback (flip the flag, restart) a
 * redeploy instead.
 */

/** View identifiers from ADR Experience Shell §6 ("URL is the view state"). */
export const TERMINAL_EXPERIENCE_VIEWS = [
  "today",
  "portfolio",
  "company",
  "scenarios",
  "data-health",
  "expert",
] as const

export type TerminalExperienceView = (typeof TERMINAL_EXPERIENCE_VIEWS)[number]

/** Legacy view — the rollback target and the default for everyone not piloting. */
const FALLBACK_VIEW: TerminalExperienceView = "expert"

/**
 * The wire contract handed to the client. JSON primitives only: it crosses the
 * server/client boundary as serialized props, so a `Set`, a `Date` or a raw env
 * string would either fail to serialize or leak rollout configuration into the
 * browser. The allowlist deliberately does not appear here — the client learns
 * the decision, never the roster.
 */
export interface TerminalExperienceInitialState {
  readonly v2Enabled: boolean
  readonly defaultView: TerminalExperienceView
  readonly aiAutorun: boolean
}

/** Only a literal `true` enables. `1`, `yes`, `on` and junk all fail closed. */
function parseBooleanFlag(raw: string | undefined): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true"
}

/**
 * Exact org IDs. Entry whitespace is tolerated (operators paste from a doc);
 * the IDs themselves are opaque and compared case-sensitively, so a typo fails
 * closed rather than matching the wrong tenant.
 */
function parseOrgAllowlist(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
}

function parseDefaultView(raw: string | undefined): TerminalExperienceView {
  const value = String(raw ?? "").trim().toLowerCase()
  return (
    TERMINAL_EXPERIENCE_VIEWS.find((view) => view === value) ?? FALLBACK_VIEW
  )
}

/**
 * Resolve the flags for one organization. Call from a server boundary only.
 *
 * @param organizationId Session-derived org ID. Never accept this from the
 *   client: it decides V2 eligibility. Null/empty fails closed.
 */
export function resolveTerminalExperienceFlags(
  organizationId: string | null | undefined,
): TerminalExperienceInitialState {
  const allowlist = parseOrgAllowlist(process.env.RISK_TERMINAL_V2_ORG_ALLOWLIST)

  // E-1: master flag AND explicit membership. Empty allowlist → nobody.
  const v2Enabled =
    parseBooleanFlag(process.env.RISK_TERMINAL_V2_ENABLED) &&
    organizationId != null &&
    organizationId.length > 0 &&
    allowlist.has(organizationId)

  return {
    v2Enabled,
    // A disabled org gets the legacy view regardless of configuration: the
    // default view is meaningless without V2, and echoing it back would invite
    // a caller to route on it.
    defaultView: v2Enabled
      ? parseDefaultView(process.env.RISK_TERMINAL_V2_DEFAULT_VIEW)
      : FALLBACK_VIEW,
    // Autorun is subordinate to V2: a disabled org must never be told paid AI
    // may run on entry (plan §"remove auto-run", risk `AI prewarm spends money`).
    aiAutorun:
      v2Enabled && parseBooleanFlag(process.env.RISK_TERMINAL_V2_AI_AUTORUN),
  }
}
