"use client"
/**
 * Task A — clear the figures for one or more years.
 *
 * Four steps, each revealed once the previous is answered, and NO step is a
 * text field that can be blanked into a wider scope. If the operator
 * reconstructs the widest scope by hand — every company plus every year — the
 * form refuses and points at Task D. The widest scope has one door.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { AlertOctagon, ShieldCheck } from "lucide-react"
import { gateFor, isHardStop } from "@/features/admin/lib/delete-data/tier"
import type { BundleId } from "@/features/admin/lib/delete-data/bundles"
import type { ImportResetCategory } from "@/lib/server/import-reset-categories"
import { buildLedger } from "@/features/admin/lib/delete-data/categories"
import { CompanyPicker } from "./CompanyPicker"
import { YearChips } from "./YearChips"
import { WhatPicker } from "./WhatPicker"
import { BlastRadius } from "./BlastRadius"
import { ConfirmStrip } from "./ConfirmStrip"
import { RunResult } from "./RunResult"
import { useDeleteFlow } from "./useDeleteFlow"
import type { CompanyRow } from "./types"

export function ClearYearsTask({
  companies,
  onDeleteAll,
  onDone,
}: {
  companies: ReadonlyArray<CompanyRow>
  onDeleteAll: () => void
  onDone: () => void
}) {
  const t = useTranslations("adminDataDelete")
  const flow = useDeleteFlow()

  const [selected, setSelected] = useState<string[]>([])
  const [years, setYears] = useState<number[]>([])
  const [allYears, setAllYears] = useState(false)
  const [bundle, setBundle] = useState<BundleId>("everything")
  const [exact, setExact] = useState<ImportResetCategory[] | null>(null)
  const [manualActuals, setManualActuals] = useState(false)
  const [reason, setReason] = useState("")
  const [token, setToken] = useState("")

  // The year index and the "choose exactly" counts come from a scope-wide
  // census run as soon as companies are picked — the operator reads it
  // BEFORE choosing a year, which is the whole point of the chips.
  const [index, setIndex] = useState<Array<{ year: number; rows: number }>>([])
  const [censusCounts, setCensusCounts] = useState<Record<string, number>>({})
  const [censusLoading, setCensusLoading] = useState(false)
  const [emptySelection, setEmptySelection] = useState(false)

  const codesKey = selected.join(",")
  const runCensus = useCallback(async () => {
    if (selected.length === 0) {
      setIndex([])
      setCensusCounts({})
      setEmptySelection(false)
      return
    }
    setCensusLoading(true)
    try {
      const res = await fetch("/api/admin/data-archive/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityKind: "AllImportData",
          ...(selected.length === 1
            ? { companyCode: selected[0] }
            : { companyCodes: selected }),
          includeManualActuals: true,
          yearIndex: true,
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        preview?: { yearIndex?: Array<{ year: number; rows: number }>; breakdown: Record<string, number>; rowsAffected: number }
      }
      setIndex(data.preview?.yearIndex ?? [])
      setCensusCounts(data.preview?.breakdown ?? {})
      setEmptySelection((data.preview?.rowsAffected ?? 0) === 0)
    } catch {
      setIndex([])
      setCensusCounts({})
    } finally {
      setCensusLoading(false)
    }
  }, [selected])

  useEffect(() => {
    const id = setTimeout(() => void runCensus(), 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey])

  // Any edit to the scope invalidates the number on screen and clears the
  // typed token. Done at the edit site rather than in an effect, so a scope
  // change and its invalidation are one render, never two.
  function edit<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value)
      flow.invalidate()
      setToken("")
    }
  }

  const scope = useMemo(
    () => ({
      task: "clearYears" as const,
      companyCodes: selected,
      years: allYears ? [] : years,
      bundle,
      exactCategories: exact,
      includeManualActuals: manualActuals,
    }),
    [selected, years, allYears, bundle, exact, manualActuals],
  )

  const hardStop = isHardStop({
    task: "clearYears",
    selectedCompanies: selected.length,
    totalCompanies: companies.length,
    allYears,
    // Ticking every chip is the same scope as the "All years" chip; both
    // route to Task D. See the note on `isHardStop`.
    selectedYears: years,
    availableYears: index.map((y) => y.year),
  })

  const ledger = buildLedger(flow.preview?.breakdown ?? {})
  const gate = gateFor({
    task: "clearYears",
    companyCodes: selected,
    allYears,
    hasPermanent: ledger.rowsPermanent > 0 || ledger.itemsPermanent > 0,
  })

  const yearsChosen = allYears || years.length > 0
  const canCheck = selected.length > 0 && yearsChosen && !hardStop

  if (flow.outcome && flow.outcome.kind !== "drift") {
    return (
      <RunResult
        outcome={flow.outcome}
        onDismiss={onDone}
        onRetryFailed={(codes) => {
          setSelected(codes)
          setToken("")
          flow.reset()
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <Step n={1} label={t("step.companies")}>
        <CompanyPicker
          companies={companies}
          selected={selected}
          onChange={edit(setSelected)}
          yearsByCompany={undefined}
        />
        {emptySelection && !censusLoading && selected.length > 0 && (
          <p className="mt-2 rounded border border-border bg-muted/40 p-2 text-xs">
            {/* `emptyCompany` names ONE company. Interpolating `selected[0]`
                into it after five companies were ticked told the operator
                that company A was empty when the other four were too. */}
            {selected.length > 1
              ? t("zero.emptySelection")
              : t("zero.emptyCompany", {
                  company:
                    companies.find((c) => c.code === selected[0])?.name ?? selected[0],
                })}{" "}
            <Link
              href="/budgeting/admin/ai-import"
              className="underline underline-offset-2"
            >
              {t("introLink")}
            </Link>
          </p>
        )}
      </Step>

      {selected.length > 0 && !emptySelection && (
        <Step n={2} label={t("step.years")}>
          {censusLoading ? (
            <p className="text-xs text-muted-foreground">{t("check.running")}</p>
          ) : (
            <YearChips
              index={index}
              selected={years}
              allYears={allYears}
              locks={flow.locks}
              onSelect={edit(setYears)}
              onAllYears={edit(setAllYears)}
            />
          )}
        </Step>
      )}

      {hardStop && (
        <div
          data-testid="hard-stop"
          className="rounded border border-red-400 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertOctagon className="h-4 w-4" aria-hidden="true" />
            {t("hardStop.title")}
          </p>
          <p className="mt-1 text-xs leading-relaxed">{t("hardStop.body")}</p>
          <button
            type="button"
            onClick={onDeleteAll}
            className="mt-2 rounded border border-red-500 px-3 py-1.5 text-xs font-semibold hover:bg-red-100 dark:hover:bg-red-500/20"
          >
            {t("hardStop.cta")}
          </button>
        </div>
      )}

      {yearsChosen && !hardStop && (
        <Step n={3} label={t("step.what")}>
          <WhatPicker
            bundle={bundle}
            onBundle={edit(setBundle)}
            exact={exact}
            onExact={edit(setExact)}
            includeManualActuals={manualActuals}
            onIncludeManualActuals={edit(setManualActuals)}
            counts={censusCounts}
          />
        </Step>
      )}

      {canCheck && (
        <Step n={4} label={t("step.check")}>
          {!flow.preview || flow.stale ? (
            <button
              type="button"
              data-testid="check-button"
              disabled={flow.checking}
              onClick={() => void flow.check(scope)}
              className="inline-flex h-10 items-center gap-2 rounded border border-border bg-background px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {flow.checking ? t("check.running") : t("check.button")}
            </button>
          ) : null}

          {flow.error && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-300">{flow.error}</p>
          )}

          {flow.preview && (
            <div className="mt-3">
              <BlastRadius
                breakdown={flow.preview.breakdown}
                companyCount={flow.preview.companies.length}
                // The same list the request body carries — the block decides
                // what it may promise about recovery from it, not from a
                // static property of the tables in scope.
                years={scope.years}
                checkedAt={flow.checkedAt}
                stale={flow.stale}
                onRecheck={() => void flow.check(scope)}
                recordsKept
              />
              {flow.outcome?.kind === "drift" && <RunResult outcome={flow.outcome} />}
              {!flow.stale && ledger.rows + ledger.items > 0 && (
                <ConfirmStrip
                  gate={gate}
                  breakdown={flow.preview.breakdown}
                  reason={reason}
                  onReason={setReason}
                  token={token}
                  onToken={setToken}
                  armedAt={flow.checkedAt}
                  running={flow.running}
                  hardStop={hardStop}
                  stale={flow.stale}
                  submitLabel={
                    ledger.rowsPermanent > 0
                      ? t("submit.rowsPermanent", {
                          rows: ledger.rows,
                          permanent: ledger.rowsPermanent,
                        })
                      : t("submit.rows", { rows: ledger.rows })
                  }
                  onSubmit={() =>
                    void flow.run({
                      ...scope,
                      reason,
                      confirmToken: token,
                      expectRows: flow.preview?.rowsAffected ?? 0,
                    })
                  }
                />
              )}
            </div>
          )}
        </Step>
      )}
    </div>
  )
}

function Step({
  n,
  label,
  children,
}: {
  n: number
  label: string
  children: React.ReactNode
}) {
  return (
    <section data-testid={`delete-step-${n}`}>
      <h3 className="mb-2 text-sm font-semibold">{label}</h3>
      {children}
    </section>
  )
}
