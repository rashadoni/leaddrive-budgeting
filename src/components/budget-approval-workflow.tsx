"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { CheckCircle2, XCircle, Send, RotateCcw, Lock, FileText, Clock, Loader2 } from "lucide-react"
import { useUpdateBudgetPlan } from "@/lib/budgeting/hooks"
import { planStatusKey } from "@/lib/budgeting/plan-presentation"
import type { BudgetPlan, UpdateBudgetPlanInput } from "@/lib/budgeting/types"

interface Plan {
  id: string
  name: string
  status: string
  submittedBy?: string | null
  submittedAt?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  rejectedReason?: string | null
}

interface Props {
  plan: Plan
  userRole: string
}

const STEPS: Array<{ key: BudgetPlan["status"]; icon: typeof FileText }> = [
  { key: "draft", icon: FileText },
  { key: "pending_approval", icon: Send },
  { key: "approved", icon: CheckCircle2 },
  { key: "closed", icon: Lock },
]

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-foreground",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  closed: "bg-blue-100 text-blue-800",
}

function getStepIndex(status: string): number {
  if (status === "rejected") return 1
  const idx = STEPS.findIndex((s) => s.key === status)
  return idx >= 0 ? idx : 0
}

export function BudgetApprovalWorkflow({ plan, userRole }: Props) {
  const t = useTranslations("budgeting")
  const tCommon = useTranslations("common")
  const locale = useLocale()
  const updatePlan = useUpdateBudgetPlan()
  const [comment, setComment] = useState("")
  const [rejectReason, setRejectReason] = useState("")
  const [showRejectDialog, setShowRejectDialog] = useState(false)

  const canApproveReject = userRole === "admin" || userRole === "manager"
  const canSubmit = userRole !== "viewer"
  const currentStep = getStepIndex(plan.status)

  const handleStatusChange = (newStatus: BudgetPlan["status"], extra?: Pick<UpdateBudgetPlanInput, "rejectedReason">) => {
    updatePlan.mutate({
      id: plan.id,
      status: newStatus,
      comment: comment.trim() || undefined,
      ...extra,
    })
    setComment("")
    setRejectReason("")
    setShowRejectDialog(false)
  }

  return (
    <Card data-testid="plans-approval-workflow">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>{t("plansApprovalTitle")}</span>
          <Badge className={STATUS_COLORS[plan.status] || "bg-muted"}>
            {t(planStatusKey(plan.status))}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Visual stepper */}
        <div className="flex items-center gap-0.5">
          {STEPS.map((step, i) => {
            const Icon = step.icon
            const isActive = i === currentStep
            const isDone = i < currentStep
            const isRejected = plan.status === "rejected" && i === 1

            return (
              <div key={step.key} className="flex items-center flex-1 min-w-0">
                <div className={`flex items-center gap-1 px-1.5 py-1.5 rounded-md text-xs font-medium w-full justify-center whitespace-nowrap
                  ${isRejected ? "bg-red-100 text-red-800 border border-red-300" : ""}
                  ${isActive && !isRejected ? "bg-primary text-primary-foreground" : ""}
                  ${isDone ? "bg-green-100 text-green-800" : ""}
                  ${!isActive && !isDone && !isRejected ? "bg-muted text-muted-foreground" : ""}
                `}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{t(planStatusKey(isRejected ? "rejected" : step.key))}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 w-3 shrink-0 mx-0.5 ${isDone ? "bg-green-400" : "bg-muted"}`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Meta info */}
        {plan.submittedAt && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {t("plansSubmittedAt", { date: new Date(plan.submittedAt).toLocaleString(locale) })}
          </div>
        )}
        {plan.approvedAt && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-600" />
            {t("plansApprovedAt", { date: new Date(plan.approvedAt).toLocaleString(locale) })}
          </div>
        )}
        {plan.rejectedReason && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
            {t("plansRejectionReasonValue", { reason: plan.rejectedReason })}
          </div>
        )}

        {/* Comment input */}
        {canSubmit && <Textarea
          placeholder={t("plansCommentOptional")}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="h-16 text-sm"
        />}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {plan.status === "draft" && canSubmit && (
            <Button
              size="sm"
              data-write-control="submit-approval"
              onClick={() => handleStatusChange("pending_approval")}
              disabled={updatePlan.isPending}
            >
              {updatePlan.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              {t("btnSubmitApproval")}
            </Button>
          )}

          {plan.status === "pending_approval" && canApproveReject && (
            <>
              <Button
                size="sm"
                data-write-control="approve-plan"
                variant="default"
                className="bg-green-600 hover:bg-green-700"
                onClick={() => handleStatusChange("approved")}
                disabled={updatePlan.isPending}
              >
                {updatePlan.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                {t("plansApproveButton")}
              </Button>

              <Button size="sm" variant="destructive" data-write-control="reject-plan" onClick={() => setShowRejectDialog(true)}>
                <XCircle className="h-4 w-4 mr-1" />
                {t("btnReject")}
              </Button>

              <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("plansRejectDialogTitle")}</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">{t("plansRejectDialogDescription")}</p>
                  <Textarea
                    placeholder={t("rejectReason")}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowRejectDialog(false)}>{tCommon("cancel")}</Button>
                    <Button
                      variant="destructive"
                      data-write-control="confirm-reject-plan"
                      onClick={() => handleStatusChange("rejected", { rejectedReason: rejectReason })}
                      disabled={!rejectReason.trim()}
                    >
                      {t("btnReject")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}

          {plan.status === "rejected" && canSubmit && (
            <Button
              size="sm"
              data-write-control="return-plan-to-draft"
              variant="outline"
              onClick={() => handleStatusChange("draft")}
              disabled={updatePlan.isPending}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              {t("plansReturnDraftButton")}
            </Button>
          )}

          {plan.status === "approved" && canApproveReject && (
            <>
              <Button
                size="sm"
                data-write-control="close-plan"
                variant="outline"
                onClick={() => handleStatusChange("closed")}
                disabled={updatePlan.isPending}
              >
                <Lock className="h-4 w-4 mr-1" />
                {t("plansCloseButton")}
              </Button>
              <Button
                size="sm"
                data-write-control="reopen-plan"
                variant="outline"
                onClick={() => handleStatusChange("draft")}
                disabled={updatePlan.isPending}
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                {t("plansReopenButton")}
              </Button>
            </>
          )}

          {plan.status === "closed" && canApproveReject && (
            <Button
              size="sm"
              data-write-control="reopen-plan"
              variant="outline"
              onClick={() => handleStatusChange("draft")}
              disabled={updatePlan.isPending}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              {t("plansReopenButton")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
