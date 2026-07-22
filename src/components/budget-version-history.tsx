"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { GitBranch, Plus, ArrowRight, Loader2 } from "lucide-react"
import { planKindKey, planLineEvidence, planStatusKey } from "@/lib/budgeting/plan-presentation"

interface Version {
  id: string
  name: string
  status: string
  version: number
  versionLabel: string | null
  amendmentOf: string | null
  kind: "actual" | "budget"
  _count: { lines: number }
  createdAt: string
  approvedAt: string | null
  approvedBy: string | null
}

interface Props {
  versions: Version[]
  currentPlanId: string
  onSelectVersion: (id: string) => void
  onCreateVersion: () => void
  onCompare: (planIdA: string, planIdB: string) => void
  isCreating?: boolean
  canCompare?: boolean
  canCreate?: boolean
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-foreground",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  closed: "bg-blue-100 text-blue-800",
}

export function BudgetVersionHistory({
  versions,
  currentPlanId,
  onSelectVersion,
  onCreateVersion,
  onCompare,
  isCreating,
  canCompare = false,
  canCreate = false,
}: Props) {
  const t = useTranslations("budgeting")
  const locale = useLocale()
  if (!versions.length) return null

  return (
    <Card data-testid="plans-version-history">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            {t("plansVersionHistoryTitle")}
          </span>
          {canCreate && <Button size="sm" variant="outline" data-write-control="create-version" onClick={onCreateVersion} disabled={isCreating}>
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            {t("plansNewVersionButton")}
          </Button>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {versions.map((v, i) => {
            const isCurrent = v.id === currentPlanId
            return (
              <div
                key={v.id}
                data-testid={`plans-version-${v.id}`}
                className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors
                  ${isCurrent ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => onSelectVersion(v.id)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                    ${isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {v.versionLabel || `v${v.version}`}
                  </div>
                  <div>
                    <div className="text-sm font-medium">
                      {v.name}
                      {isCurrent && <span className="text-xs text-muted-foreground ml-1">({t("plansVersionCurrent")})</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(v.createdAt).toLocaleDateString(locale)}
                      {v.approvedAt && ` · ${t("plansVersionApproved", { date: new Date(v.approvedAt).toLocaleDateString(locale) })}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t(planKindKey(v.kind))} · {(() => {
                        const evidence = planLineEvidence(v)
                        if (evidence.state === "empty") return t("plansLinesEmpty")
                        if (evidence.state === "unknown") return t("plansLinesUnknown")
                        return t("plansLinesCount", { count: evidence.count })
                      })()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`text-[10px] ${STATUS_COLORS[v.status] || "bg-muted"}`}>
                    {t(planStatusKey(v.status))}
                  </Badge>
                  {i > 0 && canCompare && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCompare(versions[i - 1].id, v.id)
                      }}
                    >
                      <ArrowRight className="h-3 w-3 mr-1" />
                      {t("plansVersionDiffButton")}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
