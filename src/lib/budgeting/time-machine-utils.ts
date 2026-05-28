export interface TimePoint {
  timestamp: string
  changeCount: number
  summary: string
}

/** Phase 8 D3(j) (2026-05-28) — `oldValue` / `newValue` / `snapshot` are
 *  audit-log Json blobs; their shape varies per `entityType` + `action`.
 *  Use `unknown` so callers must narrow before reading (was `any` and
 *  silently let consumers read undefined fields without compile error). */
export interface ChangeLogEntry {
  id: string
  entityId: string
  entityType: string
  action: string
  field?: string | null
  oldValue?: unknown
  newValue?: unknown
  snapshot?: unknown
  createdAt: string
}

/** Minimum structural shape of a BudgetLine row consumed by the
 *  time-machine diff. Mirrors the columns we read (id + plannedAmount +
 *  forecastAmount + the CoA join). Extra fields on a real row are
 *  ignored. */
export interface TimeMachineLine {
  id: string
  plannedAmount?: number | null
  forecastAmount?: number | null
  accountId?: string | null
  account?: { code?: string | null } | null
}

/** Minimum structural shape of a BudgetActual row consumed by the
 *  time-machine diff. */
export interface TimeMachineActual {
  category: string
  lineType: string
  actualAmount: number
}

/**
 * Detect which cells changed between two snapshots.
 * Returns a Map of cellKey → "increase" | "decrease" | "other"
 */
export function getChangedCells(
  prevLines: TimeMachineLine[],
  currentLines: TimeMachineLine[],
  prevActuals: TimeMachineActual[],
  currentActuals: TimeMachineActual[],
): Map<string, "increase" | "decrease" | "other"> {
  const changed = new Map<string, "increase" | "decrease" | "other">()

  // Build lookup for previous state
  const prevLineMap = new Map(prevLines.map((l) => [l.id, l]))

  // Compare lines
  for (const line of currentLines) {
    const prev = prevLineMap.get(line.id)
    if (!prev) {
      // New line
      changed.set(`line:${line.id}:plannedAmount`, "other")
      continue
    }
    for (const field of ["plannedAmount", "forecastAmount"] as const) {
      const oldVal = Number(prev[field] ?? 0)
      const newVal = Number(line[field] ?? 0)
      if (oldVal !== newVal) {
        changed.set(`line:${line.id}:${field}`, newVal > oldVal ? "increase" : "decrease")
      }
    }
    if ((prev.account?.code ?? prev.accountId) !== (line.account?.code ?? line.accountId)) {
      changed.set(`line:${line.id}:account`, "other")
    }
  }

  // Detect deleted lines
  const currentLineIds = new Set(currentLines.map((l) => l.id))
  for (const prev of prevLines) {
    if (!currentLineIds.has(prev.id)) {
      changed.set(`line:${prev.id}:deleted`, "decrease")
    }
  }

  // Compare actuals by category
  const currActualByCat = new Map<string, number>()
  for (const a of currentActuals) {
    const key = `${a.category}||${a.lineType}`
    currActualByCat.set(key, (currActualByCat.get(key) || 0) + Number(a.actualAmount || 0))
  }
  const prevActualByCat = new Map<string, number>()
  for (const a of prevActuals) {
    const key = `${a.category}||${a.lineType}`
    prevActualByCat.set(key, (prevActualByCat.get(key) || 0) + Number(a.actualAmount || 0))
  }

  const allCatKeys = new Set([...currActualByCat.keys(), ...prevActualByCat.keys()])
  for (const key of allCatKeys) {
    const oldVal = prevActualByCat.get(key) || 0
    const newVal = currActualByCat.get(key) || 0
    if (oldVal !== newVal) {
      changed.set(`actual:${key}`, newVal > oldVal ? "increase" : "decrease")
    }
  }

  return changed
}

/**
 * Get CSS class for heatmap flash based on change direction
 */
export function getFlashClass(direction: "increase" | "decrease" | "other"): string {
  switch (direction) {
    case "increase":
      return "animate-budget-flash-green"
    case "decrease":
      return "animate-budget-flash-red"
    default:
      return "animate-budget-flash-yellow"
  }
}

/**
 * Format a timestamp for display on the timeline
 */
export function formatTimePoint(timestamp: string): string {
  const d = new Date(timestamp)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
