"use client"

/**
 * Retiring dead dictionary entries (2026-08-19).
 *
 * The chart carries hundreds of accounts and the product dictionary dozens of
 * lines that have never held a row. They move no number — that is what makes
 * them dead — but they are in every dropdown and every mapping review, and
 * the cost is paid by whoever has to read past them.
 *
 * ## Why this screen shows the proof and not just the list
 *
 * Retiring is a soft flag: nothing breaks loudly if it is wrong, the entry
 * simply stops appearing. So each row states what was checked — that no
 * budget line, balance-sheet line, cash-flow entry or COGS line references it
 * — and the hint says why it is probably a leftover. The decision stays with
 * the reader; the evidence is this screen's job.
 *
 * The list can go stale while it is read. The server refuses anything that
 * gained a row in the meantime and names it; those refusals are rendered
 * here rather than swallowed, because a refusal means the reader's picture
 * was out of date and the next click should be made on a fresh list.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Hint = "shadow_of_live_sibling" | "duplicate_name" | "none"

interface DeadRow {
  id: string
  code: string
  name: string
  /** Rows a re-import or archive soft-deleted. Context, not a veto. */
  archived: number
  hint: Hint
}
interface Block {
  dead: DeadRow[]
  activeTotal: number
  liveTotal: number
}
interface HygieneResponse {
  accounts: Block
  products: Block
}
interface Refusal {
  id: string
  code: string
  name: string
  reason: string
  rows?: number
}
interface DeactivateResponse {
  approved: Array<{ id: string; code: string; name: string }>
  refused: Refusal[]
}

type Kind = "account" | "product"

function HygieneBlock({
  kind,
  block,
  title,
}: {
  kind: Kind
  block: Block
  title: string
}) {
  const t = useTranslations("chartHygiene")
  const qc = useQueryClient()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [outcome, setOutcome] = useState<DeactivateResponse | null>(null)

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const retire = useMutation({
    mutationFn: async (): Promise<DeactivateResponse> => {
      const res = await fetch("/api/budgeting/chart-hygiene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ids: [...picked] }),
      })
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
    onSuccess: (data) => {
      setOutcome(data)
      setPicked(new Set())
      // The list is now wrong by exactly what was retired. Refetch rather
      // than patch it locally, so the next decision is made on server truth.
      void qc.invalidateQueries({ queryKey: ["chart-hygiene"] })
    },
  })

  const hintLabel = (h: Hint) =>
    h === "none" ? null : (
      <Badge variant="outline" className="text-[10px] font-normal">
        {t(h)}
      </Badge>
    )

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">
              {t("summary", {
                dead: block.dead.length,
                total: block.activeTotal,
                live: block.liveTotal,
              })}
            </p>
          </div>
          <Button
            size="sm"
            disabled={picked.size === 0 || retire.isPending}
            onClick={() => retire.mutate()}
          >
            {t("retire", { count: picked.size })}
          </Button>
        </div>

        {outcome && (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p>{t("retired", { count: outcome.approved.length })}</p>
            {outcome.refused.length > 0 && (
              <div className="space-y-1">
                {/* Never collapsed into a count: a refusal is the signal that
                    the list on screen was already out of date. */}
                <p className="font-medium text-amber-600 dark:text-amber-500">
                  {t("refusedHeading", { count: outcome.refused.length })}
                </p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {outcome.refused.map((r) => (
                    <li key={r.id}>
                      <span className="font-mono">{r.code}</span> —{" "}
                      {r.reason === "no_longer_dead"
                        ? t("refusedNoLongerDead", { rows: r.rows ?? 0 })
                        : t("refusedNotEligible")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {retire.error && <p className="text-sm text-destructive">{t("failed")}</p>}

        {block.dead.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("nothingDead")}</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <tbody>
                {block.dead.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="w-8 p-2">
                      <input
                        type="checkbox"
                        aria-label={row.code}
                        checked={picked.has(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                    </td>
                    <td className="p-2 font-mono text-xs whitespace-nowrap">{row.code}</td>
                    <td className="p-2">{row.name}</td>
                    <td className="p-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {/* "Never used" and "used, then re-imported away" are
                          different situations and the reader should see which
                          one this is before ticking it. */}
                      {row.archived > 0 ? t("archivedRows", { rows: row.archived }) : null}
                    </td>
                    <td className="p-2 text-right">{hintLabel(row.hint)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function ChartHygienePanel() {
  const t = useTranslations("chartHygiene")
  const { data, isLoading, error } = useQuery<HygieneResponse>({
    queryKey: ["chart-hygiene"],
    queryFn: async () => {
      const res = await fetch("/api/budgeting/chart-hygiene")
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
  })

  if (isLoading)
    return (
      <Card>
        <CardContent className="p-6 text-muted-foreground">{t("loading")}</CardContent>
      </Card>
    )
  if (error || !data)
    return (
      <Card>
        <CardContent className="p-6 text-muted-foreground">{t("failed")}</CardContent>
      </Card>
    )

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <h2 className="font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
        </CardContent>
      </Card>
      <HygieneBlock kind="account" block={data.accounts} title={t("accountsTitle")} />
      <HygieneBlock kind="product" block={data.products} title={t("productsTitle")} />
    </div>
  )
}
