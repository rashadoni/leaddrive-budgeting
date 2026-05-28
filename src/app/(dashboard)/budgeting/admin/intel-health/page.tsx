/**
 * Phase 7.G Turn LXXXXIII (Phase 7.E #1 D.5d) — admin intel-health dashboard.
 *
 * Server-rendered observability for the daily intel crawl scheduler:
 * - Status pill (healthy / stale / empty)
 * - Last run timestamp + relative ("3h ago")
 * - Org's preferred language for crawl output
 * - Total IntelItem count + average relevance
 * - 7-day item ingestion sparkline
 * - Top sources + top industries (top 10 each)
 *
 * Auth: manager+ role (matches `/budgeting/audit` pattern). Sidebar
 * filters this entry out for viewer-tier users; this server-side check
 * is defense-in-depth against URL-bar bypass.
 *
 * Data model:
 * - Reads `IntelItem` rows for the org (last 30d for top-list relevance)
 * - Reads `Organization.settings.{intelLastRunAt, intelLanguage}`
 * - All aggregation done in-memory via pure helper `computeIntelHealthStats`
 *   (testable, page-component stays presentational)
 */

import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { computeIntelHealthStats } from "@/lib/intel/health-stats"

export const metadata = {
  title: "Intel Health · BudgetPro",
}

/** Format an ISO date string as a localized "3h ago", "2d ago" string. */
function relativeTime(
  iso: string | null,
  t: (k: string, vars?: Record<string, string | number>) => string,
  now: Date = new Date(),
): string {
  if (!iso) return t("relative.never")
  const ms = now.getTime() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return t("relative.justNow")
  if (min < 60) return t("relative.minutes", { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t("relative.hours", { n: hr })
  const day = Math.floor(hr / 24)
  return t("relative.days", { n: day })
}

const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  ru: "Русский",
  az: "Azərbaycanca",
}

export default async function IntelHealthPage() {
  const t = await getTranslations("adminIntelHealth")
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "manager")) {
    redirect("/budgeting")
  }

  const orgId = session?.user?.organizationId
  if (!orgId) {
    redirect("/budgeting")
  }

  // Pull last 30 days of items + org settings in parallel
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [rows, org] = await Promise.all([
    prisma.intelItem.findMany({
      where: { organizationId: orgId, fetchedAt: { gte: cutoff } },
      select: {
        fetchedAt: true,
        sourceLabel: true,
        industryTags: true,
        relevanceScore: true,
      },
      orderBy: { fetchedAt: "desc" },
    }),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    }),
  ])

  const settings = (org?.settings ?? {}) as Record<string, unknown>
  const intelLastRunAt =
    typeof settings.intelLastRunAt === "string" ? settings.intelLastRunAt : null
  const intelLanguage =
    typeof settings.intelLanguage === "string" ? settings.intelLanguage : null

  const stats = computeIntelHealthStats(rows, { intelLastRunAt, intelLanguage })
  const STATUS_PILL: Record<"healthy" | "stale" | "empty", { label: string; cls: string }> = {
    healthy: {
      label: t("status.healthy"),
      cls: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/40",
    },
    stale: {
      label: t("status.stale"),
      cls: "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/40",
    },
    empty: {
      label: t("status.empty"),
      cls: "bg-slate-500/15 text-slate-700 ring-1 ring-slate-500/40",
    },
  }
  const pill = STATUS_PILL[stats.status]
  const maxDailyCount = Math.max(1, ...stats.last7Days.map((d) => d.count))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {/* Status row */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <Label>{t("labels.status")}</Label>
          <span
            className={`inline-flex items-center px-2 py-1 rounded text-xs font-mono ${pill.cls}`}
          >
            {pill.label}
          </span>
        </Card>
        <Card>
          <Label>{t("labels.lastRun")}</Label>
          <Value>{relativeTime(stats.intelLastRunAt, t)}</Value>
          {stats.intelLastRunAt && (
            <SubText>{new Date(stats.intelLastRunAt).toLocaleString()}</SubText>
          )}
        </Card>
        <Card>
          <Label>{t("labels.outputLanguage")}</Label>
          <Value>
            {stats.intelLanguage
              ? `${LANGUAGE_LABEL[stats.intelLanguage] ?? stats.intelLanguage} (${stats.intelLanguage})`
              : t("languageDefault")}
          </Value>
        </Card>
        <Card>
          <Label>{t("labels.itemsLast30d")}</Label>
          <Value>{stats.totalItems.toLocaleString()}</Value>
          <SubText>
            {t("avgRelevance")}:{" "}
            {Number.isNaN(stats.averageRelevance)
              ? "—"
              : (stats.averageRelevance * 100).toFixed(0) + "%"}
          </SubText>
        </Card>
      </section>

      {/* 7-day sparkline */}
      <section className="rounded-lg border bg-card p-4">
        <Label>{t("sparkline.title")}</Label>
        <div className="mt-3 flex items-end gap-1 h-24">
          {stats.last7Days.map((d) => (
            <div
              key={d.date}
              className="flex-1 flex flex-col items-center gap-1 group"
              title={`${d.date}: ${d.count} ${t("sparkline.itemsAbbr")}`}
            >
              <div
                className="w-full rounded-t bg-cyan-500/40 group-hover:bg-cyan-500/70 transition-colors"
                style={{ height: `${(d.count / maxDailyCount) * 100}%` }}
              />
              <span className="text-[10px] font-mono text-muted-foreground">
                {d.date.slice(5)}
              </span>
              <span className="text-xs font-medium">{d.count}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Top sources + industries */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <Label>{t("topSources.title")}</Label>
          {stats.topSources.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">
              {t("topSources.empty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {stats.topSources.map((s) => (
                <li key={s.source} className="flex justify-between text-sm">
                  <span className="font-medium truncate max-w-[70%]">{s.source}</span>
                  <span className="font-mono text-muted-foreground">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border bg-card p-4">
          <Label>{t("topIndustries.title")}</Label>
          {stats.topIndustries.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">
              {t("topIndustries.empty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {stats.topIndustries.map((i) => (
                <li key={i.industry} className="flex justify-between text-sm">
                  <span className="font-medium truncate max-w-[70%]">{i.industry}</span>
                  <span className="font-mono text-muted-foreground">{i.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer className="text-xs text-muted-foreground border-t pt-4">
        {t.rich("footer", {
          code: (chunks) => (
            <code className="font-mono bg-muted px-1 rounded">{chunks}</code>
          ),
        })}
      </footer>
    </div>
  )
}

// Small presentational helpers — kept inline to avoid a new component file.
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-card p-4 space-y-1">{children}</div>
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs uppercase tracking-wide text-muted-foreground">{children}</p>
}

function Value({ children }: { children: React.ReactNode }) {
  return <p className="text-2xl font-semibold tabular-nums">{children}</p>
}

function SubText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}
