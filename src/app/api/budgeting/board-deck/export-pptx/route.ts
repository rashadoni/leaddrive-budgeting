/**
 * Phase 7.G Turn LII (Board Deck v2 Turn 5/5) — PPTX export aligned to
 * the page redesign.
 *
 * v1 (pre-Turn LII) shipped 4 dense operational slides:
 *   1. Cover (org/period/totals + KPI strip)
 *   2. Composite-scores TABLE (every operational sub-co × 6 columns)
 *   3. Active alerts grouped by severity (text wall)
 *   4. Status grid (cells × indicators colored grid)
 *
 * v2 ships the same info architecture as the page (`page.tsx` Turn LI):
 *   1. Cover — organization label (small) + huge AI headline + hero
 *      composite score + period + 3-line lead-in (first sentence of
 *      each AI paragraph).
 *   2. Narrative — 3-paragraph executive summary in serif body, AI
 *      attribution footer.
 *   3. Key metrics — 3 hero numbers (composite / red cells / total
 *      cells) with band-tinted accent bars + footer pointing to the
 *      live terminal for the trend chart (PPT can't host the SVG
 *      cleanly without a rasterise step that pptxgenjs doesn't ship).
 *   4. Top alerts — top-3 critical-first cards (severity dot + rule
 *      name pill + message body + affected sub-cos), or an "all
 *      systems green" hero panel.
 *
 * Theme: light cream `#F5F1EA` background + near-black `#1A2332` ink
 * matches the page's `--background` / `--foreground` tokens. Heading
 * accent `#7D55C7` (AI lavender) reused for AI eyebrow + hero metric
 * accent.
 *
 * Companion to `/budgeting/board-deck` page. Calls the same shared
 * `buildBoardSnapshot` + cache-read-only narration helpers, so the deck
 * is byte-identical between the live page and the downloadable PPTX
 * within a 24h cache window.
 *
 * Localization: same `getTranslations("terminal")` + `industries`
 * scopes the page uses; rule names + messages render in the user's
 * locale (resolved by next-intl middleware).
 *
 * Auth: `requireAuth` — any authenticated org member can export.
 *
 * Runtime: `nodejs` — pptxgenjs uses Node Buffer + JSZip; edge runtime
 * doesn't support either.
 */

import { NextRequest, NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import PptxGenJS from "pptxgenjs";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getLogger } from "@/lib/log";

// Phase 8 D4 final (2026-05-29) — structured logger.
const log = getLogger("api:board-deck:export-pptx");
import { currentBakuYear, parsePeriod, PeriodParseError } from "@/lib/risk/periods";
import {
  DEFAULT_ALERT_RULE_IDS,
  type AlertMatch,
  type AlertSeverity,
} from "@/lib/risk/alert-rules";
import {
  localizeAlertMessageParams,
  type IndustryTranslator,
} from "@/lib/risk/alert-message-i18n";
import { buildBoardSnapshot } from "@/lib/board-deck/build-snapshot";
import { buildTrendSeries } from "@/features/board-deck/lib/build-trend-series";
import { prisma } from "@/lib/prisma";
import {
  isNarrationLanguage,
  type NarrationLanguage,
  type NarrationOutput,
} from "@/lib/board-deck/narrate-snapshot";
import { getCachedNarration } from "@/lib/board-deck/get-or-create-narration";
import { getCompanyScope } from "@/lib/rbac/company-scope";
import { computeHoldingComposite } from "@/features/board-deck/lib/holding-composite";
import { verifyBatchNarrative } from "@/lib/risk/batch-narrative-fact-check";
import { RISK_TAG_PENALTY_TABLE } from "@/lib/risk/composite-score";

export const runtime = "nodejs";
// PPTX serialization can be CPU-heavy for a large holding.
export const maxDuration = 90;

// Light theme palette — mirrors page.tsx Turn LI design tokens.
const BG_CREAM = "F5F1EA";
const INK = "1A2332";
const INK_MUTED = "5A6478";
const INK_FAINT = "8892A6";
const CARD_WHITE = "FFFFFF";
const ACCENT_AI = "7D55C7"; // AI lavender (eyebrow + hero metric)
const BAND_GREEN = "00B886";
const BAND_AMBER = "F0A93B";
const BAND_RED = "E04848";
const BAND_GREY = "C8CDD8";

const BAND_HEX: Record<string, string> = {
  green: BAND_GREEN,
  amber: BAND_AMBER,
  red: BAND_RED,
  unknown: BAND_GREY,
};

const SEVERITY_DOT: Record<AlertSeverity, string> = {
  critical: BAND_RED,
  warning: BAND_AMBER,
  info: BAND_GREEN,
};

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;
  const { orgId } = auth;

  const rawPeriod =
    req.nextUrl.searchParams.get("period") ?? currentBakuYear();
  try {
    parsePeriod(rawPeriod);
  } catch (err) {
    if (err instanceof PeriodParseError) {
      return NextResponse.json(
        { error: "Invalid period", message: err.message },
        { status: 400 },
      );
    }
    throw err;
  }
  const period = rawPeriod;

  const scope = await getCompanyScope(orgId, auth.userId, auth.role);
  const snapshot = await buildBoardSnapshot({
    orgId,
    period,
    companyIds: scope.ids == null ? null : [...scope.ids],
  });
  if (!snapshot) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 },
    );
  }

  const langParam = req.nextUrl.searchParams.get("lang");
  const locale = await getLocale();
  const narrationLanguage: NarrationLanguage =
    typeof langParam === "string" && isNarrationLanguage(langParam)
      ? langParam
      : isNarrationLanguage(locale)
        ? locale
        : "en";
  const tTerminal = await getTranslations({
    locale: narrationLanguage,
    namespace: "terminal",
  });
  const tIndustries = (await getTranslations({
    locale: narrationLanguage,
    namespace: "industries",
  })) as unknown as IndustryTranslator;
  // Exports are read-only: include the exact cached narrative if present,
  // otherwise export the deterministic snapshot without invoking paid AI.
  const cachedNarration = await getCachedNarration({
    organizationId: orgId,
    snapshot,
    language: narrationLanguage,
  });
  let narration: NarrationOutput | null = cachedNarration?.narration ?? null;
  if (narration) {
    const factCheck = verifyBatchNarrative(
      `${narration.headline}\n${narration.paragraphs.join("\n")}`,
      {
        period,
        totals: snapshot.totals,
        compositeByCompany: snapshot.compositeByCompany,
        countsByCompany: snapshot.countsByCompany,
        matchesBySeverity: snapshot.matchesBySeverity,
      },
    );
    // PPTX cannot yet render the on-page fact-check banner. Withhold a
    // flagged narrative rather than exporting unsupported claims silently.
    if (factCheck.flags.length > 0) narration = null;
  }

  // Phase 7.G Turn LVI — 12-month trailing composite trend for the
  // dedicated chart slide. Mirror the page renderer (`page.tsx`)
  // contract: try/catch with fallback to [] so a Prisma transient
  // failure doesn't kill the deck — the chart slide just renders
  // its empty-state placeholder.
  //
  // Phase 7.G Turn LVII — single derivation of operationalIds +
  // holdingComposite at the handler boundary (architect Turn-LVI ⚠️
  // closure: operationalIds was computed twice — once here for trend,
  // once inside renderBoardDeckPptx for hero metric. Now computed once
  // and threaded as parameter; renderBoardDeckPptx is dumber + DRY).
  const operationalIds = snapshot.operational.map((co) => co.id);
  const indicatorIds = snapshot.indicators.map((ind) => ind.id);
  const holdingComposite = computeHoldingComposite(
    snapshot.compositeByCompany,
    operationalIds,
  );
  let trendSeries: Awaited<ReturnType<typeof buildTrendSeries>> = [];
  try {
    trendSeries = await buildTrendSeries(
      {
        organizationId: orgId,
        currentPeriod: period,
        operationalIds,
        indicatorIds,
        weightByIndicatorId: new Map(
          snapshot.indicators.map((indicator) => [
            indicator.id,
            indicator.weight ?? 1,
          ]),
        ),
        riskTagsByCompany: snapshot.riskTagsByCompany,
      },
      { prisma },
    );
  } catch (err) {
    log.error("buildTrendSeries failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    trendSeries = [];
  }

  const body = await renderBoardDeckPptx(
    snapshot,
    tTerminal,
    tIndustries,
    narration,
    trendSeries,
    holdingComposite,
    narrationLanguage,
    cachedNarration?.generatedAt ?? null,
    cachedNarration?.isStale ?? false,
  );

  const filename = `board-deck-${snapshot.org.slug}-${period}.pptx`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function firstSentence(paragraph: string): string {
  const trimmed = paragraph.trim();
  if (trimmed.length === 0) return "";
  const match = trimmed.match(/[^.!?]+[.!?]/);
  if (match) return match[0].trim();
  return trimmed;
}

function selectTopAlertMatches(
  byBucket: Record<AlertSeverity, AlertMatch[]>,
  limit: number,
): Array<{ match: AlertMatch; severity: AlertSeverity }> {
  const out: Array<{ match: AlertMatch; severity: AlertSeverity }> = [];
  const order: AlertSeverity[] = ["critical", "warning", "info"];
  for (const sev of order) {
    for (const match of byBucket[sev]) {
      if (out.length >= limit) return out;
      out.push({ match, severity: sev });
    }
  }
  return out;
}

async function renderBoardDeckPptx(
  snap: Awaited<ReturnType<typeof buildBoardSnapshot>> & object,
  tTerminal: Awaited<ReturnType<typeof getTranslations>>,
  tIndustries: IndustryTranslator,
  narration: NarrationOutput | null,
  trendSeries: Awaited<ReturnType<typeof buildTrendSeries>>,
  holdingComposite: ReturnType<typeof computeHoldingComposite>,
  language: NarrationLanguage,
  narrationGeneratedAt: string | null,
  narrationIsStale: boolean,
): Promise<ArrayBuffer> {
  const tx = tTerminal as (key: string, values?: Record<string, unknown>) => string;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `Board Snapshot — ${snap.org.name} — ${snap.period}`;
  pptx.author = "BudgetPro Risk Terminal";
  pptx.company = snap.org.name;

  const heroBandHex =
    BAND_HEX[holdingComposite.band ?? "unknown"] ?? BAND_GREY;

  // ───────────────────────────── Slide 1 — Cover ─────────────────────────────
  const cover = pptx.addSlide();
  cover.background = { color: BG_CREAM };

  // Top bar — org label + period (mono, right-aligned)
  cover.addText(snap.org.name, {
    x: 0.6,
    y: 0.4,
    w: 8.0,
    h: 0.4,
    fontFace: "Inter",
    fontSize: 11,
    color: INK_MUTED,
    bold: true,
    charSpacing: 4,
  });
  cover.addText(tx("boardDeck.pptx.period", { period: snap.period }), {
    x: 8.6,
    y: 0.4,
    w: 4.1,
    h: 0.4,
    fontFace: "Courier New",
    fontSize: 10,
    color: INK_FAINT,
    align: "right",
    charSpacing: 3,
  });

  // AI eyebrow + huge headline
  cover.addText(
    narration ? tx("boardDeck.pptx.aiSummary") : tx("boardDeck.pptx.deterministicSnapshot"),
    {
    x: 0.6,
    y: 1.5,
    w: 12.1,
    h: 0.35,
    fontFace: "Inter",
    fontSize: 11,
    color: ACCENT_AI,
    bold: true,
    charSpacing: 5,
    },
  );
  const headline =
    narration?.headline ??
    (tTerminal as (k: string, v?: Record<string, unknown>) => string)(
      "boardDeck.hero.fallbackHeadline",
      {
        org: snap.org.name,
        period: snap.period,
      },
    );
  cover.addText(headline, {
    x: 0.6,
    y: 1.95,
    w: 12.1,
    h: 1.6,
    fontFace: "Inter",
    fontSize: 36,
    color: INK,
    bold: true,
    valign: "top",
  });

  // Hero composite score block
  const scoreText =
    holdingComposite.score === null
      ? "—"
      : String(holdingComposite.score);
  cover.addShape("rect", {
    x: 0.6,
    y: 3.85,
    w: 0.08,
    h: 1.8,
    fill: { color: heroBandHex },
    line: { color: heroBandHex, width: 0 },
  });
  cover.addText(tx("boardDeck.pptx.holdingComposite"), {
    x: 0.9,
    y: 3.95,
    w: 5.0,
    h: 0.3,
    fontFace: "Inter",
    fontSize: 10,
    color: INK_FAINT,
    bold: true,
    charSpacing: 4,
  });
  cover.addText(scoreText, {
    x: 0.9,
    y: 4.25,
    w: 5.0,
    h: 1.4,
    fontFace: "Courier New",
    fontSize: 80,
    color: INK,
    bold: true,
    valign: "top",
  });
  cover.addText(
    holdingComposite.score === null
      ? tx("boardDeck.pptx.contributing", {
          contributing: 0,
          total: holdingComposite.totalCount,
        })
      : tx("boardDeck.pptx.contributing", {
          contributing: holdingComposite.contributingCount,
          total: holdingComposite.totalCount,
        }),
    {
      x: 0.9,
      y: 5.4,
      w: 5.0,
      h: 0.3,
      fontFace: "Inter",
      fontSize: 10,
      color: INK_MUTED,
    },
  );

  // 3 lead-in lines (right column) — first sentence of each AI paragraph
  if (narration && narration.paragraphs.length > 0) {
    const leadIns = narration.paragraphs
      .slice(0, 3)
      .map(firstSentence)
      .filter((s) => s.length > 0);
    leadIns.forEach((line, idx) => {
      cover.addShape("rect", {
        x: 6.4,
        y: 4.0 + idx * 0.55,
        w: 0.04,
        h: 0.4,
        fill: { color: INK_FAINT },
        line: { color: INK_FAINT, width: 0 },
      });
      cover.addText(line, {
        x: 6.55,
        y: 3.95 + idx * 0.55,
        w: 6.2,
        h: 0.5,
        fontFace: "Inter",
        fontSize: 12,
        color: INK,
        valign: "top",
      });
    });
  }

  // CTA + footer
  cover.addText(
    tx("boardDeck.pptx.coverSummary", {
      operational: snap.totals.operational,
      observed: snap.cells.length,
      expected: snap.totals.cells,
      red: snap.totals.red,
      amber: snap.totals.amber,
      green: snap.totals.green,
    }),
    {
      x: 0.6,
      y: 6.4,
      w: 12.1,
      h: 0.3,
      fontFace: "Courier New",
      fontSize: 9,
      color: INK_MUTED,
    },
  );
  cover.addText(
    tx("boardDeck.pptx.evidenceFooter"),
    {
      x: 0.6,
      y: 6.9,
      w: 12.1,
      h: 0.3,
      fontFace: "Inter",
      fontSize: 9,
      color: INK_FAINT,
      italic: true,
    },
  );

  // ───────────────────────────── Slide 2 — Narrative ─────────────────────────
  // Only rendered when narration is non-null. When the LLM call failed
  // or no key, slide 2 is skipped — the deck still ships with cover +
  // metrics + alerts.
  if (narration !== null) {
    const narrSlide = pptx.addSlide();
    narrSlide.background = { color: BG_CREAM };
    narrSlide.addText(tx("boardDeck.pptx.executiveNarrative"), {
      x: 0.6,
      y: 0.4,
      w: 12.1,
      h: 0.35,
      fontFace: "Inter",
      fontSize: 11,
      color: ACCENT_AI,
      bold: true,
      charSpacing: 5,
    });
    narrSlide.addText(narration.headline, {
      x: 0.6,
      y: 0.85,
      w: 12.1,
      h: 0.9,
      fontFace: "Inter",
      fontSize: 22,
      color: INK,
      bold: true,
    });

    // Three-paragraph body — laid out vertically; serif (Georgia) per
    // page.tsx Turn LI NarrativeSection. PPTX font fallback chain:
    // Georgia is a system font on macOS/Windows/PowerPoint web.
    const PARA_X = 0.6;
    const PARA_W = 12.1;
    const PARA_START_Y = 2.1;
    const PARA_H = 1.55;
    const PARA_GAP = 0.15;
    narration.paragraphs.forEach((paragraph, idx) => {
      narrSlide.addText(paragraph, {
        x: PARA_X,
        y: PARA_START_Y + idx * (PARA_H + PARA_GAP),
        w: PARA_W,
        h: PARA_H,
        fontFace: "Georgia",
        fontSize: 14,
        color: INK,
        valign: "top",
      });
    });
    narrSlide.addText(
      tx(
        narrationIsStale
          ? "boardDeck.pptx.aiAttributionStale"
          : "boardDeck.pptx.aiAttribution",
        {
          model: narration.modelName,
          version: narration.promptVersion,
          generatedAt: narrationGeneratedAt ?? "—",
        },
      ),
      {
        x: 0.6,
        y: 6.95,
        w: 12.1,
        h: 0.3,
        fontFace: "Courier New",
        fontSize: 9,
        color: INK_FAINT,
      },
    );
  }

  // ───────────────────────────── Slide 3 — Key metrics ───────────────────────
  const metricsSlide = pptx.addSlide();
  metricsSlide.background = { color: BG_CREAM };
  metricsSlide.addText(tx("boardDeck.pptx.keyMetrics"), {
    x: 0.6,
    y: 0.4,
    w: 12.1,
    h: 0.35,
    fontFace: "Inter",
    fontSize: 11,
    color: ACCENT_AI,
    bold: true,
    charSpacing: 5,
  });
  metricsSlide.addText(
    tx("boardDeck.pptx.periodOverview", { period: snap.period }),
    {
      x: 0.6,
      y: 0.85,
      w: 12.1,
      h: 0.5,
      fontFace: "Inter",
      fontSize: 16,
      color: INK,
      bold: true,
    },
  );

  const metrics: Array<{
    label: string;
    value: string;
    accent: string;
    context: string;
  }> = [
    {
      label: tx("boardDeck.pptx.holdingComposite"),
      value: scoreText,
      accent: heroBandHex,
      context:
        holdingComposite.score === null
          ? tx("boardDeck.pptx.noContributors")
          : tx("boardDeck.pptx.contributing", {
              contributing: holdingComposite.contributingCount,
              total: holdingComposite.totalCount,
            }),
    },
    {
      label: tx("boardDeck.metrics.redCellsLabel"),
      value: String(snap.totals.red),
      accent: BAND_RED,
      context: tx("boardDeck.pptx.redContext", {
        red: snap.totals.red,
        observed: snap.cells.length,
        expected: snap.totals.cells,
      }),
    },
    {
      label: tx("boardDeck.pptx.operationalEntities"),
      value: String(snap.totals.operational),
      accent: ACCENT_AI,
      context: tx("boardDeck.pptx.indicatorsTracked", {
        indicators: snap.totals.indicators,
      }),
    },
  ];
  const cardW = 3.85;
  const cardH = 3.0;
  const cardGap = 0.3;
  const cardTotalW = metrics.length * cardW + (metrics.length - 1) * cardGap;
  const cardStartX = (13.33 - cardTotalW) / 2;
  const cardY = 2.0;
  metrics.forEach((m, i) => {
    const cx = cardStartX + i * (cardW + cardGap);
    metricsSlide.addShape("rect", {
      x: cx,
      y: cardY,
      w: cardW,
      h: cardH,
      fill: { color: CARD_WHITE },
      line: { color: BAND_GREY, width: 0.5 },
    });
    metricsSlide.addShape("rect", {
      x: cx,
      y: cardY,
      w: 0.07,
      h: cardH,
      fill: { color: m.accent },
      line: { color: m.accent, width: 0 },
    });
    metricsSlide.addText(m.label.toUpperCase(), {
      x: cx + 0.3,
      y: cardY + 0.3,
      w: cardW - 0.5,
      h: 0.35,
      fontFace: "Inter",
      fontSize: 10,
      color: INK_FAINT,
      bold: true,
      charSpacing: 4,
    });
    metricsSlide.addText(m.value, {
      x: cx + 0.3,
      y: cardY + 0.7,
      w: cardW - 0.5,
      h: 1.6,
      fontFace: "Courier New",
      fontSize: 60,
      color: INK,
      bold: true,
      valign: "top",
    });
    metricsSlide.addText(m.context, {
      x: cx + 0.3,
      y: cardY + 2.4,
      w: cardW - 0.5,
      h: 0.4,
      fontFace: "Inter",
      fontSize: 10,
      color: INK_MUTED,
    });
  });
  metricsSlide.addText(
    tx("boardDeck.pptx.trendNext"),
    {
      x: 0.6,
      y: 6.95,
      w: 12.1,
      h: 0.3,
      fontFace: "Inter",
      fontSize: 9,
      color: INK_FAINT,
      italic: true,
    },
  );

  // ───────────────────────────── Slide 4 — Trend chart ───────────────────────
  // Phase 7.G Turn LVI — native pptxgenjs `addChart('line', ...)` for
  // the 12-month trailing composite trend. Earlier turns parked the
  // chart with a "Open the Risk Terminal" footer because pptxgenjs
  // SVG-rasterise is browser-only (`IMG_BROKEN` in Node — see lib
  // dist `STEP 5: SVG-PNG previews`). pptxgenjs's native chart engine
  // emits a real PowerPoint chart object that scales cleanly + opens
  // editable in PowerPoint/Keynote, no rasterisation required.
  //
  // Empty-state path: `trendSeries === []` (Prisma transient or no
  // ops/indicators) → render the "no monthly data yet" placeholder
  // instead of an empty chart (which pptxgenjs accepts but renders
  // ugly).
  const trendSlide = pptx.addSlide();
  trendSlide.background = { color: BG_CREAM };
  trendSlide.addText(tx("boardDeck.metrics.trendTitle"), {
    x: 0.6,
    y: 0.4,
    w: 12.1,
    h: 0.35,
    fontFace: "Inter",
    fontSize: 11,
    color: ACCENT_AI,
    bold: true,
    charSpacing: 5,
  });
  trendSlide.addText(
    tx("boardDeck.pptx.trendSubtitle", { period: snap.period }),
    {
      x: 0.6,
      y: 0.85,
      w: 12.1,
      h: 0.5,
      fontFace: "Inter",
      fontSize: 16,
      color: INK,
      bold: true,
    },
  );

  const hasAnyTrendData = trendSeries.some((p) => p.score !== null);
  if (!hasAnyTrendData) {
    trendSlide.addShape("rect", {
      x: 1.5,
      y: 2.5,
      w: 10.33,
      h: 2.5,
      fill: { color: CARD_WHITE },
      line: { color: BAND_GREY, width: 0.5 },
    });
    trendSlide.addText(tx("boardDeck.metrics.trendEmpty"), {
      x: 1.5,
      y: 3.5,
      w: 10.33,
      h: 0.5,
      fontFace: "Inter",
      fontSize: 14,
      color: INK_MUTED,
      align: "center",
      italic: true,
    });
  } else {
    // pptxgenjs Line chart contract: `data: [{name, labels[], values[]}]`.
    // Null months are gaps on the page (M-restart in SVG); pptxgenjs
    // line charts treat `null` in `values[]` as a gap natively, so we
    // can pass-through. Labels are short month codes (e.g. "May") so
    // 12-point X-axis stays legible.
    //
    // Phase 7.G Turn LVII — `Intl.DateTimeFormat` replaces hardcoded
    // EN month-name array (architect Turn-LVI 💡 closure). One
    // formatter instance reused per chart render; locale stays "en"
    // since PowerPoint chart axis labels are EN-only in current
    // export contract.
    const monthFmt = new Intl.DateTimeFormat(language, {
      month: "short",
      timeZone: "UTC",
    });
    const labels = trendSeries.map((p) => {
      const [, monthStr] = p.period.split("-");
      const monthIdx = Number(monthStr) - 1;
      if (monthIdx < 0 || monthIdx > 11) return p.period;
      return monthFmt.format(new Date(Date.UTC(2000, monthIdx, 1)));
    });
    const values = trendSeries.map((p) => p.score);
    trendSlide.addChart(
      "line",
      [{ name: tx("boardDeck.pptx.compositeScore"), labels, values }],
      {
        x: 0.6,
        y: 1.6,
        w: 12.1,
        h: 4.8,
        chartColors: [ACCENT_AI],
        showLegend: false,
        showTitle: false,
        catAxisLabelFontFace: "Inter",
        catAxisLabelFontSize: 10,
        catAxisLabelColor: INK_MUTED,
        valAxisLabelFontFace: "Courier New",
        valAxisLabelFontSize: 10,
        valAxisLabelColor: INK_MUTED,
        valAxisMinVal: 0,
        valAxisMaxVal: 100,
        lineSize: 3,
        lineDataSymbol: "circle",
        lineDataSymbolSize: 8,
        lineDataSymbolLineColor: ACCENT_AI,
      },
    );
    // Footnote — current-period score callout for the reader's eye.
    const lastPoint = trendSeries[trendSeries.length - 1];
    if (lastPoint && lastPoint.score !== null) {
      trendSlide.addText(
        tx("boardDeck.pptx.latest", {
          period: lastPoint.period,
          score: lastPoint.score,
          band: lastPoint.band ? tx(`boardDeck.pptx.bands.${lastPoint.band}`) : "",
        }),
        {
          x: 0.6,
          y: 6.55,
          w: 12.1,
          h: 0.4,
          fontFace: "Courier New",
          fontSize: 11,
          color: INK,
          bold: true,
        },
      );
    }
  }
  trendSlide.addText(
    tx("boardDeck.pptx.trendBoundary"),
    {
      x: 0.6,
      y: 6.95,
      w: 12.1,
      h: 0.3,
      fontFace: "Inter",
      fontSize: 9,
      color: INK_FAINT,
      italic: true,
    },
  );

  // ───────────────────────────── Slide 5 — Top alerts ────────────────────────
  const alertsSlide = pptx.addSlide();
  alertsSlide.background = { color: BG_CREAM };
  alertsSlide.addText(tx("boardDeck.topAlerts.eyebrow"), {
    x: 0.6,
    y: 0.4,
    w: 12.1,
    h: 0.35,
    fontFace: "Inter",
    fontSize: 11,
    color: ACCENT_AI,
    bold: true,
    charSpacing: 5,
  });
  alertsSlide.addText(
    snap.matches.length === 0
      ? tx("boardDeck.pptx.noRulesTriggered")
      : tx("boardDeck.pptx.rankedAlerts", { total: snap.matches.length }),
    {
      x: 0.6,
      y: 0.85,
      w: 12.1,
      h: 0.5,
      fontFace: "Inter",
      fontSize: 16,
      color: INK,
      bold: true,
    },
  );

  if (snap.matches.length === 0) {
    alertsSlide.addShape("rect", {
      x: 1.5,
      y: 2.5,
      w: 10.33,
      h: 2.5,
      fill: { color: CARD_WHITE },
      line: { color: BAND_GREY, width: 0.5 },
    });
    alertsSlide.addText("◆", {
      x: 1.5,
      y: 2.7,
      w: 10.33,
      h: 1.2,
      fontFace: "Inter",
      fontSize: 64,
      color: BAND_GREY,
      align: "center",
      bold: true,
    });
    alertsSlide.addText(
      tx("boardDeck.topAlerts.allClear"),
      {
        x: 1.5,
        y: 4.0,
        w: 10.33,
        h: 0.5,
        fontFace: "Inter",
        fontSize: 16,
        color: INK,
        align: "center",
        bold: true,
      },
    );
  } else {
    const top = selectTopAlertMatches(snap.matchesBySeverity, 3);
    const cardWidth = 12.1;
    const cardHeight = 1.6;
    const cardGapY = 0.2;
    const cardStartY = 2.1;
    top.forEach(({ match, severity }, idx) => {
      const cy = cardStartY + idx * (cardHeight + cardGapY);
      alertsSlide.addShape("rect", {
        x: 0.6,
        y: cy,
        w: cardWidth,
        h: cardHeight,
        fill: { color: CARD_WHITE },
        line: { color: BAND_GREY, width: 0.5 },
      });
      alertsSlide.addShape("rect", {
        x: 0.6,
        y: cy,
        w: 0.08,
        h: cardHeight,
        fill: { color: SEVERITY_DOT[severity] },
        line: { color: SEVERITY_DOT[severity], width: 0 },
      });

      // Localize rule name + message body the same way the page does.
      let ruleLabel = match.ruleName;
      if (DEFAULT_ALERT_RULE_IDS.has(match.ruleId)) {
        try {
          ruleLabel = tTerminal(`alerts.rules.${match.ruleId}` as never);
        } catch {
          // fall through
        }
      }
      let body = match.message;
      if (match.messageKey && DEFAULT_ALERT_RULE_IDS.has(match.ruleId)) {
        try {
          const localizedParams = localizeAlertMessageParams(
            match.messageParams,
            tIndustries,
          );
          body = tTerminal(
            match.messageKey as never,
            localizedParams as never,
          );
        } catch {
          // fall through
        }
      }
      const affected = match.affectedCompanyIds
        .map((id) => snap.idToCode.get(id) ?? id.slice(0, 8))
        .join(", ");

      alertsSlide.addText(
        tx(
          severity === "critical"
            ? "alertsPanel.severityCritical"
            : severity === "warning"
              ? "alertsPanel.severityWarning"
              : "alertsPanel.severityInfo",
        ).toUpperCase(),
        {
        x: 0.85,
        y: cy + 0.15,
        w: 1.4,
        h: 0.3,
        fontFace: "Inter",
        fontSize: 9,
        color: SEVERITY_DOT[severity],
        bold: true,
        charSpacing: 4,
        },
      );
      alertsSlide.addText(ruleLabel, {
        x: 2.3,
        y: cy + 0.15,
        w: 10.3,
        h: 0.35,
        fontFace: "Inter",
        fontSize: 12,
        color: INK,
        bold: true,
      });
      alertsSlide.addText(body, {
        x: 0.85,
        y: cy + 0.55,
        w: 11.7,
        h: 0.7,
        fontFace: "Inter",
        fontSize: 11,
        color: INK,
        valign: "top",
      });
      if (affected.length > 0) {
        alertsSlide.addText(tx("boardDeck.pptx.affected", { codes: affected }), {
          x: 0.85,
          y: cy + 1.25,
          w: 11.7,
          h: 0.3,
          fontFace: "Courier New",
          fontSize: 9,
          color: INK_FAINT,
        });
      }
    });

    if (snap.matches.length > top.length) {
      alertsSlide.addText(
        tx("boardDeck.pptx.showingAlerts", {
          showing: top.length,
          total: snap.matches.length,
        }),
        {
          x: 0.6,
          y: 6.95,
          w: 12.1,
          h: 0.3,
          fontFace: "Inter",
          fontSize: 9,
          color: INK_FAINT,
          italic: true,
        },
      );
    }
  }

  // ───────────────────────────── Slide 6 — Qualitative flags ────────────────
  // The hero composite already includes these fixed penalties. Export the
  // classifications and their internal-evidence boundary so the score cannot
  // shift invisibly in a board pack.
  const flagsSlide = pptx.addSlide();
  flagsSlide.background = { color: BG_CREAM };
  flagsSlide.addText(tx("boardDeck.riskFlags.title"), {
    x: 0.6,
    y: 0.4,
    w: 12.1,
    h: 0.4,
    fontFace: "Inter",
    fontSize: 11,
    color: ACCENT_AI,
    bold: true,
    charSpacing: 4,
  });
  flagsSlide.addText(tx("boardDeck.riskFlags.subtitle"), {
    x: 0.6,
    y: 0.9,
    w: 12.1,
    h: 0.7,
    fontFace: "Inter",
    fontSize: 14,
    color: INK,
  });
  const flagRows = snap.operational.flatMap((company) =>
    (snap.riskTagsByCompany.get(company.id) ?? []).map((tag) => ({
      company,
      tag,
      penalty: RISK_TAG_PENALTY_TABLE[tag] ?? 0,
    })),
  );
  if (flagRows.length === 0) {
    flagsSlide.addText(tx("boardDeck.riskFlags.empty"), {
      x: 1.2,
      y: 2.7,
      w: 10.9,
      h: 1,
      fontFace: "Inter",
      fontSize: 15,
      color: INK_MUTED,
      align: "center",
      italic: true,
    });
  } else {
    flagRows.slice(0, 14).forEach(({ company, tag, penalty }, index) => {
      const y = 1.8 + index * 0.34;
      let industry = company.industry ?? "—";
      if (company.industry) {
        try {
          industry = tIndustries(company.industry as never);
        } catch {
          // Keep stored code as a transparent fallback.
        }
      }
      flagsSlide.addText(
        `${company.code} · ${company.name} · ${industry}`,
        {
          x: 0.6,
          y,
          w: 7.2,
          h: 0.28,
          fontFace: "Inter",
          fontSize: 10,
          color: INK,
        },
      );
      flagsSlide.addText(
        `${tag in RISK_TAG_PENALTY_TABLE ? tx(`boardDeck.riskFlags.tags.${tag}.label` as never) : tag} · ${tx(
          "boardDeck.riskFlags.penalty",
          { penalty },
        )}`,
        {
          x: 7.9,
          y,
          w: 4.8,
          h: 0.28,
          fontFace: "Courier New",
          fontSize: 9,
          color: INK_MUTED,
          align: "right",
        },
      );
    });
    if (flagRows.length > 14) {
      flagsSlide.addText(
        tx("boardDeck.pptx.flagsShowing", {
          showing: 14,
          total: flagRows.length,
        }),
        {
          x: 0.6,
          y: 6.85,
          w: 12.1,
          h: 0.3,
          fontFace: "Inter",
          fontSize: 9,
          color: INK_FAINT,
          italic: true,
        },
      );
    }
  }

  const out = await pptx.write({ outputType: "arraybuffer" });
  return out as ArrayBuffer;
}
