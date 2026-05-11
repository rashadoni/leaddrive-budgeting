"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, Send, CheckCircle2, XCircle, FileText, Lock } from "lucide-react"
import { DataBoundary } from "@/components/ui/data-boundary"
import { useBudgetApprovalComments } from "@/lib/budgeting/hooks"

const STATUS_ICONS: Record<string, any> = {
  submitted: Send,
  pending_approval: Send,
  review: MessageSquare,
  approved: CheckCircle2,
  rejected: XCircle,
  comment: MessageSquare,
  draft: FileText,
  closed: Lock,
}

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-yellow-100 text-yellow-800",
  pending_approval: "bg-yellow-100 text-yellow-800",
  review: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  comment: "bg-muted text-foreground",
  draft: "bg-muted text-foreground",
  closed: "bg-blue-100 text-blue-800",
}

const DOT_COLORS: Record<string, string> = {
  submitted: "bg-yellow-400",
  pending_approval: "bg-yellow-400",
  review: "bg-blue-400",
  approved: "bg-green-400",
  rejected: "bg-red-400",
  comment: "bg-muted-foreground/40",
  draft: "bg-muted-foreground/40",
  closed: "bg-blue-400",
}

interface Props {
  planId: string
}

export function BudgetApprovalHistory({ planId }: Props) {
  const { data: comments = [], isLoading } = useBudgetApprovalComments(planId)

  if (isLoading) {
    return <DataBoundary loading>{null}</DataBoundary>
  }

  if (comments.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Approval History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">No approval actions yet.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Approval History
          <Badge variant="secondary" className="text-xs">{comments.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-muted" />

          <div className="space-y-4">
            {comments.map((c) => {
              const Icon = STATUS_ICONS[c.status] || MessageSquare
              const dotColor = DOT_COLORS[c.status] || "bg-muted-foreground/40"

              return (
                <div key={c.id} className="relative pl-7">
                  {/* Timeline dot */}
                  <div className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 border-white ${dotColor}`} />

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{c.userName}</span>
                      <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[c.status] || ""}`}>
                        {c.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{c.comment}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
