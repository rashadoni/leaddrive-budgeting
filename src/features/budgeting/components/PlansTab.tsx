"use client"

/**
 * Phase 7.G Turn LXXVI (Phase 3.1 fourth slice — PlansTab extracted).
 *
 * Tab body extracted verbatim from `src/app/(dashboard)/budgeting/page.tsx`
 * lines 2415-2722. Continues the LX/LXI/LXVI extraction pattern. No
 * functional changes — pure refactor to thin out `page.tsx`.
 *
 * Imports: full audit of identifiers used by the function body to
 * avoid closure-leak class architect FAIL'd in Turn LXVI (PLTab).
 *
 * Tab dispatch in page.tsx still wires `activeTab === "plans"` to
 * `<PlansTab activePlanId={...} onSelect={...} onShowCreate={...} />`.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useSession as useSessionHook } from "next-auth/react"
import {
  useBudgetPlans,
  useUpdateBudgetPlan,
  useDeleteBudgetPlan,
  useCreateBudgetPlan,
  useBudgetVersions,
  useCreateBudgetVersion,
  useBudgetDiff,
  useCreateRollingPlan,
} from "@/lib/budgeting/hooks"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataBoundary } from "@/components/ui/data-boundary"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Loader2,
  Trash2,
  Plus,
  CalendarRange,
  CheckCircle,
  PiggyBank,
} from "lucide-react"
import { BudgetApprovalWorkflow } from "@/components/budget-approval-workflow"
import { BudgetApprovalHistory } from "@/components/budget-approval-history"
import { BudgetVersionHistory } from "@/components/budget-version-history"
import { BudgetVersionDiff } from "@/components/budget-version-diff"

export function PlansTab({ activePlanId, onSelect, onShowCreate }: { activePlanId: string; onSelect: (id: string) => void; onShowCreate: () => void }) {
  const t = useTranslations("budgeting")
  const tCommon = useTranslations("common")
  const { data: plans = [], isLoading } = useBudgetPlans()
  const updatePlan = useUpdateBudgetPlan()
  const deletePlan = useDeleteBudgetPlan()
  const { data: sessionData } = useSessionHook()
  const userRole = (sessionData?.user as any)?.role || "viewer"
  const activePlan = plans.find(p => p.id === activePlanId) || null

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const startRename = (plan: { id: string; name: string }) => { setRenamingId(plan.id); setRenameValue(plan.name) }
  const saveRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return }
    await updatePlan.mutateAsync({ id: renamingId, name: renameValue.trim() })
    setRenamingId(null)
  }

  // Reset confirmation dialog
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetPending, setResetPending] = useState(false)

  // Clone plan
  const createPlan = useCreateBudgetPlan()
  const clonePlan = async (plan: any) => {
    const cloneName = `${plan.name} (Copy)`
    await createPlan.mutateAsync({ name: cloneName, year: plan.year, periodType: plan.periodType, quarter: plan.quarter, month: plan.month })
  }

  // F3: Versioning
  const { data: versions = [] } = useBudgetVersions(activePlanId || null)
  const createVersion = useCreateBudgetVersion()
  const [diffPlanIds, setDiffPlanIds] = useState<{ a: string; b: string } | null>(null)
  const { data: diffData, isLoading: diffLoading } = useBudgetDiff(
    diffPlanIds?.a || null,
    diffPlanIds?.b || null,
  )

  // F4: Rolling plan creation
  const createRolling = useCreateRollingPlan()
  const [showRollingDialog, setShowRollingDialog] = useState(false)
  const [rollingForm, setRollingForm] = useState({ name: "", startYear: new Date().getFullYear(), startMonth: new Date().getMonth() + 1 })

  const handleCreateRolling = async () => {
    if (!rollingForm.name) return
    await createRolling.mutateAsync(rollingForm)
    setShowRollingDialog(false)
    setRollingForm({ name: "", startYear: new Date().getFullYear(), startMonth: new Date().getMonth() + 1 })
  }

  if (isLoading) return <DataBoundary loading>{null}</DataBoundary>

  return (
    <div>
      {/* Action bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t("plansCount", { count: plans.length })}
          </h2>
          <Button size="sm" variant="ghost" className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 h-7"
            disabled={plans.length === 0 || deletePlan.isPending}
            onClick={() => setShowResetConfirm(true)}>
            <Trash2 className="h-3 w-3 mr-1" /> {t("plansResetButton")}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8" onClick={() => setShowRollingDialog(true)}>
            <CalendarRange className="h-3.5 w-3.5 mr-1" /> {t("plansRollingPlanButton")}
          </Button>
          <Button size="sm" className="h-8" onClick={onShowCreate}><Plus className="h-3.5 w-3.5 mr-1" /> {t("btnNewPlan")}</Button>
        </div>
      </div>

      {/* Rolling Plan Dialog */}
      <Dialog open={showRollingDialog} onOpenChange={setShowRollingDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rollingDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("rollingDialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder={t("rollingDialogPlanName")}
              value={rollingForm.name}
              onChange={e => setRollingForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && handleCreateRolling()}
              autoFocus
            />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">{t("rollingDialogStartYear")}</label>
                <Input
                  type="number"
                  value={rollingForm.startYear}
                  onChange={e => setRollingForm(f => ({ ...f, startYear: Number(e.target.value) }))}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">{t("rollingDialogStartMonth")}</label>
                <select
                  value={rollingForm.startMonth}
                  onChange={e => setRollingForm(f => ({ ...f, startMonth: Number(e.target.value) }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {(["monthJan","monthFeb","monthMar","monthApr","monthMay","monthJun","monthJul","monthAug","monthSep","monthOct","monthNov","monthDec"] as const).map((mKey, i) => (
                    <option key={i} value={i + 1}>{t(mKey)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRollingDialog(false)}>{tCommon("cancel")}</Button>
            <Button onClick={handleCreateRolling} disabled={!rollingForm.name || createRolling.isPending}>
              {createRolling.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {t("rollingDialogCreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {plans.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <PiggyBank className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{t("noPlansCardTitle")}</p>
          <p className="text-sm mt-1">{t("noPlansCardSubtitle")}</p>
          <Button className="mt-4" onClick={onShowCreate}><Plus className="h-4 w-4 mr-1" /> {t("createPlan")}</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(plan => {
            const isActive = activePlanId === plan.id
            const isImported = plan.name?.includes("(Imported)")
            const statusColor = plan.status === "approved" ? "bg-emerald-500" : plan.status === "pending_approval" ? "bg-amber-500" : plan.status === "rejected" ? "bg-red-500" : "bg-slate-500"
            return (
              <div key={plan.id}
                className={`rounded-xl overflow-hidden transition-all duration-200 shadow-md hover:shadow-lg ${isActive ? "ring-2 ring-purple-500 scale-[1.01]" : ""}`}
                style={{ borderTop: isActive ? "3px solid #8b5cf6" : "3px solid transparent" }}>
                {/* Dark header */}
                <div className="bg-gradient-to-br from-violet-50 to-violet-100 border-b border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    {renamingId === plan.id ? (
                      <Input className="h-7 text-sm bg-violet-100 border-violet-300 dark:bg-violet-900 dark:border-violet-700" value={renameValue}
                        onChange={e => setRenameValue(e.target.value)} autoFocus
                        onBlur={() => saveRename()}
                        onKeyDown={e => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenamingId(null) }} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startRename(plan)}
                        className="text-left group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 rounded"
                        title={t("plansClickToRename")}
                      >
                        {/* impeccable polish: violet/purple AI palette →
                            primary token. Click-to-rename pattern kept
                            as raw <button> (text trigger, not pill). */}
                        <h3 className="text-sm font-bold leading-tight text-primary group-hover:text-primary/80 transition-colors">{plan.name}</h3>
                      </button>
                    )}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">{plan.status?.replace("_", " ")}</span>
                    </div>
                  </div>
                  {/* Period & year */}
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <div className="flex items-center gap-1">
                      <CalendarRange className="h-3 w-3" />
                      <span>{plan.year}</span>
                    </div>
                    <span>·</span>
                    <span>{plan.periodType === "annual" || !plan.periodType ? t("plansPeriodAnnual") : plan.periodType === "quarterly" && plan.quarter ? `Q${plan.quarter}` : plan.periodType === "monthly" && plan.month ? t("plansPeriodMonth", { month: plan.month }) : t("plansPeriodAnnual")}</span>
                    {isImported && (
                      <>
                        <span>·</span>
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-indigo-200 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border-0">{t("plansImportedBadge")}</Badge>
                      </>
                    )}
                  </div>
                  {/* Approval dates */}
                  {plan.approvedAt && (
                    <div className="text-[10px] text-emerald-400 mt-1.5 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> {t("plansApprovedDate", { date: new Date(plan.approvedAt).toLocaleDateString() })}
                    </div>
                  )}
                  {plan.submittedAt && !plan.approvedAt && (
                    <div className="text-[10px] text-amber-400 mt-1.5">{t("plansPendingSince", { date: new Date(plan.submittedAt).toLocaleDateString() })}</div>
                  )}
                  {plan.status === "rejected" && plan.rejectedReason && (
                    <div className="text-[10px] text-red-400 mt-1.5 truncate" title={plan.rejectedReason}>{t("plansRejectedLabel", { reason: plan.rejectedReason })}</div>
                  )}
                </div>
                {/* Light actions footer */}
                <div className="bg-card p-3 flex items-center gap-2">
                  <Button size="sm" variant={isActive ? "default" : "outline"} onClick={() => onSelect(plan.id)} className="flex-1 text-xs h-8">
                    {isActive ? <><CheckCircle className="h-3 w-3 mr-1" /> {t("btnActive")}</> : t("btnSelect")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => clonePlan(plan)}
                    className="h-8 w-8"
                    title={t("plansClonePlan")}
                    aria-label={t("plansClonePlan")}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      const msg = isImported
                        ? t("plansDeleteImportedConfirm", { name: plan.name })
                        : t("plansDeleteRegularConfirm", { name: plan.name })
                      if (confirm(msg)) deletePlan.mutate({ id: plan.id, deleteAll: isImported })
                    }}
                    className="h-8 w-8 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 hover:border-red-500/50"
                    title={t("plansDeletePlan")}
                    aria-label={t("plansDeletePlan")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Approval Workflow & History for active plan */}
      {activePlan && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          <BudgetApprovalWorkflow plan={activePlan} userRole={userRole} />
          <BudgetApprovalHistory planId={activePlan.id} />
        </div>
      )}

      {/* F3: Version History */}
      {activePlan && versions.length > 0 && (
        <div className="mt-6 space-y-4">
          <BudgetVersionHistory
            versions={versions}
            currentPlanId={activePlanId}
            onSelectVersion={onSelect}
            onCreateVersion={() => createVersion.mutate(activePlanId)}
            onCompare={(a, b) => setDiffPlanIds({ a, b })}
            isCreating={createVersion.isPending}
          />
          {diffData && (
            <BudgetVersionDiff
              data={diffData}
              isLoading={diffLoading}
              versionLabelA={versions.find(v => v.id === diffPlanIds?.a)?.versionLabel || t("plansVersionFallbackA")}
              versionLabelB={versions.find(v => v.id === diffPlanIds?.b)?.versionLabel || t("plansVersionFallbackB")}
            />
          )}
        </div>
      )}

      {/* F3: Create version button if no version chain yet */}
      {activePlan && versions.length === 0 && (
        <div className="mt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => createVersion.mutate(activePlanId)}
            disabled={createVersion.isPending}
          >
            {createVersion.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            {t("plansCreateVersionButton")}
          </Button>
        </div>
      )}

      {/* Reset Confirmation Dialog */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              {t("plansResetDialogTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* translator: keep <strong>...</strong> tags around the
                emphasized phrases — they render bold via dangerouslySetInnerHTML */}
            <p
              className="text-sm text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: t.raw("plansResetDialogDesc") as string }}
            />
            <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300">
              {t("plansResetDialogWarning")}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowResetConfirm(false)} disabled={resetPending}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={resetPending}
              onClick={async () => {
                setResetPending(true)
                try {
                  await fetch("/api/budgeting/plans?deleteAll=true", {
                    method: "DELETE",
                    headers: { "x-organization-id": String((sessionData?.user as any)?.organizationId || ""), "Content-Type": "application/json" },
                  })
                  window.location.reload()
                } catch (e) {
                  setResetPending(false)
                  setShowResetConfirm(false)
                }
              }}
            >
              {resetPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
              {resetPending ? t("plansResetDialogDeleting") : t("plansResetDialogDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
