const ELIMINATION_ENTITY_RE =
  /\b(eje|aje|elim|elimination|eliminasiya|intercompany|intragroup|consolidation|consolidated|consol)\b/i

export function normalizeEntityAlias(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase()
}

export function isEliminationLikeEntityValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  const normalized = normalizeEntityAlias(String(value))
  return normalized.length > 0 && ELIMINATION_ENTITY_RE.test(normalized)
}
