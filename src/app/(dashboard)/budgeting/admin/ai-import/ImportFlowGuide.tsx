"use client"
/**
 * 11.54 (2026-07-31) — say what the screen is doing, to someone who does not
 * work here.
 *
 * The AI Import screen is the flagship demo: a client's own spreadsheet going
 * in and landing, cell by cell, in the right places. But the screen narrated
 * itself in engineer: "Routing yoxlaması", "Safety receipt", "elimination
 * atla", schema names like `BudgetLine.plannedAmount`. The product owner —
 * who built the thing — asked what "elimination atla" meant. If he has to
 * ask, the client will too.
 *
 * Two pieces here, both deliberately small:
 *
 *   `ImportFlowStrip`  — four steps with one plain sentence each, the current
 *                        one lit. It answers "where am I and what happens
 *                        next" without anyone reading a manual.
 *
 *   `ImportRunningBanner` — a live banner with an elapsed counter, shown for
 *                        BOTH steps. The old banner rendered on
 *                        `isProcessing && previewResult`, and submitting
 *                        Step 1 nulls `previewResult` first — so the 30-90
 *                        seconds of AI classification showed nothing at all
 *                        and read as a hang (11.42a, seen in a live
 *                        rehearsal). There is no server-side progress to
 *                        stream, so this reports the honest thing it can
 *                        know: what is running, and for how long.
 *
 * No animation beyond one spinner, no confetti. The screen's job on demo day
 * is to look like something a CFO would trust with their ledger.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

/**
 * Where a finished import should take you.
 *
 * 11.55 — the point of importing a workbook is the statement it produces, and
 * the receipt offered three admin destinations and no way to see the numbers.
 * One constant so the receipt button and the auto-redirect can never drift to
 * different pages.
 */
export const PNL_HREF = "/budgeting?tab=pnl-report"

export type FlowStepKey = "file" | "analyze" | "verify" | "write"

const STEP_ORDER: FlowStepKey[] = ["file", "analyze", "verify", "write"]

/** Past steps are ticked, the current one is lit, later ones stay muted. */
function stepState(
  step: FlowStepKey,
  current: FlowStepKey,
): "done" | "active" | "todo" {
  const i = STEP_ORDER.indexOf(step)
  const c = STEP_ORDER.indexOf(current)
  if (i < c) return "done"
  if (i === c) return "active"
  return "todo"
}

export function ImportFlowStrip({
  current,
  className = "",
}: {
  current: FlowStepKey
  className?: string
}) {
  const t = useTranslations("adminAiImport.multi.flow")
  return (
    <section
      className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}
      data-testid="import-flow-strip"
      aria-label={t("title")}
    >
      <h3 className="text-sm font-semibold text-slate-900">{t("title")}</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{t("intro")}</p>

      <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {STEP_ORDER.map((step, i) => {
          const state = stepState(step, current)
          return (
            <li
              key={step}
              data-testid={`flow-step-${step}`}
              data-state={state}
              aria-current={state === "active" ? "step" : undefined}
              className={`rounded-md border p-2.5 transition ${
                state === "active"
                  ? "border-emerald-400 bg-emerald-50 shadow-sm"
                  : state === "done"
                    ? "border-slate-200 bg-slate-50"
                    : "border-dashed border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                    state === "active"
                      ? "bg-emerald-600 text-white"
                      : state === "done"
                        ? "bg-slate-400 text-white"
                        : "bg-slate-200 text-slate-600"
                  }`}
                  aria-hidden
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span
                  className={`text-xs font-medium ${
                    state === "todo" ? "text-slate-500" : "text-slate-900"
                  }`}
                >
                  {t(`step.${step}.label` as never)}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-slate-600">
                {t(`step.${step}.hint` as never)}
              </p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** Past this many seconds the run is unusual enough to say so out loud. */
const SLOW_AFTER_SEC = 100

export function ImportRunningBanner({ phase }: { phase: "analyze" | "apply" }) {
  const t = useTranslations("adminAiImport.multi.flow")
  const [sec, setSec] = useState(0)

  useEffect(() => {
    // Remount per phase (see the `key` at the call site) so the counter
    // restarts rather than carrying Step 1's elapsed time into Step 2.
    setSec(0)
    const id = setInterval(() => setSec((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [phase])

  return (
    <div
      className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"
      data-testid={`import-running-${phase}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <svg
          className="h-4 w-4 shrink-0 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <span className="font-medium">{t(`running.${phase}` as never)}</span>
        <span
          className="ml-auto font-mono text-xs tabular-nums text-emerald-800"
          data-testid="import-running-elapsed"
          // Machine-readable so a test can pin the counter without depending
          // on the i18n string (the suite's next-intl mock returns stubs).
          data-elapsed={sec}
        >
          {t("running.elapsed", { sec })}
        </span>
      </div>
      <p className="mt-1 pl-6 text-xs text-emerald-800">
        {t(`running.${phase}Hint` as never)}
      </p>
      {sec >= SLOW_AFTER_SEC && (
        <p
          className="mt-1 pl-6 text-xs text-emerald-800"
          data-testid="import-running-slow"
        >
          {t("running.slow")}
        </p>
      )}
    </div>
  )
}

/** Seconds on screen before the P&L opens by itself. */
const REDIRECT_AFTER_SEC = 8

/**
 * 11.55 — after a committed import, go and look at the numbers.
 *
 * Requested as "open the P&L straight after the import". Done on a countdown
 * rather than instantly, and with a Stay button, for one reason: the safety
 * receipt IS the demo. It is the moment the screen proves it read the file
 * correctly — rows written, reconciliation GREEN, evidence db-readback — and
 * jumping away the instant it appears would throw that away, since the
 * receipt lives in client state and does not survive the navigation.
 *
 * Only mounted for a COMMITTED result. A rejected import must stay put: its
 * whole value is the reason it refused, and nothing was written to look at.
 */
export function ImportDoneRedirect({ href = PNL_HREF }: { href?: string }) {
  const t = useTranslations("adminAiImport.multi.flow")
  const [left, setLeft] = useState(REDIRECT_AFTER_SEC)
  const [cancelled, setCancelled] = useState(false)

  useEffect(() => {
    if (cancelled) return
    if (left <= 0) {
      window.location.assign(href)
      return
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [left, cancelled, href])

  if (cancelled) return null

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-900/10 bg-slate-900 p-3 text-sm text-white"
      data-testid="import-done-redirect"
      role="status"
      aria-live="polite"
    >
      <span className="font-medium">
        {t("done.opening", { sec: left })}
      </span>
      <a
        href={href}
        className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100"
        data-testid="import-done-go-now"
      >
        {t("done.goNow")}
      </a>
      <button
        type="button"
        onClick={() => setCancelled(true)}
        className="rounded border border-white/30 px-2.5 py-1 text-xs font-medium hover:bg-white/10"
        data-testid="import-done-stay"
      >
        {t("done.stay")}
      </button>
    </div>
  )
}

export type ReviewTabKey = "analysis" | "routing"

/**
 * 11.64 — the review area stops being one endless scroll.
 *
 * After an analysis the preview rendered every section stacked: 23 guided-fix
 * rows, a routing grid, a safety receipt, 33 warnings, and 26 per-sheet
 * analysis cards each carrying up to ten indicator chips. The product owner
 * could not look over what the AI had decided before pressing Apply without
 * scrolling past all of it — "не нужно чтоб растягивалась на всю длину".
 *
 * ONLY the two purely informational sections move in here. An audit of the
 * Apply button's `disabled` expression found that everything else either
 * explains a blocker, offers the only fix for one, or is a `scrollIntoView`
 * target — and three of those would break outright behind a tab:
 *
 *   • the sole `forceOverride` checkbox lives inside the CONFLICT banner, so
 *     hiding it removes the only way past a conflict;
 *   • `scrollToDoctorProblem` falls back through
 *     `errorRef ?? conflictBannerRef ?? doctorPanelRef` — an unmounted ref is
 *     `null`, so "go to the problem" would navigate to itself;
 *   • the WARNINGS block is the only render of the routing-safety-gate and
 *     year-gate reasons. Hiding it recreates 11.43 exactly: a red verdict
 *     with no route to the cause.
 *
 * The caller keeps BOTH panels mounted and hides the inactive one with
 * `hidden` rather than unmounting it. That preserves every ref, keeps the
 * existing tests' `getByTestId` working, and still gives the page a fixed
 * height — the only thing this change was asked to fix.
 */
export function ImportReviewTabs({
  active,
  onChange,
  counts,
}: {
  active: ReviewTabKey
  onChange: (key: ReviewTabKey) => void
  counts: Partial<Record<ReviewTabKey, number>>
}) {
  const t = useTranslations("adminAiImport.multi.review")
  const tabs: ReviewTabKey[] = ["analysis", "routing"]
  return (
    <div
      role="tablist"
      aria-label={t("ariaLabel")}
      className="inline-flex rounded border border-slate-200 bg-slate-50 p-1"
      data-testid="import-review-tabs"
    >
      {tabs.map((key) => {
        const n = counts[key]
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            onClick={() => onChange(key)}
            data-testid={`review-tab-${key}`}
            className={`px-3 py-1.5 text-sm rounded font-medium transition ${
              active === key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t(`tab.${key}` as never)}
            {n !== undefined && n > 0 && (
              <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                {n}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
