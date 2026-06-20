/**
 * Pure helpers for the Onboarding wizard's user-override flow.
 *
 * The wizard caches the AI proposal in client state and lets the reviewer
 * flip a column's role (e.g. "AI marked this `skip`, it's actually
 * `amount:Jan`"). We send the changed columns as `userOverrides` to the
 * /apply endpoint — applier.ts merges them on top of the saved proposal.
 *
 * Kept separate from the React component so it's unit-testable without
 * jsdom / DOM mocks.
 */

import type {
  Anomaly,
  ColumnMappingProposal,
  MappingProposal,
} from "@/lib/onboarding/ai-mapper/types"

/**
 * Stable role buckets shown in the override <select>. Typing the `value`
 * field against `ColumnMappingProposal["role"]` keeps the union honest —
 * a stale entry breaks the build instead of slipping through as a string
 * the apply endpoint then has to reject at runtime.
 */
export const ROLE_OPTIONS: Array<{
  value: ColumnMappingProposal["role"]
  label: string
}> = [
  { value: "code", label: "Account code" },
  { value: "label", label: "Label / description" },
  { value: "entity", label: "Entity / company (BU split)" },
  { value: "amount:Total", label: "Amount — Total (annual)" },
  { value: "amount:Plan", label: "Amount — Plan" },
  { value: "amount:Actual", label: "Amount — Actual" },
  { value: "amount:Jan", label: "Amount — Jan" },
  { value: "amount:Feb", label: "Amount — Feb" },
  { value: "amount:Mar", label: "Amount — Mar" },
  { value: "amount:Apr", label: "Amount — Apr" },
  { value: "amount:May", label: "Amount — May" },
  { value: "amount:Jun", label: "Amount — Jun" },
  { value: "amount:Jul", label: "Amount — Jul" },
  { value: "amount:Aug", label: "Amount — Aug" },
  { value: "amount:Sep", label: "Amount — Sep" },
  { value: "amount:Oct", label: "Amount — Oct" },
  { value: "amount:Nov", label: "Amount — Nov" },
  { value: "amount:Dec", label: "Amount — Dec" },
  { value: "skip", label: "Skip (ignore)" },
]

/**
 * Diff the user's edited columns against the AI's original proposal.
 * Only changed columns travel as overrides — keeps the payload small and
 * makes the audit trail in `ImportStaging.userOverrides` minimal.
 */
export function diffColumnOverrides(
  original: ColumnMappingProposal[],
  edited: ColumnMappingProposal[],
): ColumnMappingProposal[] {
  const byIdx = new Map<number, ColumnMappingProposal>()
  for (const c of original) byIdx.set(c.sourceIndex, c)
  const changed: ColumnMappingProposal[] = []
  for (const e of edited) {
    const orig = byIdx.get(e.sourceIndex)
    if (!orig || orig.role !== e.role) {
      changed.push({
        sourceIndex: e.sourceIndex,
        role: e.role,
        // Manual override sets confidence to 1.0 — the human is the source.
        confidence: 1,
        reasoning: orig
          ? `Manual override (was: ${orig.role})`
          : "Manual override",
      })
    }
  }
  return changed
}

/**
 * Build the `userOverrides` JSON for /apply. Returns `undefined` when
 * nothing changed so the form field can be omitted entirely.
 */
export function buildUserOverrides(
  proposal: MappingProposal,
  edited: ColumnMappingProposal[],
): Partial<MappingProposal> | undefined {
  const changed = diffColumnOverrides(proposal.columns, edited)
  if (changed.length === 0) return undefined
  return { columns: changed }
}

/**
 * Severity → tailwind classes. Typed against the `Anomaly['severity']`
 * union so adding a new severity value forces a UI update instead of
 * silently rendering with `Record<string, string>`'s `|| ""` fallback.
 */
export const ANOMALY_SEVERITY_BG: Record<Anomaly["severity"], string> = {
  critical: "bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-200",
  warning: "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-200",
  info: "bg-sky-500/10 border-sky-500/40 text-sky-700 dark:text-sky-200",
}

/** Human-friendly confidence band for the column-role tooltip. */
export function confidenceBand(c: number): "high" | "med" | "low" {
  if (c >= 0.85) return "high"
  if (c >= 0.6) return "med"
  return "low"
}
