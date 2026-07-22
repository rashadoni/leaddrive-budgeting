/**
 * Phase 7.N wiring (2026-05-26) — Qualitative Risk Flags section.
 *
 * Renders the new "Risk Flags" board-deck section that surfaces the
 * `Company.settings.riskTags` finance ops marks per entity. Three
 * canonical flags from `RISK_TAGS` enum:
 *   - subsidy_dependency  → ⚠ Gov-policy exposure (-5 composite)
 *   - non_transparent_structure → 🛡 Audit caveat (-8 composite)
 *   - data_absence → ⚪ Coverage gap (-12 composite)
 *
 * Section is conditional: renders nothing when no operational entity
 * carries a flag. When one or more do, the board owner sees them as
 * a compact grouped block so the qualitative caveats sit next to the
 * quantitative composite scores.
 *
 * Pure presentational — caller (board-deck page.tsx) passes the
 * `riskTagsByCompany` map from BoardSnapshot.
 */

import { AlertTriangle, ShieldAlert, Database } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { RISK_TAG_PENALTY_TABLE } from "@/lib/risk/composite-score";
import type { BoardSnapshot } from "@/lib/board-deck/build-snapshot";

type Operational = BoardSnapshot["operational"];

export interface RiskFlagsSectionProps {
  operational: Operational;
  riskTagsByCompany: BoardSnapshot["riskTagsByCompany"];
}

/** Per-tag display metadata. Icons chosen for at-a-glance read on
 *  printed deck pages: warning triangle for policy, shield for audit,
 *  database for data coverage. */
const TAG_META: Record<
  string,
  {
    icon: typeof AlertTriangle
    accent: string
    bg: string
  }
> = {
  subsidy_dependency: {
    icon: AlertTriangle,
    accent: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200/70 dark:border-amber-800/40",
  },
  non_transparent_structure: {
    icon: ShieldAlert,
    accent: "text-rose-700 dark:text-rose-300",
    bg: "bg-rose-50 dark:bg-rose-950/30 border-rose-200/70 dark:border-rose-800/40",
  },
  data_absence: {
    icon: Database,
    accent: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-100 dark:bg-slate-900/40 border-slate-300/70 dark:border-slate-700/40",
  },
}

export async function RiskFlagsSection({
  operational,
  riskTagsByCompany,
}: RiskFlagsSectionProps) {
  const t = await getTranslations("terminal.boardDeck.riskFlags")
  const tIndustries = await getTranslations("industries")
  // Build: for each operational company that has tags, render its
  // flagged entries.
  const rows = operational
    .map((co) => ({
      co,
      tags: riskTagsByCompany.get(co.id) ?? [],
    }))
    .filter((r) => r.tags.length > 0)

  // Tally per-tag totals for a one-line summary header.
  const tally = new Map<string, number>()
  for (const r of rows) {
    for (const t of r.tags) tally.set(t, (tally.get(t) ?? 0) + 1)
  }

  return (
    <section
      data-testid="board-deck-risk-flags"
      className="mt-14 print:break-before-page"
    >
      <header className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl tracking-tight text-foreground">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            {t("subtitle")}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
            {t("flaggedEntities")}
          </div>
          <div className="font-mono text-2xl tabular-nums text-foreground">
            {rows.length}
          </div>
        </div>
      </header>

      {/* Penalty key — small inline legend so reviewers know how the
          composite math worked. Keeps the section self-explanatory. */}
      {rows.length === 0 ? (
        <p data-testid="board-deck-risk-flags-empty" className="text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : <><div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {Object.entries(tally)
          .sort()
          .map(([tag, count]) => {
            const meta = TAG_META[tag]
            if (!meta) return null
            const Icon = meta.icon
            const penalty = RISK_TAG_PENALTY_TABLE[tag] ?? 0
            return (
              <span key={tag} className="inline-flex items-center gap-1.5">
                <Icon className={`h-3.5 w-3.5 ${meta.accent}`} aria-hidden />
                <span className="font-medium">{t(`tags.${tag}.label` as never)}</span>
                <span className="tabular-nums">×{count}</span>
                <span className="text-muted-foreground/70">{t("penalty", { penalty })}</span>
              </span>
            )
          })}
      </div>

      {/* Entity rows — code · name · industry · tag chips */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {rows.map(({ co, tags }) => (
          <div
            key={co.id}
            className="flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {co.code}
                </span>
                <span className="text-sm font-medium text-foreground truncate">
                  {co.name}
                </span>
              </div>
              {co.industry && (
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mt-0.5">
                  {(() => {
                    try { return tIndustries(co.industry as never) }
                    catch { return co.industry }
                  })()}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {tags.map((tag) => {
                const meta = TAG_META[tag]
                if (!meta) return null
                const Icon = meta.icon
                return (
                  <span
                    key={tag}
                    title={t(`tags.${tag}.description` as never)}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.bg} ${meta.accent}`}
                  >
                    <Icon className="h-3 w-3" aria-hidden />
                    {t(`tags.${tag}.label` as never)}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div></>}
    </section>
  )
}
