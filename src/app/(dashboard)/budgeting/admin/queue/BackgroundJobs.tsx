"use client"
/**
 * 2026-08-04 — background-work panel on the queue admin page.
 *
 * With BullMQ off the queue inspector had nothing to show, so this panel
 * carries the page instead: what background work exists, when each piece
 * last left a trace, and — the part that matters — which pieces nothing in
 * production is actually running.
 *
 * Relative ages go through Intl.RelativeTimeFormat rather than message
 * keys: EN/RU/AZ pluralise differently and the platform already knows how.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"

type JobStatus =
  | "ok"
  | "stale"
  | "never"
  | "onDemand"
  | "noRunner"
  | "untracked"

interface BackgroundJob {
  key: string
  trigger: "request" | "timer" | "cron" | "worker"
  status: JobStatus
  lastRunAt: string | null
  ageMinutes: number | null
  evidence: string
  detail: Array<{ key: string; value: string }>
}

interface Inventory {
  backend: "bullmq" | "inprocess"
  generatedAt: string
  overall: JobStatus
  jobs: BackgroundJob[]
}

/** Amber for "late", red for "nothing runs this", neutral for the two
 *  states that are information rather than a fault. */
const STATUS_CLASS: Record<JobStatus, string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
  stale: "border-amber-300 bg-amber-50 text-amber-900",
  never: "border-amber-300 bg-amber-50 text-amber-900",
  noRunner: "border-red-300 bg-red-50 text-red-900",
  untracked: "border-border bg-muted text-muted-foreground",
  onDemand: "border-border bg-muted text-muted-foreground",
}

function useRelativeAge(locale: string) {
  return useCallback(
    (minutes: number): string => {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
      if (minutes < 60) return rtf.format(-minutes, "minute")
      if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), "hour")
      return rtf.format(-Math.round(minutes / (60 * 24)), "day")
    },
    [locale],
  )
}

export function BackgroundJobs() {
  const t = useTranslations("adminQueue.jobs")
  const locale = useLocale()
  const relative = useRelativeAge(locale)
  const [data, setData] = useState<Inventory | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch("/api/admin/background-jobs")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as Inventory)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <section className="space-y-3" data-testid="background-jobs">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        {data && (
          <span
            className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_CLASS[data.overall]}`}
            data-testid="background-jobs-overall"
          >
            {t(`status.${data.overall}`)}
          </span>
        )}
        <button
          onClick={() => refresh()}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          data-testid="background-jobs-refresh"
        >
          ↻ {t("refresh")}
        </button>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl">{t("subtitle")}</p>

      {err && (
        <div className="text-sm text-red-600 border border-red-300 bg-red-50 rounded p-2">
          ❌ {err}
        </div>
      )}
      {loading && !data && (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      )}

      {data && (
        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="p-2">{t("col.job")}</th>
                <th className="p-2">{t("col.trigger")}</th>
                <th className="p-2">{t("col.lastRun")}</th>
                <th className="p-2">{t("col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr
                  key={j.key}
                  className="border-t border-border align-top"
                  data-testid={`background-job-${j.key}`}
                >
                  <td className="p-2">
                    <div className="font-medium">{t(`name.${j.key}`)}</div>
                    <div className="text-xs text-muted-foreground max-w-md">
                      {t(`desc.${j.key}`)}
                    </div>
                    <div className="text-[11px] font-mono text-muted-foreground/70 mt-0.5">
                      {j.evidence}
                    </div>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {t(`trigger.${j.trigger}`)}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {j.lastRunAt && j.ageMinutes !== null ? (
                      <>
                        <div>{relative(j.ageMinutes)}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(j.lastRunAt).toLocaleString(locale)}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t("noTrace")}</span>
                    )}
                    {j.detail.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {j.detail.map((d) => (
                          <div key={d.key}>
                            {t(`detail.${d.key}`)}: {d.value}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs border whitespace-nowrap ${STATUS_CLASS[j.status]}`}
                    >
                      {t(`status.${j.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
