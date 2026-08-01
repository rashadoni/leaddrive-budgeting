/**
 * Task state → request body. Pure, so the shape a red button sends is
 * testable without a browser.
 */
import { ALWAYS_INCLUDED, BUNDLES, type BundleId } from "./bundles"
import type { TaskId } from "./tier"
import type { ImportResetCategory } from "@/lib/server/import-reset-categories"
import { companyTarget } from "@/lib/server/delete-request"

export interface TaskState {
  task: TaskId
  /** Company codes the action covers. */
  companyCodes: string[]
  /** [] means every year. */
  years: number[]
  /** Which bundle is selected, when the "choose exactly" list is not in use. */
  bundle: BundleId
  /** Non-null when the operator opened "Choose exactly". */
  exactCategories: ImportResetCategory[] | null
  includeManualActuals: boolean
  reason: string
  confirmToken: string
  /** The row count the operator read on screen. */
  expectRows: number
}

export interface PreviewRequest {
  entityKind: "AllImportData"
  companyCode?: string
  companyCodes?: string[]
  year?: number
  years?: number[]
  include?: string[]
  includeUnscoped?: boolean
  includeManualActuals?: boolean
  yearIndex?: boolean
}

export interface CommitRequest extends PreviewRequest {
  mode: "archive"
  reason: string
  confirmCode: string
  expectRows: number
}

/** The categories a task state resolves to, always including indicators. */
export function categoriesFor(state: Pick<TaskState, "task" | "bundle" | "exactCategories">): ImportResetCategory[] {
  // Tasks B and D are deliberately not category-pickable: they mean
  // "everything, including the records", and their copy says so.
  if (state.task === "removeCompany" || state.task === "deleteAll") {
    return []
  }
  const chosen = state.exactCategories ?? BUNDLES[state.bundle]
  const set = new Set<ImportResetCategory>(chosen)
  set.add(ALWAYS_INCLUDED)
  return [...set]
}

export function buildPreviewRequest(
  state: Pick<
    TaskState,
    "task" | "companyCodes" | "years" | "bundle" | "exactCategories" | "includeManualActuals"
  >,
  options: { yearIndex?: boolean } = {},
): PreviewRequest {
  // The company shape is decided by `companyTarget` and NOWHERE else — the
  // same call the confirmation gate makes to learn which token this body will
  // be checked against. See `delete-request.ts`.
  const body: PreviewRequest = {
    entityKind: "AllImportData",
    ...companyTarget(state.companyCodes),
  }

  if (state.years.length === 1) body.year = state.years[0]
  else if (state.years.length > 1) body.years = [...state.years]

  const include = categoriesFor(state)
  if (include.length > 0) body.include = include

  if (state.task === "removeCompany" || state.task === "deleteAll") {
    // These two mean "everything ever imported", records included.
    body.includeUnscoped = true
    body.includeManualActuals = true
  } else if (state.includeManualActuals) {
    body.includeManualActuals = true
  }

  if (options.yearIndex) body.yearIndex = true
  return body
}

export function buildCommitRequest(state: TaskState): CommitRequest {
  return {
    ...buildPreviewRequest(state),
    mode: "archive",
    reason: state.reason.trim(),
    confirmCode: state.confirmToken,
    // Carries the number the operator actually read into the write, so a
    // change between reading and pressing is a 409 rather than a surprise.
    expectRows: state.expectRows,
  }
}
