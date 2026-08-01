"use client"
/**
 * Task C — bring back deleted data.
 *
 * "Make it go away" and "bring it back" now live at one address, and the
 * restore is fed by the audit trail rather than by asking the operator to
 * re-describe a scope they already described once.
 *
 * Honesty note in the UI: soft-archived rows come back from here; hard-deleted
 * ones (facts, actuals, sales lines, the records tail) come back only from the
 * workbook. The screen says which is which instead of implying "restore"
 * covers everything.
 *
 * 11.78 — and it says it about THIS deletion. The panel used to render a
 * hardcoded four-item "will bring back" list for every event, then fire four
 * calls. Delete one year of operational figures — a bundle this screen offers
 * — and all four returned 0, so the green line read "0 rows brought back"
 * under a promise of four data types. Both lists, and the calls themselves,
 * now come from the breakdown the deletion recorded (`restorePlan`).
 *
 * The restore endpoint is still per-entity-kind, so one row can mean several
 * sequential calls. That is stated in the copy (`restore.multiCall`) rather
 * than hidden behind a spinner.
 *
 * 11.79 (2026-07-31) — two corrections, both about promises this panel made
 * that the system does not keep:
 *
 *  • THE KEY. Every request now carries `archivedAt`, the exact stamp of the
 *    deletion being undone. Without it the server un-archives every generation
 *    of that company-year at once — on production, three import generations of
 *    the same P&L — and the statements come back multiplied. An event with no
 *    recorded key is listed but NOT offered: `restore.legacy.body` says why,
 *    and there is no button to press. Fail closed, deliberately.
 *
 *  • THE "will not bring back" LIST. It printed one blanket "those come back
 *    when you upload the file again" under everything in it. `indicatorValue`
 *    is in every per-company breakdown and no file returns it; ticked manual
 *    actuals land there too, and the delete side says four steps earlier that
 *    re-uploading will not bring THOSE back. Each line now carries its own
 *    fate (`restore.fate.*`), so no caption can be wrong about a line under it.
 */
import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { Undo2 } from "lucide-react"
import { buildLedger, restorePlan } from "@/features/admin/lib/delete-data/categories"
import { SOFT_DELETE_RETENTION_DAYS } from "@/lib/cleanup/soft-delete-cleanup"
import type { AuditRow, CompanyRow } from "./types"

/** Org-level sweeps are tagged with a sentinel code, not a real company. */
function isRealCompany(code?: string): code is string {
  return Boolean(code) && !code!.startsWith("__")
}

export function RestoreTask({
  events,
  companies,
}: {
  events: ReadonlyArray<AuditRow>
  /** Only to put a name next to the code — the list itself is the audit trail. */
  companies?: ReadonlyArray<CompanyRow>
}) {
  const t = useTranslations("adminDataDelete")
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: string; rows: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const nameOf = (code?: string) =>
    companies?.find((c) => c.code === code)?.name ?? code ?? ""

  /**
   * The size of a deletion, in the units it was actually measured in.
   *
   * 11.80 — this printed a bare `· 2045`, which was `metadata.rowsAffected`:
   * for a reset that is the sum over EVERY bucket, records included. It is the
   * same conflation `RunResult` was corrected for one pass earlier — rows and
   * records are different things and are never summed — so the number here
   * disagreed with the number the operator had just been shown, and carried no
   * unit to explain the gap. Derived from the recorded breakdown instead, by
   * the same `buildLedger` the delete side uses, so the two agree by
   * construction.
   *
   * An event with no recorded breakdown (everything archived before this
   * change) shows no size rather than a misleading one — it is a legacy row,
   * which cannot be restored anyway and says so.
   */
  const sizeOf = (row: AuditRow): string => {
    if (!row.breakdown) return ""
    const ledger = buildLedger(row.breakdown)
    const parts: string[] = []
    if (ledger.rows > 0) parts.push(t("unit.rows", { count: ledger.rows }))
    if (ledger.items > 0) parts.push(t("unit.items", { count: ledger.items }))
    return parts.join(" · ")
  }

  // An event whose recorded breakdown contains nothing soft-archived offers a
  // button that can only ever report zero. It is listed as "not restorable
  // from this page" instead — which is what the delete screen now promises for
  // exactly these operations.
  const candidates = useMemo(
    () =>
      events.filter(
        (e) =>
          e.action !== "data_restore" &&
          isRealCompany(e.companyCode) &&
          e.year != null &&
          restorePlan(e.breakdown).kinds.length > 0,
      ),
    [events],
  )

  // Split on the restore key, not on anything cosmetic. An event without one
  // cannot be undone safely at all — restoring it by scope would also revive
  // every earlier archived version of the same year — so it gets an
  // explanation and no button. See ARCHIVE_GENERATION_KEY in
  // `src/lib/server/archive.ts`.
  const restorable = useMemo(() => candidates.filter((e) => e.archivedAt), [candidates])
  const legacy = useMemo(() => candidates.filter((e) => !e.archivedAt), [candidates])

  async function restore(row: AuditRow) {
    if (!row.archivedAt) return
    setBusy(row.id)
    setError(null)
    setDone(null)
    let rows = 0
    try {
      for (const kind of restorePlan(row.breakdown).kinds) {
        const res = await fetch("/api/admin/data-archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "restore",
            entityKind: kind,
            companyCode: row.companyCode,
            year: row.year,
            // The one field that makes this a restore OF AN OPERATION rather
            // than of a company-year bucket. The server refuses without it.
            archivedAt: row.archivedAt,
            reason: reason.trim() || undefined,
            confirmCode: row.companyCode,
          }),
        })
        const data = (await res.json()) as { ok?: boolean; rowsAffected?: number; error?: string }
        if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        rows += data.rowsAffected ?? 0
      }
      setDone({ id: row.id, rows })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (candidates.length === 0) {
    // "Nothing has been deleted recently" is false the moment a whole-group
    // delete has run — that is precisely the deletion most likely to be
    // regretted, and it produces no year-scoped, company-scoped event for this
    // list to offer. Say which of the two is true.
    const anythingDeleted = events.some((e) => e.action !== "data_restore")
    return (
      <p className="text-sm text-muted-foreground">
        {anythingDeleted ? t("restore.emptyNotRestorable") : t("restore.empty")}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/* The archive is not permanent. A nightly job physically removes
          archived balance-sheet, cash-flow and counterparty rows after
          SOFT_DELETE_TTL_MS, and this list has no age filter — so a
          two-month-old entry still renders with its full "can bring back"
          promise. Said once, at the head, rather than per row. */}
      <p className="text-xs italic text-muted-foreground" data-testid="restore-retention">
        {t("restore.retention", { days: SOFT_DELETE_RETENTION_DAYS })}
      </p>
      {restorable.map((row) => {
        const plan = restorePlan(row.breakdown)
        return (
          <div key={row.id} className="rounded border border-border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {nameOf(row.companyCode)}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {row.companyCode}
                </span>{" "}
                · {row.year}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {row.createdAt.slice(0, 16).replace("T", " ")}
                {sizeOf(row) && ` · ${sizeOf(row)}`}
              </span>
            </div>
            {row.reason && (
              <p className="mt-0.5 text-xs italic text-muted-foreground">{row.reason}</p>
            )}

            {openId === row.id ? (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <p className="text-xs font-semibold">{t("restore.willReturn")}</p>
                <ul
                  className="ml-4 list-disc text-xs text-muted-foreground"
                  data-testid="restore-will-return"
                >
                  {plan.returns.map((labelKey) => (
                    <li key={labelKey}>{t(`category.${labelKey}`)}</li>
                  ))}
                </ul>
                {plan.doesNotReturn.length > 0 && (
                  <>
                    <p className="text-xs font-semibold">{t("restore.willNotReturn")}</p>
                    <ul
                      className="ml-4 list-disc text-xs text-muted-foreground"
                      data-testid="restore-will-not-return"
                    >
                      {/* Each line carries its own fate. A single caption under
                          the whole list was wrong for `indicatorValue`, which
                          is in every breakdown. */}
                      {plan.doesNotReturn.map((lost) => (
                        <li key={lost.labelKey}>
                          {t(`category.${lost.labelKey}`)}
                          {" — "}
                          <span data-testid={`restore-fate-${lost.fate}`}>
                            {t(`restore.fate.${lost.fate}`)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {/* The restore route never calls the recompute (route.ts,
                    `mode: "restore"` branch), while the delete cleared every
                    indicator value it fed. Silence here reads as "it worked",
                    and then the risk matrix is still blank. */}
                <p className="text-xs italic text-muted-foreground">
                  {t("restore.noRecompute")}
                </p>
                <p className="text-xs italic text-muted-foreground">
                  {t("restore.widerCaveat")}
                </p>
                {plan.kinds.length > 1 && (
                  <p className="text-xs italic text-muted-foreground">
                    {t("restore.multiCall", { count: plan.kinds.length })}
                  </p>
                )}
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder={t("reason.placeholder")}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy === row.id}
                  onClick={() => void restore(row)}
                  className="inline-flex h-9 items-center gap-1.5 rounded bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {busy === row.id ? t("restore.running") : t("restore.cta")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setOpenId(row.id)}
                className="mt-2 text-xs font-medium underline underline-offset-2"
              >
                {t("restore.cta")}
              </button>
            )}

            {done?.id === row.id &&
              (done.rows > 0 ? (
                <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                  {t("restore.done", { rows: done.rows })}
                </p>
              ) : (
                // "Brought back 0 rows" in green is a success message for a
                // no-op. Say which no-op it was.
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {t("restore.doneNothing")}
                </p>
              ))}
          </div>
        )
      })}

      {/* Deletions from before the system recorded which rows each one took.
          Listed, so the operator can see they happened, and explicitly refused,
          because the only way to "restore" them is the scope-wide sweep that
          brings back every archived generation at once. */}
      {legacy.map((row) => (
        <div
          key={row.id}
          data-testid="restore-legacy"
          className="rounded border border-dashed border-border bg-muted/30 p-3 text-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-muted-foreground">
              {nameOf(row.companyCode)}{" "}
              <span className="font-mono text-xs">{row.companyCode}</span> · {row.year}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {row.createdAt.slice(0, 16).replace("T", " ")}
              {sizeOf(row) && ` · ${sizeOf(row)}`}
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold">{t("restore.legacy.title")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("restore.legacy.body")}</p>
        </div>
      ))}

      {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  )
}
