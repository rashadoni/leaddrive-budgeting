import { redirect } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { currentBakuYear, parsePeriod, PeriodParseError } from "@/lib/risk/periods";
import { buildBoardSnapshot } from "@/lib/board-deck/build-snapshot";
import {
  isNarrationLanguage,
  type NarrationLanguage,
  type NarrationOutput,
} from "@/lib/board-deck/narrate-snapshot";
import { getCachedNarration } from "@/lib/board-deck/get-or-create-narration";
import { getCompanyScope } from "@/lib/rbac/company-scope";
import { hasRole } from "@/lib/permissions";
import { computeHoldingComposite } from "@/features/board-deck/lib/holding-composite";
import { buildTrendSeries } from "@/features/board-deck/lib/build-trend-series";
import { getLogger } from "@/lib/log";

// Phase 8 D4 final (2026-05-29) — structured logger.
const log = getLogger("page:board-deck");
import { HeroSection } from "@/features/board-deck/components/HeroSection";
import { CompositeTrendChart } from "@/features/board-deck/components/CompositeTrendChart";
import { MetricCard } from "@/features/board-deck/components/MetricCard";
import { NarrativeSection } from "@/features/board-deck/components/NarrativeSection";
import { verifyBatchNarrative } from "@/lib/risk/batch-narrative-fact-check";
import { TopAlertsSection } from "@/features/board-deck/components/TopAlertsSection";
import { RiskFlagsSection } from "@/features/board-deck/components/RiskFlagsSection";
import { FooterActions } from "@/features/board-deck/components/FooterActions";
import { NarrationControls } from "@/features/board-deck/components/NarrationControls";
import { prisma } from "@/lib/prisma";

export async function generateMetadata() {
  const t = await getTranslations("terminal.boardDeck");
  return { title: t("metaTitle") };
}

/**
 * Phase C3 v1 — Board Deck Generator.
 *
 * Print-friendly server-rendered snapshot of the holding's risk posture
 * for sharing with the board / shareholders. Mirrors the Risk Terminal's
 * matrix view but optimized for an A4 portrait page: no interactive
 * panels, no live SSE — a frozen-in-time export.
 *
 * Output sections:
 *   1. Cover header — org name, period, generated timestamp.
 *   2. Composite scores table — every operational sub-co with its
 *      C5 0-100 score + status counts (g/a/r/unknown).
 *   3. Active alerts — every match from `evaluateAlertRules` against
 *      the same matrix the Terminal sees, grouped by severity.
 *   4. Status grid — companies × indicators tile-grid showing only
 *      status colors (no values; high-density visual summary).
 *   5. Footer — caveat (v1 ships static-snapshot; live-recompute under
 *      scenario overrides arrives in v2 + Phase 6 BullMQ).
 *
 * v1 deliberately uses the browser's native Print flow rather than
 * shipping a server-side PDF pipeline (no puppeteer / @react-pdf-renderer
 * dependency). v2 follow-ups in CARRYOVER.
 */
export default async function BoardDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; lang?: string }>;
}) {
  const session = await auth();
  // `auth()` (NextAuth server-side) puts orgId at session.user.organizationId
  // — distinct from `requireAuth` (API helper) which surfaces it at
  // session.orgId. See src/lib/auth.ts:83.
  const orgId = session?.user?.organizationId;
  if (!session?.user || !orgId) {
    redirect("/budgeting");
  }

  // Phase 7.G Turn LI (v2 Turn 4) — page-level translators retired.
  // The v1 alerts list + composite-scores table consumed `tTerminal`
  // and `tIndustries` for inline localization; v2 components
  // (TopAlertsSection / NarrativeSection / FooterActions) call
  // `getTranslations` themselves. The `tMetrics` translator below
  // stays — it serves the Turn-XLIX MetricCards row.
  const params = await searchParams;
  const rawPeriod = params.period ?? currentBakuYear();
  // Architect Round-1 sub-12 ⚠️ closure: validate the period regex
  // before passing into the Prisma where-clause. Mirrors the matrix
  // endpoint's defense-in-depth at /api/indicators/matrix/route.ts:64-72.
  // Garbage input (`?period=foo`) returns the user to the budgeting hub
  // instead of silently rendering an empty page.
  try {
    parsePeriod(rawPeriod);
  } catch (err) {
    if (err instanceof PeriodParseError) {
      redirect("/budgeting");
    }
    throw err;
  }
  const period = rawPeriod;

  // Phase 7.E C3 v2 — single shared helper assembles the snapshot;
  // `/api/budgeting/board-deck/export-pptx` consumes the same helper so
  // the page render and PPTX export stay byte-for-byte identical.
  const scope = await getCompanyScope(
    orgId,
    session.user.id,
    session.user.role ?? "viewer",
  );
  const snapshot = await buildBoardSnapshot({
    orgId,
    period,
    companyIds: scope.ids == null ? null : [...scope.ids],
  });
  if (!snapshot) {
    redirect("/budgeting");
  }

  // Page loads and language switches are strictly cache-read-only. A cache
  // miss or stale row must never trigger paid AI or a tenant-data write.
  // Managers can explicitly generate through the POST-only control below.
  const localeRaw = await getLocale();
  const langParam = params.lang;
  const narrationLanguage: NarrationLanguage =
    typeof langParam === "string" && isNarrationLanguage(langParam)
      ? langParam
      : isNarrationLanguage(localeRaw)
        ? localeRaw
        : "en";
  const cachedNarration = await getCachedNarration({
    organizationId: orgId,
    snapshot,
    language: narrationLanguage,
  });
  const narration: NarrationOutput | null = cachedNarration?.narration ?? null;
  const {
    org,
    operational,
    indicators,
    compositeByCompany,
    matchesBySeverity,
    totals,
    generatedAt,
    riskTagsByCompany,
    nonScoringIndicatorIds,
  } = snapshot;
  type IndicatorShape = (typeof indicators)[number];
  // Phase 7.G Turn XLIX (v2 Turn 3) — `totals.*` consumed by the
  // supporting-metrics row below (red cells + cell count). Turn 4
  // kills the v1 operational tables but keeps the totals reads.

  // Phase 7.G Turn XLVIII (Board Deck v2 Turn 2) — promote per-company
  // composite scores to a holding-level aggregate for the Hero
  // metric. Skip-null mean across operational sub-cos (weight=1 each
  // for v1; revenue-weighting is a v2.x follow-up).
  const holdingComposite = computeHoldingComposite(
    compositeByCompany,
    operational.map((c) => c.id),
  );

  // Phase 7.G Turn XLIX (v2 Turn 3) — trailing 12-month composite
  // trend. Single Prisma findMany for all 12 months × all sub-cos ×
  // all indicators; group + average in JS. Renders as the page's
  // first hero-supporting visual (line chart). Failure mode: empty
  // series → "no trend yet" placeholder.
  const trendSeries = await buildTrendSeries(
    {
      organizationId: orgId,
      currentPeriod: period,
      operationalIds: operational.map((c) => c.id),
      indicatorIds: indicators.map((i: IndicatorShape) => i.id),
      weightByIndicatorId: new Map(
        indicators.map((indicator) => [indicator.id, indicator.weight ?? 1]),
      ),
      riskTagsByCompany,
      // 11.71 — the trend line must be computed on the same scoring rule as the
      // hero number directly above it (legal/compliance indicators excluded
      // from the financial composite by product directive).
      nonScoringIndicatorIds,
    },
    { prisma },
  ).catch((err) => {
    log.error("buildTrendSeries failed", {
      period,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  });

  // Phase 7.G Turn XLIX (v2 Turn 3) — supporting metric counts. Three
  // numbers that contextualize the hero composite: (a) red cells
  // across the holding (where pressure is concentrated), (b)
  // operational sub-cos in the red band (which sub-cos need attention),
  // (c) total indicators tracked (tells the board the breadth of the
  // monitoring surface).
  const redSubCoCount = Array.from(compositeByCompany.values()).filter(
    (c) => c.band === "red",
  ).length;
  const tMetrics = await getTranslations("terminal");

  return (
    <div
      data-testid="board-deck-guide-root"
      className="board-deck mx-auto max-w-5xl space-y-8 px-4 py-6 print:max-w-none print:px-0 print:py-0"
    >
      {/* Phase 7.G Turn XLVIII (v2 Turn 2) — Hero section: huge AI
          headline + ONE composite score + 3 lead-in lines + CTA.
          Replaces the v1 header strip + Holding totals stat-grid.
          Below this is still v1-style sections — Turn 3 ships the
          metrics row + trend chart, Turn 4 kills the operational
          tables. */}
      <HeroSection
        org={{ name: org.name }}
        period={period}
        generatedAt={generatedAt}
        composite={holdingComposite}
        narration={narration}
      />

      <section
        data-testid="board-deck-guide-evidence"
        aria-label={tMetrics("boardDeck.evidence.ariaLabel")}
        className="rounded-lg border border-border bg-card px-6 py-5 print:border-black"
      >
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {tMetrics("boardDeck.evidence.eyebrow")}
        </p>
        <div className="mt-3 grid gap-3 text-sm text-foreground/85 md:grid-cols-2">
          <p>
            {tMetrics(
              scope.ids == null
                ? "boardDeck.evidence.scopeFull"
                : "boardDeck.evidence.scopeRestricted",
              { companies: operational.length },
            )}
          </p>
          <p>
            {tMetrics("boardDeck.evidence.coverage", {
              observed: snapshot.cells.length,
              expected: totals.cells,
            })}
          </p>
          <p>{tMetrics("boardDeck.evidence.scoreMethod")}</p>
          <p>{tMetrics("boardDeck.evidence.alertBoundary")}</p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {tMetrics("boardDeck.evidence.assembledAt", {
            timestamp: generatedAt.replace("T", " ").slice(0, 19) + "Z",
            period,
          })}
        </p>
      </section>

      <NarrationControls
        period={period}
        language={narrationLanguage}
        canGenerate={hasRole(session.user.role ?? "viewer", "manager")}
        hasNarration={narration !== null}
        isStale={cachedNarration?.isStale ?? false}
      />

      {/* CTA anchor target. `sr-only` hides it visually but it stays
          in the accessibility tree so screen-reader users following the
          hero CTA `#full-report` link land on a labeled landmark.
          Architect Turn-XLVIII Quality fix: removed `aria-hidden` —
          can't be both an anchor target AND hidden from AT. */}
      <section id="full-report" className="sr-only">
        Full report
      </section>

      {/* Phase 7.G Turn XLIX (v2 Turn 3) — supporting-metrics row.
          Three calm cards beside the hero giving the reader 3 numbers
          that contextualize the composite without dragging them into
          the operational dump below. */}
      <section
        aria-label={tMetrics("boardDeck.metrics.sectionAriaLabel")}
        data-testid="board-deck-metrics-row"
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
      >
        <MetricCard
          testId="metric-red-cells"
          label={tMetrics("boardDeck.metrics.redCellsLabel")}
          value={String(totals.red)}
          context={tMetrics("boardDeck.metrics.redCellsContext", {
            total: totals.cells,
          })}
          accent={totals.red > 0 ? "red" : null}
        />
        <MetricCard
          testId="metric-red-subcos"
          label={tMetrics("boardDeck.metrics.redSubCosLabel")}
          value={String(redSubCoCount)}
          context={tMetrics("boardDeck.metrics.redSubCosContext", {
            total: operational.length,
          })}
          accent={redSubCoCount > 0 ? "red" : null}
        />
        <MetricCard
          testId="metric-indicator-coverage"
          label={tMetrics("boardDeck.metrics.indicatorCoverageLabel")}
          value={String(indicators.length)}
          context={tMetrics("boardDeck.metrics.indicatorCoverageContext", {
            sectors: new Set(
              operational.map((c) => c.industry).filter(Boolean),
            ).size,
          })}
        />
      </section>

      {/* Phase 7.G Turn XLIX (v2 Turn 3) — 12-month composite trend.
          Visual storyline: where the holding sits today vs where it
          was. Honest gaps when monthly data is missing. */}
      <CompositeTrendChart series={trendSeries} />

      {/* Phase 7.G Turn LI (v2 Turn 4) — full AI narrative as
          readable article. Hero owns the headline + first sentence;
          this section gives the depth (3 paragraphs, serif body).
          Replaces v1 inline narrative + sits ABOVE the operational
          drill-downs, which v2 has killed. */}
      <NarrativeSection
        narration={narration}
        generatedAt={cachedNarration?.generatedAt ?? generatedAt}
        isStale={cachedNarration?.isStale ?? false}
        // Phase 8 C5 — batch fact-check banner. Runs over the joined
        // headline + paragraphs against the snapshot's org-wide
        // numbers. Cheap (~1ms regex); silent when narration is null.
        factCheck={
          narration
            ? verifyBatchNarrative(
                `${narration.headline}\n${narration.paragraphs.join("\n")}`,
                {
                  period,
                  totals,
                  compositeByCompany,
                  countsByCompany: snapshot.countsByCompany,
                  matchesBySeverity,
                },
              )
            : undefined
        }
      />

      {/* Phase 7.G Turn LI (v2 Turn 4) — top 3 alerts. Calm
          "all clear" pane when zero. v1's full alerts dump (grouped
          by severity, all rules) lives in /budgeting/terminal AlertsPanel
          and is reachable via the FooterActions Terminal CTA. */}
      <TopAlertsSection matchesBySeverity={matchesBySeverity} limit={3} />

      {/* Phase 7.N wiring (2026-05-26) — Qualitative Risk Flags
          section. Renders only when at least one operational entity
          carries a Company.settings.riskTags entry; otherwise the
          deck stays clean. Source: import-risk-registry CLI + admin
          UI in /budgeting/admin/companies. */}
      <RiskFlagsSection
        operational={operational}
        riskTagsByCompany={riskTagsByCompany}
      />

      {/* Phase 7.G Turn LI (v2 Turn 4) — FooterActions absorbs the
          Turn-XLVIII utility-bar (Print + Export PPTX + Terminal
          back-link) into a single bottom-of-page block. Print-hidden;
          the printed deck doesn't carry the buttons. */}
      <FooterActions period={period} />
    </div>
  );
}

// Phase 7.G Turn LI (v2 Turn 4) — orphan helpers removed. `Stat`
// (Turn XLVIII), `BandPill` + `STATUS_PRINT_COLOR` (this turn) all
// belonged to the v1 operational-tables that v2 retired. Page is
// now ~150 LOC down from ~520 LOC v1 + Turns XLVIII/XLIX additions.
