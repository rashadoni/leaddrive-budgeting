"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { History, ChevronDown, ChevronUp, Undo2, Plus, Trash2, Pencil, User } from "lucide-react"
import { useBudgetChangelog, useUndoBudgetChange } from "@/lib/budgeting/hooks"
import type { ChangeLogItem } from "@/lib/budgeting/hooks"

function formatAmount(n: number) {
  return Math.round(n).toLocaleString() + " ₼"
}

function formatRelativeTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHrs = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })

  if (diffMin < 1) return "Just now"
  if (diffMin < 60) return `${diffMin}m ago · ${time}`
  if (diffDays === 0) return `${diffHrs}h ago · ${time}`
  if (diffDays === 1) return `Yesterday · ${time}`
  return `${diffDays}d ago · ${time}`
}

function ChangeIcon({ action }: { action: string }) {
  if (action === "create") return <Plus className="h-3.5 w-3.5 text-green-600" />
  if (action === "delete") return <Trash2 className="h-3.5 w-3.5 text-red-500" />
  return <Pencil className="h-3.5 w-3.5 text-blue-500" />
}

function ChangeRow({ change, isLast, onUndo, undoing }: {
  change: ChangeLogItem
  isLast: boolean
  onUndo: (id: string) => void
  undoing: boolean
}) {
  const category = change.category || "Unknown"

  return (
    <div className={`relative pl-8 pb-4 ${!isLast ? "border-l-2 border-muted-foreground/20 ml-[7px]" : "ml-[7px]"}`}>
      {/* Timeline dot */}
      <div className="absolute left-[-8px] top-0.5 w-4 h-4 rounded-full bg-background border-2 border-muted-foreground/30 flex items-center justify-center">
        <ChangeIcon action={change.action} />
      </div>

      <div className="ml-2">
        {/* Time + user */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
          <span>{formatRelativeTime(change.createdAt)}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {change.userName}
          </span>
        </div>

        {/* Change description */}
        <div className="flex items-center justify-between">
          <div className="text-sm">
            {change.action === "update" && (
              <span>
                <span className="font-medium">{category}</span>
                <span className="text-muted-foreground mx-1.5">:</span>
                <span className="text-red-500/80 line-through">{formatAmount(change.oldValue as number)}</span>
                <span className="text-muted-foreground mx-1.5">→</span>
                <span className="text-green-600 font-semibold">{formatAmount(change.newValue as number)}</span>
              </span>
            )}
            {change.action === "create" && (
              <span>
                <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 mr-1.5 px-1 py-0">NEW</Badge>
                <span className="font-medium">{category}</span>
                {change.newValue != null && (
                  <span className="text-muted-foreground ml-1.5">({formatAmount(change.newValue as number)})</span>
                )}
              </span>
            )}
            {change.action === "delete" && (
              <span>
                <Badge variant="outline" className="text-[10px] text-red-500 border-red-300 mr-1.5 px-1 py-0">DEL</Badge>
                <span className="font-medium line-through text-muted-foreground">{category}</span>
                {change.oldValue != null && (
                  <span className="text-muted-foreground ml-1.5">({formatAmount(change.oldValue as number)})</span>
                )}
              </span>
            )}
          </div>

          {/* Undo button — only for field updates */}
          {change.action === "update" && change.field && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground hover:text-foreground px-2"
              disabled={undoing}
              onClick={() => onUndo(change.id)}
            >
              <Undo2 className="h-3 w-3 mr-1" />
              Undo
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

interface BudgetChangeHistoryProps {
  planId: string
}

export function BudgetChangeHistory({ planId }: BudgetChangeHistoryProps) {
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const { data: changelogData } = useBudgetChangelog(planId)
  const undoMutation = useUndoBudgetChange()

  const changes = changelogData?.items ?? []

  if (changes.length === 0) return null

  const visibleChanges = showAll ? changes : changes.slice(0, 4)
  const hasMore = changes.length > 4

  const handleUndo = (changeId: string) => {
    if (confirm("Revert this change?")) {
      undoMutation.mutate(changeId)
    }
  }

  return (
    <Card className="border border-border/60">
      <CardHeader className="pb-0 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">
              Budget Changes
            </CardTitle>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {changes.length}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            {expanded ? (
              <>Hide <ChevronUp className="h-3 w-3 ml-1" /></>
            ) : (
              <>Show <ChevronDown className="h-3 w-3 ml-1" /></>
            )}
          </Button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-3 pb-2 px-4">
          <div className="space-y-0">
            {visibleChanges.map((change, i) => (
              <ChangeRow
                key={change.id}
                change={change}
                isLast={i === visibleChanges.length - 1}
                onUndo={handleUndo}
                undoing={undoMutation.isPending}
              />
            ))}
          </div>

          {hasMore && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll(!showAll)}
              className="w-full text-xs text-muted-foreground hover:text-foreground mt-1"
            >
              {showAll ? "Show less" : `Show ${changes.length - 4} more changes`}
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  )
}
