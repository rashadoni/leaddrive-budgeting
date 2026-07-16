/**
 * Compute the set of keys that differ between `before` and `after`.
 * Considers keys that were added, removed or changed.
 *
 * Kept outside `route.ts` because Next.js route modules may export only HTTP
 * handlers and supported route configuration fields.
 */
export function computeKeysChanged(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  const beforeKeys = before ? new Set(Object.keys(before)) : new Set<string>()
  const afterKeys = new Set(Object.keys(after))
  const changed = new Set<string>()

  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      changed.add(key)
      continue
    }
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after[key])) {
      changed.add(key)
    }
  }

  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) changed.add(key)
  }

  return [...changed].sort()
}
