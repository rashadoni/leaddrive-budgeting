/**
 * Pure helper extracted from PLTab's `buildGrouped`. Splits a list of
 * BudgetCategoryRow-shaped rows into two buckets:
 *
 *   - `groups`: rows with `parentCategory` set, grouped by their parent
 *   - `standalone`: rows without `parentCategory`
 *
 * Drives the P&L parent-child rendering pattern where parent rows
 * collapse to a single summary line with children expandable beneath.
 *
 * Generic over row shape — caller passes BudgetCategoryRow but only
 * `parentCategory: string | null | undefined` is consumed.
 */

export interface ParentAware {
  parentCategory?: string | null
}

export interface GroupedRows<T extends ParentAware> {
  groups: Array<{ parent: string; children: T[] }>
  standalone: T[]
}

export function groupByParent<T extends ParentAware>(rows: T[]): GroupedRows<T> {
  const groups: GroupedRows<T>["groups"] = []
  const standalone: T[] = []
  const groupMap = new Map<string, T[]>()
  for (const r of rows) {
    if (r.parentCategory) {
      const existing = groupMap.get(r.parentCategory) ?? []
      existing.push(r)
      groupMap.set(r.parentCategory, existing)
    } else {
      standalone.push(r)
    }
  }
  for (const [parent, children] of groupMap) {
    groups.push({ parent, children })
  }
  return { groups, standalone }
}
