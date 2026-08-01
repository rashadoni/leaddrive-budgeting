"use client"
/**
 * What happened. One panel per outcome, and 207 is never the green one.
 *
 * The old form keyed on `body.ok` and threw everything else away — including,
 * on a 207, a breakdown describing data that was already gone. It then called
 * `location.reload()` 1.5 s later, destroying its own result panel before it
 * could be read.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Clock, Lock, XCircle } from "lucide-react"
import { buildLedger } from "@/features/admin/lib/delete-data/categories"
import type { RunOutcome } from "./types"

export function RunResult({
  outcome,
  onRetryFailed,
  onDismiss,
}: {
  outcome: RunOutcome
  onRetryFailed?: (codes: string[]) => void
  onDismiss?: () => void
}) {
  const t = useTranslations("adminDataDelete")

  if (outcome.kind === "done") {
    const ledger = buildLedger(outcome.breakdown)
    return (
      <div
        data-testid="run-result-done"
        className="mt-5 rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100"
      >
        <p className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {/* `outcome.rowsAffected` is the server's Σ breakdown, which folds
              records (audit findings, court cases, write-backs) in with rows.
              The preview headline spends three keys keeping those OUT of
              `{rows}` — printing the summed number here contradicts it one
              screen later, and the larger number is the mislabelled one.
              Same ledger, same rule, both screens. */}
          {t("result.done.title", {
            rows: ledger.rows,
            companies: outcome.companiesDeleted.length,
          })}
        </p>
        {ledger.items > 0 && (
          <p className="mt-1 text-xs" data-testid="result-done-records">
            {t("result.done.records", { records: ledger.items })}
          </p>
        )}
        <p className="mt-1 text-xs">
          {t("result.done.recompute", { count: outcome.recomputed })}
        </p>
        {/* The moment the operator needs to know "go find that workbook". The
            list below flattens the fate groups away, so the one fate that
            costs them something is said in words. */}
        {ledger.rowsReimport > 0 && (
          <p className="mt-1 text-xs font-medium">
            {t("result.done.reimport", { rows: ledger.rowsReimport })}
          </p>
        )}
        <ul className="mt-3 space-y-0.5 text-xs">
          {ledger.groups.flatMap((g) =>
            g.lines.map((line) => (
              <li key={line.key} className="flex justify-between gap-4">
                <span>{t(`category.${line.labelKey}`)}</span>
                {/* A bare number makes a row and a record typographically
                    identical in the one panel that reports what actually
                    happened. Same units the preview uses. */}
                <span className="font-mono tabular-nums">
                  {line.unit === "items"
                    ? t("unit.items", { count: line.count })
                    : t("unit.rows", { count: line.count })}
                </span>
              </li>
            )),
          )}
        </ul>
        <div className="mt-3 flex flex-wrap gap-3 text-xs font-medium">
          <Link href="/budgeting/admin/ai-import" className="underline underline-offset-2">
            {t("result.done.goImport")}
          </Link>
          {onDismiss && (
            <button type="button" onClick={onDismiss} className="underline underline-offset-2">
              {t("breadcrumb.change")}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (outcome.kind === "partial") {
    const ledger = buildLedger(outcome.breakdown)
    return (
      <div
        data-testid="run-result-partial"
        className="mt-5 rounded border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
      >
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {t("result.partial.title")}
        </p>
        {outcome.companiesDeleted.length > 0 && (
          <p className="mt-2 text-xs">
            {t("result.partial.deleted", { list: outcome.companiesDeleted.join(", ") })}
          </p>
        )}
        {outcome.companiesFailed.length > 0 && (
          <p className="mt-1 text-xs">
            {t("result.partial.untouched", { list: outcome.companiesFailed.join(", ") })}
          </p>
        )}
        {outcome.orphanTailRemains && (
          <p className="mt-1 text-xs">{t("result.partial.orphan")}</p>
        )}
        <ul className="mt-3 space-y-0.5 text-xs">
          {ledger.groups.flatMap((g) =>
            g.lines.map((line) => (
              <li key={line.key} className="flex justify-between gap-4">
                <span>{t(`category.${line.labelKey}`)}</span>
                {/* A bare number makes a row and a record typographically
                    identical in the one panel that reports what actually
                    happened. Same units the preview uses. */}
                <span className="font-mono tabular-nums">
                  {line.unit === "items"
                    ? t("unit.items", { count: line.count })
                    : t("unit.rows", { count: line.count })}
                </span>
              </li>
            )),
          )}
        </ul>
        {outcome.companiesFailed.length > 0 && onRetryFailed && (
          <button
            type="button"
            onClick={() => onRetryFailed(outcome.companiesFailed)}
            className="mt-3 rounded border border-amber-500 px-3 py-1.5 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-500/20"
          >
            {t("result.partial.retry", { count: outcome.companiesFailed.length })}
          </button>
        )}
      </div>
    )
  }

  if (outcome.kind === "drift") {
    return (
      <div
        data-testid="run-result-drift"
        className="mt-5 rounded border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
      >
        <p className="font-semibold">{t("result.drift")}</p>
        <p className="mt-1 font-mono text-xs">
          {t("result.driftNumbers", {
            expected: outcome.expected,
            actual: outcome.actual,
          })}
        </p>
      </div>
    )
  }

  if (outcome.kind === "locked") {
    return (
      <div
        data-testid="run-result-locked"
        className="mt-5 rounded border border-border bg-muted/40 p-4 text-sm"
      >
        <p className="flex items-center gap-2 font-semibold">
          <Lock className="h-4 w-4" aria-hidden="true" />
          {t("result.locked", { year: outcome.period })}
        </p>
        {outcome.reason && <p className="mt-1 text-xs italic">{outcome.reason}</p>}
      </div>
    )
  }

  if (outcome.kind === "rateLimited") {
    return <RateLimited seconds={outcome.retryAfterSeconds} />
  }

  return (
    <div
      data-testid="run-result-failed"
      className="mt-5 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
    >
      <p className="flex items-center gap-2 font-semibold">
        <XCircle className="h-4 w-4" aria-hidden="true" />
        {t("result.failed")}
      </p>
      {/* A raw English Prisma code under an Azerbaijani sentence looks like
          part of the sentence. Label it as the thing to forward. */}
      <p className="mt-2 text-xs">{t("result.failedDetail")}</p>
      <p className="mt-0.5 break-all font-mono text-xs">{outcome.message}</p>
    </div>
  )
}

function RateLimited({ seconds }: { seconds: number }) {
  const t = useTranslations("adminDataDelete")
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => setLeft((v) => v - 1), 1000)
    return () => clearTimeout(id)
  }, [left])
  return (
    <div
      data-testid="run-result-rate-limited"
      className="mt-5 rounded border border-border bg-muted/40 p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-semibold">
        <Clock className="h-4 w-4" aria-hidden="true" />
        {t("result.rateLimited", { seconds: Math.max(0, left) })}
      </p>
    </div>
  )
}
