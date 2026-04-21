// Re-export of role helpers from api-auth for callers that imported
// from `@/lib/permissions` before the helpers were centralised there.
// Keep this file thin — new code should import from `@/lib/api-auth` directly.
export type { Role } from "./api-auth"
export { hasRole, requireRole } from "./api-auth"
