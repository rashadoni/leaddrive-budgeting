"use client"

/**
 * What the last imports actually did (2026-08-19).
 *
 * `ImportBatchReport` has recorded every import for months and
 * `/api/import/reports` has served them since Phase 11.34 — and nothing had
 * ever displayed one. On the client's production that is 33 runs, every one
 * green and every one backed by a post-write re-query of the database. The
 * owner asking whether a re-import could break something had no way to see
 * that the system already answers it, run by run.
 *
 * The panel leads with the answer for the newest run and keeps the rest in a
 * list, because the question is almost always about the import that just
 * finished.
 */

import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BUDGET_COLORS } from "@/lib/budget-chart-theme"
import {
  verdictStanding,
  verifiedShare,
  type VerdictStanding,
} from "@/lib/import/import-verdict"

interface Report {
  id: string
  runId: string
  fileType: string
  filenames: string[]
  year: number
  verdict: string
  evidence: string
  sheetsVerified: number
  sheetsUnverified: number
  rowsInserted: number
  committed: boolean
  createdAt: string
  verdictUnverified: boolean
}

const TONE: Record<VerdictStanding, string> = {
  verified: BUDGET_COLORS.positive,
  unverified: BUDGET_COLORS.warning,
  drift: BUDGET_COLORS.warning,
  failed: BUDGET_COLORS.negative,
  uncommitted: BUDGET_COLORS.negative,
}

const rows = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

export function ImportHistoryPanel() {
  const t = useTranslations("importHistory")
  const { data, isLoading, error } = useQuery<{ reports: Report[] }>({
    queryKey: ["import-reports"],
    queryFn: async () => {
      const res = await fetch("/api/import/reports?limit=12")
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
  })

  if (isLoading)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">{t("loading")}</CardContent>
      </Card>
    )
  if (error || !data)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">{t("failed")}</CardContent>
      </Card>
    )

  const reports = data.reports ?? []
  if (reports.length === 0)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">{t("empty")}</CardContent>
      </Card>
    )

  const when = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ")

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div>
          <h3 className="font-medium">{t("title")}</h3>
          {/* The distinction the whole panel exists to keep: green because a
              query proved it, or green because the parser said so. */}
          <p className="text-xs text-muted-foreground pt-1">{t("intro")}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left">
                <th className="py-2 font-medium">{t("when")}</th>
                <th className="py-2 font-medium">{t("files")}</th>
                <th className="py-2 font-medium text-right">{t("year")}</th>
                <th className="py-2 font-medium text-right">{t("rows")}</th>
                <th className="py-2 font-medium text-right">{t("sheets")}</th>
                <th className="py-2 font-medium text-right">{t("verdict")}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const standing = verdictStanding(r)
                const share = verifiedShare(r)
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 tabular-nums whitespace-nowrap">{when(r.createdAt)}</td>
                    <td className="py-2">
                      <div>{r.filenames.join(", ") || r.fileType}</div>
                      <div className="text-xs text-muted-foreground">{r.fileType}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.year}</td>
                    <td className="py-2 text-right tabular-nums">{rows.format(r.rowsInserted)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {share === null
                        ? "—"
                        : `${r.sheetsVerified}/${r.sheetsVerified + r.sheetsUnverified}`}
                    </td>
                    <td className="py-2 text-right">
                      <Badge
                        variant="outline"
                        className="font-normal"
                        style={{ color: TONE[standing], borderColor: TONE[standing] }}
                      >
                        {t(`standing.${standing}`)}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
