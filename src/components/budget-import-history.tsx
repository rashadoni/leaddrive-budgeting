"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { History, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle } from "lucide-react"

interface Import {
  id: string
  fileName: string | null
  importType: string
  status: string
  totalRows: number
  matchedRows: number
  unmatchedRows: number
  createdAt: string
  integration?: { name: string; provider: string } | null
}

interface Props {
  imports: Import[]
  isLoading?: boolean
}

const STATUS_ICON: Record<string, any> = {
  completed: CheckCircle2,
  failed: XCircle,
  processing: AlertCircle,
  pending: AlertCircle,
}

const STATUS_COLOR: Record<string, string> = {
  completed: "text-green-600",
  failed: "text-red-600",
  processing: "text-yellow-600",
  pending: "text-muted-foreground",
}

export function BudgetImportHistory({ imports, isLoading }: Props) {
  if (isLoading) return null
  if (imports.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4" />
          Import History
          <Badge variant="outline" className="ml-2">{imports.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {imports.map((imp) => {
            const Icon = STATUS_ICON[imp.status] || AlertCircle
            const color = STATUS_COLOR[imp.status] || "text-muted-foreground"
            return (
              <div key={imp.id} className="flex items-center justify-between p-2.5 rounded-lg border">
                <div className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 ${color}`} />
                  <div>
                    <div className="text-sm font-medium flex items-center gap-2">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                      {imp.fileName || "Import"}
                      {imp.integration && (
                        <Badge variant="outline" className="text-[10px]">{imp.integration.provider}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(imp.createdAt).toLocaleString()} · {imp.matchedRows}/{imp.totalRows} uploaded
                      {imp.unmatchedRows > 0 && (
                        <span className="text-yellow-600 ml-1">({imp.unmatchedRows} errors)</span>
                      )}
                    </div>
                  </div>
                </div>
                <Badge className={`text-[10px] ${
                  imp.status === "completed" ? "bg-green-100 text-green-800" :
                  imp.status === "failed" ? "bg-red-100 text-red-800" :
                  "bg-yellow-100 text-yellow-800"
                }`}>
                  {imp.status}
                </Badge>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
