/**
 * 2026-08-03 — what to do next, without asking the AI.
 *
 * The owner: the process has to be shown to the user simply, so the whole
 * thing is intuitive.
 *
 * Two things stood between the panel and that. The advice only appeared after
 * pressing "Explain" — an LLM round-trip, billed, several seconds, and
 * occasionally unavailable — so the screen's default state told a person a
 * problem existed and nothing about what to do with it. And the one button
 * that did navigate said "Go to the problem", which is not a destination: the
 * code→tab map it used was real, deterministic and buried inside the click
 * handler where nothing could show it or test it.
 *
 * None of that needs a model. Every issue this panel raises is one of six
 * known codes, each with a known place in the UI and a known next move. That
 * mapping is data, so it lives here — visible by default, testable, and free.
 *
 * The LLM explanation stays exactly where it was, for the cases where a person
 * wants the reasoning rather than the route.
 */

/** The review tabs the import screen can open. Mirrors `ReviewTabKey`. */
export type DoctorTargetTab =
  | "analysis"
  | "fixes"
  | "coa"
  | "conflicts"
  | "routing"
  | "receipt"
  | "warnings"

export interface DoctorNextStep {
  /** i18n key under `doctor.nextStep` — one plain sentence. */
  key: string
  /** Tab to open, or null when the target is not behind a tab (a page-level banner). */
  tab: DoctorTargetTab | null
  /**
   * True when the issue does NOT stop the import. The panel leads with the
   * action either way, but a warning must not be dressed as a wall: the
   * routing list is 25 sheets of information and reads as a failure unless
   * something says otherwise.
   */
  canProceed: boolean
}

/**
 * The next move for an issue code.
 *
 * `canProceed` is the field that changes what a reader does with the panel.
 * `routing_uncertain` and `preview_stale` are advisory — the import runs — and
 * saying so is the difference between an operator pressing Apply and an
 * operator waiting for someone to tell them it is safe. The three blocking
 * codes get a route to the thing they must resolve first.
 *
 * An unknown code returns the generic step rather than nothing: a new issue
 * type should degrade to "open the receipt and read it", never to a panel with
 * no way forward.
 */
export function doctorNextStep(code: string): DoctorNextStep {
  switch (code) {
    case "cross_file_conflict":
      return { key: "crossFileConflict", tab: "conflicts", canProceed: false }
    case "coa_review_required":
      return { key: "coaReviewRequired", tab: "coa", canProceed: false }
    case "reconciliation_blocked":
      return { key: "reconciliationBlocked", tab: "warnings", canProceed: false }
    case "preview_stale":
      return { key: "previewStale", tab: "fixes", canProceed: true }
    case "routing_uncertain":
      return { key: "routingUncertain", tab: "fixes", canProceed: true }
    case "import_failed":
      // The error banner sits outside the tabs — there is no tab to open.
      return { key: "importFailed", tab: null, canProceed: false }
    default:
      return { key: "generic", tab: "receipt", canProceed: false }
  }
}
