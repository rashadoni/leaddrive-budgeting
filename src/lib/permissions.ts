/**
 * Client-safe role hierarchy shared by navigation and server auth guards.
 *
 * Keep this module free of `next/server`, NextAuth, Prisma, and other
 * server-only imports. Client components (notably the dashboard Sidebar)
 * need the pure `hasRole` predicate without pulling the authentication and
 * database graph into the browser bundle.
 */
export type Role = "admin" | "manager" | "editor" | "viewer"

const ROLE_RANK: Record<Role, number> = {
  admin: 40,
  manager: 30,
  editor: 20,
  viewer: 10,
}

/** Unknown and missing roles are denied by default. */
export function hasRole(
  role: string | undefined | null,
  minRole: Role,
): boolean {
  const rank = ROLE_RANK[role as Role] ?? 0
  return rank >= ROLE_RANK[minRole]
}
