"use client"
/**
 * Task B — remove one company's data.
 *
 * No year control at all, and no "what" picker: this task means everything
 * ever imported for one entity, records included. Saying that in one fixed
 * line is honest; offering a year box that would quietly not apply is not.
 */
import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ShieldCheck } from "lucide-react"
import { gateFor } from "@/features/admin/lib/delete-data/tier"
import { buildLedger } from "@/features/admin/lib/delete-data/categories"
import { CompanyPicker } from "./CompanyPicker"
import { BlastRadius } from "./BlastRadius"
import { ConfirmStrip } from "./ConfirmStrip"
import { RunResult } from "./RunResult"
import { useDeleteFlow } from "./useDeleteFlow"
import type { CompanyRow } from "./types"

export function RemoveCompanyTask({
  companies,
  onDone,
}: {
  companies: ReadonlyArray<CompanyRow>
  onDone: () => void
}) {
  const t = useTranslations("adminDataDelete")
  const flow = useDeleteFlow()
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState("")
  const [token, setToken] = useState("")

  // Invalidate at the edit site, not in an effect: a scope change and the
  // staleness it causes belong in the same render.
  function pick(codes: string[]) {
    setSelected(codes)
    flow.invalidate()
    setToken("")
  }

  const scope = useMemo(
    () => ({
      task: "removeCompany" as const,
      companyCodes: selected,
      years: [] as number[],
      bundle: "everything" as const,
      exactCategories: null,
      includeManualActuals: true,
    }),
    [selected],
  )

  const ledger = buildLedger(flow.preview?.breakdown ?? {})
  const company = companies.find((c) => c.code === selected[0])
  const gate = gateFor({
    task: "removeCompany",
    companyCodes: selected,
    // Task B is always all-years and always destroys something no file brings
    // back, so it is never Tier 1. The token is the company's own code,
    // because that is what this body makes the route demand.
    allYears: true,
    hasPermanent: true,
  })

  if (flow.outcome && flow.outcome.kind !== "drift") {
    return <RunResult outcome={flow.outcome} onDismiss={onDone} />
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold">{t("step.companies")}</h3>
        <CompanyPicker
          companies={companies}
          selected={selected}
          onChange={pick}
          single
        />
      </section>

      {selected.length === 1 && (
        <>
          <p className="rounded border border-border bg-muted/40 p-3 text-sm">
            {t("removeCompany.fixedScope")}
          </p>
          {/* The card that opens this task used to be labelled "Delete the
              company". It never deleted one — the Company row, its place in
              the tree, its chart of accounts and its user access all survive.
              Say so here, where the operator is deciding. */}
          <p className="rounded border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            {t("removeCompany.keptNote")}
          </p>
          <p className="rounded border border-red-300 bg-red-50 p-3 text-xs leading-relaxed text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            {t("removeCompany.permanentNote")}
          </p>

          <section>
            <h3 className="mb-2 text-sm font-semibold">{t("step.check")}</h3>
            {(!flow.preview || flow.stale) && (
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
            )}
            {flow.error && (
              <p className="mt-2 text-xs text-red-700 dark:text-red-300">{flow.error}</p>
            )}
            {flow.preview && (
              <div className="mt-3">
                <BlastRadius
                  breakdown={flow.preview.breakdown}
                  companyCount={1}
                  // Always all-years, so this delete never leaves a restorable
                  // event: the block must not offer this page as the way back.
                  years={scope.years}
                  checkedAt={flow.checkedAt}
                  stale={flow.stale}
                  onRecheck={() => void flow.check(scope)}
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
                    hardStop={false}
                    stale={flow.stale}
                    submitLabel={t("submit.company", {
                      company: company?.name ?? selected[0],
                    })}
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
          </section>
        </>
      )}
    </div>
  )
}
