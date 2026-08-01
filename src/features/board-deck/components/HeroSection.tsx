/**
 * Phase 7.G Turn XLVIII (Board Deck v2 Turn 2) — Hero section.
 *
 * Apple/Stripe minimalist top-of-page rebuild. v1 had three stacked
 * blocks (header strip + Holding totals stat-grid + composite-scores
 * table); v2 collapses the headline into one breath: huge AI-generated
 * narrative + ONE hero metric + 3 lead-in lines. Reads in 5 seconds.
 *
 * **Server component** — pure props in, no client interactivity. The
 * page (`page.tsx`) builds the snapshot + narration, then hands them
 * here. Test-friendly: `HeroSection.test.tsx` renders with fixture
 * data without next-intl provider thanks to `vitest.setup.ts`'s
 * EXPLICIT_LABELS map.
 *
 * Failure mode: when `narration === null` (LLM down / no Anthropic
 * key), the hero falls back to a calmer "{org.name} · {period}
 * review" headline + only the hero metric. Three lead-in lines are
 * suppressed (no narrative source). This keeps the layout shape
 * stable so the page doesn't jump on degradation.
 */

import { getTranslations } from "next-intl/server";
import type { NarrationOutput } from "@/lib/board-deck/narrate-snapshot";
import type { HoldingComposite } from "@/features/board-deck/lib/holding-composite";

export interface HeroSectionProps {
  org: { name: string };
  period: string;
  generatedAt: string;
  composite: HoldingComposite;
  narration: NarrationOutput | null;
}

/** Pull the first sentence from a paragraph. Used to build 3 lead-in
 *  lines beneath the hero metric — single sentence per paragraph,
 *  scannable in 5 seconds. Edge case: paragraph with no period
 *  terminator → returns the whole paragraph + ".". */
function firstSentence(paragraph: string): string {
  const trimmed = paragraph.trim();
  // Match up to the first sentence-terminator (period / question / bang
  // followed by whitespace OR end-of-string). Keeps the terminator.
  const match = trimmed.match(/^[^.!?]*[.!?](?=\s|$)/);
  if (match) return match[0];
  // No terminator — append a period so the hero looks deliberate.
  return trimmed.endsWith(".") || trimmed.endsWith("!") || trimmed.endsWith("?")
    ? trimmed
    : trimmed + ".";
}

export async function HeroSection({
  org,
  period,
  generatedAt,
  composite,
  narration,
}: HeroSectionProps) {
  // Match project pattern: scope at "terminal", full nested key path
  // passed to `t()`. Mirrors AlertsPanel.tsx + AuditFeed.tsx — keeps
  // EXPLICIT_LABELS lookup tractable in vitest.setup.ts.
  const t = await getTranslations("terminal");

  const headline =
    narration?.headline ??
    t("boardDeck.hero.fallbackHeadline", { org: org.name, period });

  // Hero metric label — composite uses 0-100 scale; show "—" + a
  // neutral helper line if the holding has no scored sub-cos.
  const scoreText = composite.score === null ? "—" : String(composite.score);

  const leadIns =
    narration !== null
      ? [
          firstSentence(narration.paragraphs[0]),
          firstSentence(narration.paragraphs[1]),
          firstSentence(narration.paragraphs[2]),
        ]
      : null;

  return (
    <section
      aria-label={t("boardDeck.hero.ariaLabel")}
      data-testid="board-deck-hero"
      className="relative bg-card text-foreground rounded-lg shadow-sm border border-border px-6 md:px-12 py-12 md:py-20 print:border-black print:shadow-none print:break-inside-avoid"
    >
      {/* Eyebrow row — small, low-contrast — anchors the page without
          competing with the headline. */}
      <div className="flex items-baseline justify-between gap-4 mb-12 md:mb-16 text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span className="font-semibold">{org.name}</span>
        <span className="font-mono normal-case tracking-normal">
          <time dateTime={generatedAt}>{period}</time> · {t("boardDeck.hero.eyebrowSuffix")}
        </span>
      </div>

      {/* Headline — the load-bearing element. AI when available, calm
          fallback otherwise. */}
      <h1
        data-testid="hero-headline"
        className="text-3xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.1] max-w-4xl mb-12 md:mb-16 print:text-black"
      >
        {headline}
      </h1>

      {/* Hero metric — single number, dramatic scale. JetBrains Mono
          gives the digits weight; the supporting text below is calm. */}
      <div className="mb-12 md:mb-16">
        <div
          data-testid="hero-score"
          className="font-mono text-7xl md:text-8xl lg:text-9xl font-light leading-none text-foreground tabular-nums"
        >
          {scoreText}
        </div>
        <p
          data-testid="hero-score-caption"
          className="mt-3 text-sm md:text-base text-muted-foreground tracking-wide"
        >
          {composite.score === null
            ? t("composite.insufficientLabel")
            : t("boardDeck.hero.scoreLabel")}{" "}
          {/* 11.81 — the `score !== null` guard is gone. A bare "—" at 96px
              with nothing under it is the worst blank in the product: it
              reads as a broken page, not as a measured shortfall. Score
              present or absent, the caption now says how many subsidiaries
              the number rests on and how much of the holding's revenue they
              carry — because removing children can make the holding look
              better, and a disclosure that only prints on good news is not
              one. */}
          <span className="text-muted-foreground/70">
            ·{" "}
            {composite.score === null
              ? t("composite.parentNoScore", { total: composite.totalCount })
              : t("composite.parentCoverage", {
                  scored: composite.contributingCount,
                  total: composite.totalCount,
                  revenuePct: composite.revenueCoveredPct,
                })}
          </span>
        </p>
      </div>

      {/* Three lead-in lines — first sentence of each AI paragraph.
          When narration is null, suppress the block entirely (don't
          fabricate placeholders). */}
      {leadIns !== null && (
        <ul
          data-testid="hero-lead-ins"
          className="space-y-2 text-base md:text-lg text-foreground/80 leading-relaxed max-w-2xl mb-10 md:mb-12 list-none"
        >
          {leadIns.map((line, idx) => (
            <li key={idx} className="flex gap-3">
              <span
                aria-hidden="true"
                className="text-muted-foreground/50 select-none"
              >
                ·
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      {/* CTA — "Read full report" anchor scrolls to the operational
          sections below. Subtle on the hero, prominent enough to
          signal "more here if you want it". */}
      <a
        href="#full-report"
        data-testid="hero-cta"
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors print:hidden"
      >
        {t("boardDeck.hero.cta")}
        <span aria-hidden="true">→</span>
      </a>

      {/* AI attribution — tiny footer when narration ran. Compliance
          + transparency. Never on print (footer cleanly handles that
          via Turn 4 FooterActions). */}
      {narration !== null && (
        <p
          data-testid="hero-ai-attribution"
          className="mt-10 text-[10px] font-mono text-muted-foreground/60 tracking-wide print:hidden"
        >
          {t("boardDeck.hero.aiAttribution", {
            model: narration.modelName,
            version: narration.promptVersion,
          })}
        </p>
      )}
    </section>
  );
}
