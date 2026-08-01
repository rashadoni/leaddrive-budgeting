"use client"
/**
 * "What will be deleted", grouped by what happens to it afterwards.
 *
 * Four things this block refuses to do, each because the old panel did it:
 *   • It never iterates a hardcoded key list. It maps over the keys the
 *     RESPONSE returned, through `categories.ts`. A key nobody has mapped yet
 *     still renders, as "Other data".
 *   • It never prints "0 gone for good". When nothing is permanent the whole
 *     clause is replaced, so the sentence stays believable on the day it is
 *     not zero.
 *   • It never adds records (audit findings, court cases) into the row count.
 *     Those are things a person maintains, not rows in a table — so they get
 *     their OWN clause, carrying their own unit, instead of being left out of
 *     the summary the way they used to be.
 *   • It never says "you can bring this back from this page" because a table
 *     happens to have a `deletedAt` column. Whether the OPERATOR can undo this
 *     is a property of the request — see `producesRestorableEvent` — and this
 *     block asks that question about the exact years being deleted.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  Archive,
  RefreshCw,
  RotateCcw,
  Undo2,
  UploadCloud,
} from "lucide-react"
import {
  buildLedger,
  describeCategory,
  type Fate,
} from "@/features/admin/lib/delete-data/categories"
import { producesRestorableEvent } from "@/lib/server/delete-request"
// Derived from the constant the nightly purge job actually enforces, so the
// number on screen cannot drift from the number in the cron again.
import { SOFT_DELETE_RETENTION_DAYS } from "@/lib/cleanup/soft-delete-cleanup"

/** Display group: the four fates, plus "archived but not restorable here". */
type DisplayGroup = Fate | "archived"

const GROUP_ICON: Record<DisplayGroup, typeof Undo2> = {
  recoverable: Undo2,
  archived: Archive,
  permanent: AlertTriangle,
  reimport: UploadCloud,
  recomputed: RotateCcw,
}

export function BlastRadius({
  breakdown,
  companyCount,
  years,
  checkedAt,
  stale,
  onRecheck,
  recordsKept,
}: {
  breakdown: Record<string, number>
  companyCount: number
  /**
   * The exact years this request will carry — `[]` means "every year".
   *
   * Not a count: the wording of the recoverability claim is decided by this
   * list, through the same rule `archive.ts` uses when it writes the audit
   * event the restore list reads.
   */
  years: readonly number[]
  checkedAt: number | null
  stale: boolean
  onRecheck: () => void
  /** Task A only: say out loud that records are NOT in scope. */
  recordsKept?: boolean
}) {
  const t = useTranslations("adminDataDelete")
  const [showEmpty, setShowEmpty] = useState(false)
  const ledger = buildLedger(breakdown)
  // Soft-archived rows are only "recoverable" for the operator when this
  // delete will leave a restorable audit event behind. A multi-year or
  // all-years delete records no single year, so it never appears in the
  // restore list — and Tasks B and D are all-years by construction.
  const restorable = producesRestorableEvent(years)

  if (ledger.rows === 0 && ledger.items === 0) {
    return (
      <div
        data-testid="blast-radius"
        className="rounded border border-border bg-muted/30 p-4 text-sm"
      >
        {t("zero.emptySelection")}
      </div>
    )
  }

  // One clause per fate that has rows in it, and they sum to `{rows}`; then
  // the records, which are counted apart and say so.
  //
  // 11.77 — the old headline had two branches and both were wrong. When
  // nothing was `permanent` it said "{rows} rows will be deleted — all of them
  // can be brought back", which on this production database is false the
  // moment a single operational fact is in scope: those are HARD-deleted and
  // return only from the workbook. When something was permanent it printed
  // `recoverable` and `permanent` against a `rows` neither of them added up
  // to, leaving the difference unexplained.
  //
  // 11.78 — two more:
  //
  //   • `ledger.items` appeared in NO clause. A company holding only
  //     compliance records rendered "0 rows will be deleted" in the largest
  //     bold line on the screen, directly above twelve permanently destroyed
  //     write-backs. Records cannot join `{rows}` — different unit — so they
  //     get clauses that carry their own unit, and a lead of their own for the
  //     rows-are-zero case.
  //
  //   • `{rows}` is the same number as the submit button, and that is why
  //     `indicatorValue` stays inside it. It is NOT the same number as the
  //     server's `expectRows` drift guard whenever records are in scope:
  //     `preview.rowsAffected` sums every breakdown bucket, records included,
  //     so on Tasks B and D it exceeds `{rows}` by exactly `ledger.items`.
  //     Both numbers are correct for what they measure; the headline now names
  //     the difference instead of the comment claiming it away.
  const rowClauses: Array<{ key: string; arg: string; count: number; className: string }> = [
    {
      // Same rows either way — the difference is whether the operator can get
      // them back without technical support.
      key: restorable ? "headlineRecoverableClause" : "headlineArchivedClause",
      arg: restorable ? "recoverable" : "archived",
      count: ledger.rowsRecoverable,
      className: restorable
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-amber-700 dark:text-amber-400",
    },
    {
      key: "headlineReimportClause",
      arg: "reimport",
      count: ledger.rowsReimport,
      className: "text-amber-700 dark:text-amber-400",
    },
    {
      key: "headlinePermanentClause",
      arg: "permanent",
      count: ledger.rowsPermanent,
      className: "font-semibold text-red-700 dark:text-red-400",
    },
    {
      // "…recalculated automatically and need nothing from you" is true only
      // when the recompute has something left to read. Where the delete also
      // takes the SOURCE rows — the default bundle, Task B, Task D — the
      // recompute runs against nothing and `recomputeIndicator` upserts
      // `status: 'unknown'`: the cells come back grey and stay grey until the
      // workbook is uploaded again. That is precisely the case in which the
      // operator DOES need to do something. The condition is already in the
      // ledger: rows in scope that are not themselves the recomputed layer.
      key:
        ledger.rows - ledger.rowsRecomputed > 0
          ? "headlineRecomputedEmptyClause"
          : "headlineRecomputedClause",
      arg: "recomputed",
      count: ledger.rowsRecomputed,
      className: "text-muted-foreground",
    },
  ]

  // Rows-only-zero is a real shape on this holding, not a hypothetical: a
  // company can carry nothing but audit findings and court cases.
  const recordsOnly = ledger.rows === 0 && ledger.items > 0
  const clauses = [
    ...rowClauses,
    // In the records-only case the lead already names them, so the "plus N
    // records" clause would repeat itself.
    {
      key: "headlineRecordsClause",
      arg: "records",
      count: recordsOnly ? 0 : ledger.items,
      className: "text-muted-foreground",
    },
    {
      key: "headlineRecordsPermanentClause",
      arg: "permanent",
      count: ledger.itemsPermanent,
      className: "font-semibold text-red-700 dark:text-red-400",
    },
  ].filter((c) => c.count > 0)

  return (
    <div
      data-testid="blast-radius"
      className={`rounded border p-4 transition-opacity ${
        stale ? "opacity-50" : ""
      } border-border bg-card`}
    >
      {/* The lead is the only bold run. The clauses used to be joined onto it
          with " · ", which produced a 200-character bold paragraph whose most
          consequential sentence sat third in a middot list — and, because the
          lead ended in a full stop and the clauses were lowercase, a broken
          sentence in Azerbaijani and Russian. One capitalised sentence per
          line, in reading order. */}
      <div data-testid="radius-headline">
        <p className="text-base font-semibold leading-snug" data-testid="radius-lead">
          {recordsOnly
            ? t("radius.headlineRecordsOnlyLead", { records: ledger.items })
            : t("radius.headlineLead", { rows: ledger.rows })}
        </p>
        <ul className="mt-1.5 space-y-0.5 text-sm leading-snug" data-testid="radius-clauses">
          {clauses.map((clause) => (
            <li key={clause.key} className={clause.className}>
              {t(`radius.${clause.key}`, { [clause.arg]: clause.count })}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {years.length === 0
          ? t("radius.scopeAllYears", { companies: companyCount })
          : t("radius.scope", { companies: companyCount, years: years.length })}
      </p>

      <div className="mt-4 space-y-4">
        {ledger.groups.map((group) => {
          // The rows are soft-archived either way. What changes is whether
          // this screen can offer them back, so the heading changes with it.
          const display: DisplayGroup =
            group.fate === "recoverable" && !restorable ? "archived" : group.fate
          const Icon = GROUP_ICON[display]
          const isPermanent = group.fate === "permanent"
          return (
            <section
              key={group.fate}
              data-testid={`radius-group-${display}`}
              className={
                isPermanent
                  ? "border-l-2 border-red-500 pl-3"
                  : group.fate === "recomputed"
                    ? "pl-3 text-muted-foreground"
                    : "pl-3"
              }
            >
              <h4
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${
                  isPermanent ? "text-red-700 dark:text-red-400" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {t(`radius.group.${display}`)}
              </h4>
              {display === "archived" && (
                <p
                  className="mt-1 text-xs italic text-muted-foreground"
                  data-testid="radius-archived-caveat"
                >
                  {t("radius.caveat.archivedSupport")}
                </p>
              )}
              {/* "Can be brought back from this page" has a life. A nightly
                  job physically removes archived rows past SOFT_DELETE_TTL_MS
                  (30 days, `soft-delete-cleanup.ts`), and this screen was the
                  only surface in the product quoting a restore with no expiry
                  — which reads as permanent. Said on both branches, because
                  the rows expire whether or not this page can offer them. */}
              {(display === "recoverable" || display === "archived") && (
                <p
                  className="mt-1 text-xs italic text-muted-foreground"
                  data-testid="radius-retention-caveat"
                >
                  {t("radius.caveat.retention", { days: SOFT_DELETE_RETENTION_DAYS })}
                </p>
              )}
              <ul className="mt-1.5 space-y-1">
                {group.lines.map((line) => (
                  <li key={line.key}>
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <span>{t(`category.${line.labelKey}`)}</span>
                      <span className="shrink-0 font-mono tabular-nums">
                        {line.unit === "items"
                          ? t("unit.items", { count: line.count })
                          : t("unit.rows", { count: line.count })}
                      </span>
                    </div>
                    {line.caveatKey && (
                      <p className="mt-0.5 text-xs italic text-muted-foreground">
                        {t(`radius.caveat.${line.caveatKey}`)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {recordsKept && (
        <p className="mt-4 rounded bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">
          {t("radius.recordsKept")}
        </p>
      )}

      {ledger.emptyCount > 0 && (
        <button
          type="button"
          onClick={() => setShowEmpty((v) => !v)}
          className="mt-3 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {showEmpty ? "▾ " : "▸ "}
          {t("radius.zeroCollapse", { count: ledger.emptyCount })}
        </button>
      )}
      {showEmpty && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {Object.entries(breakdown)
            .filter(([, v]) => !v)
            .map(([k]) => (
              // Through the same table as everything else. This used to
              // consult a second, hand-kept key list living at the bottom of
              // this file — the exact pattern the header disclaims.
              <li key={k}>{t(`category.${describeCategory(k).labelKey}`)}</li>
            ))}
        </ul>
      )}

      <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
        {t("radius.truth")}
      </p>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {checkedAt != null && (
          <span>
            {t("check.checkedAt", {
              time: new Date(checkedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </span>
        )}
        <button
          type="button"
          onClick={onRecheck}
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          {t("check.again")}
        </button>
      </div>
      {stale && (
        <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          {t("check.stale")}
        </p>
      )}
    </div>
  )
}
