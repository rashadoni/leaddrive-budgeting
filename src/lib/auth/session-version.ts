export interface SessionVersionUser {
  authVersion: number
  isActive: boolean
}

/** Missing versions are legacy JWTs and fail closed after this feature ships. */
export function isSessionVersionCurrent(
  tokenAuthVersion: number | undefined,
  user: SessionVersionUser | null | undefined,
): boolean {
  return Boolean(
    user?.isActive &&
      tokenAuthVersion != null &&
      tokenAuthVersion === user.authVersion,
  )
}
