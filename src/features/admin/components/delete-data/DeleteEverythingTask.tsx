"use client"
/**
 * Task D — delete everything and start clean.
 *
 * No pickers: the scope IS the whole group, and the affected companies are
 * read-only chips — INCLUDING the group-level entity, so "the whole group"
 * has one meaning and it is visible. The old panel's holding scope and the
 * old form's "whole group" checkbox meant two different sets, and neither
 * screen said which.
 *
 * The check runs automatically on open, because checking is the content of
 * this task.
 */
import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { gateFor } from "@/features/admin/lib/delete-data/tier"
import { buildLedger } from "@/features/admin/lib/delete-data/categories"
import { BlastRadius } from "./BlastRadius"
import { ConfirmStrip } from "./ConfirmStrip"
import { RunResult } from "./RunResult"
import { useDeleteFlow } from "./useDeleteFlow"
import type { CompanyRow } from "./types"

export function DeleteEverythingTask({
  companies,
  groupLevel,
  onDone,
}: {
  /** Operational companies. */
  companies: ReadonlyArray<CompanyRow>
  /** Level-1 / parentless entities — shown, and included. */
  groupLevel: ReadonlyArray<CompanyRow>
  onDone: () => void
}) {
  const t = useTranslations("adminDataDelete")
  const flow = useDeleteFlow()
  const [reason, setReason] = useState("")
  const [token, setToken] = useState("")

  const allCodes = useMemo(
    () => [...companies.map((c) => c.code), ...groupLevel.map((c) => c.code)],
    [companies, groupLevel],
  )

  const scope = useMemo(
    () => ({
      task: "deleteAll" as const,
      companyCodes: allCodes,
      years: [] as number[],
      bundle: "everything" as const,
      exactCategories: null,
      includeManualActuals: true,
    }),
    [allCodes],
  )

  useEffect(() => {
    void flow.check(scope)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ledger = buildLedger(flow.preview?.breakdown ?? {})
  const gate = gateFor({
    task: "deleteAll",
    companyCodes: allCodes,
    allYears: true,
    hasPermanent: true,
  })

  if (flow.outcome && flow.outcome.kind !== "drift") {
    return <RunResult outcome={flow.outcome} onDismiss={onDone} />
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed">{t("deleteAll.intro")}</p>
      {/* "Empties the whole group" is read by a reasonable person as "I will
          have to re-create 60 companies". Nothing on the old screen said what
          survives. */}
      <p className="rounded border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        {t("deleteAll.keptNote")}
      </p>

      <div className="flex flex-wrap gap-1.5" data-testid="delete-all-scope">
        {groupLevel.map((c) => (
          <span
            key={c.code}
            className="rounded-full border border-red-400 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
          >
            {t("deleteAll.groupLevel", { name: c.name })}
          </span>
        ))}
        {companies.map((c) => (
          <span
            key={c.code}
            className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs"
          >
            {c.name}
          </span>
        ))}
      </div>

      {flow.checking && (
        <p className="text-sm text-muted-foreground">{t("deleteAll.counting")}</p>
      )}
      {flow.error && (
        <p className="text-xs text-red-700 dark:text-red-300">{flow.error}</p>
      )}

      {flow.preview && (
        <>
          {ledger.rows + ledger.items === 0 ? (
            <p className="rounded border border-border bg-muted/40 p-4 text-sm">
              {t("zero.emptyHolding")}
            </p>
          ) : (
            <>
              <BlastRadius
                breakdown={flow.preview.breakdown}
                companyCount={flow.preview.companies.length}
                // Every year, so no restorable event either. Same rule as B.
                years={scope.years}
                checkedAt={flow.checkedAt}
                stale={flow.stale}
                onRecheck={() => void flow.check(scope)}
              />
              {flow.outcome?.kind === "drift" && <RunResult outcome={flow.outcome} />}
              {!flow.stale && (
                <ConfirmStrip
                  gate={gate}
                  breakdown={flow.preview.breakdown}
                  reason={reason}
                  onReason={setReason}
                  token={token}
                  onToken={setToken}
                  armedAt={flow.checkedAt}
                  running={flow.running}
                  hardStop={false}
                  stale={flow.stale}
                  submitLabel={t("submit.everything", { companies: allCodes.length })}
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
            </>
          )}
        </>
      )}
    </div>
  )
}
