/**
 * Phase 7.G Turn LI (Board Deck v2 Turn 4) — full AI narrative as
 * readable article.
 *
 * The Hero (Turn 2) shows the AI-generated headline + first sentence
 * of each of the 3 paragraphs. This section renders the FULL three
 * paragraphs in body type — readers who want depth scroll past the
 * hero metric/cards/trend chart and land on a calm article-style
 * block. Audience: CFO + board members who want the analyst-tone
 * narrative without the operational dump.
 *
 * Pure presentational — caller passes resolved narration. Suppresses
 * itself when narration is null (graceful degradation; rest of page
 * still useful).
 *
 * Style: serif body type at text-lg with relaxed line-height,
 * max-w-2xl for readability. AI attribution footer in mono with
 * model + prompt version.
 */

import { getTranslations } from "next-intl/server";
import type { NarrationOutput } from "@/lib/board-deck/narrate-snapshot";

export interface NarrativeSectionProps {
  narration: NarrationOutput | null;
  /** Snapshot's `generatedAt` ISO timestamp — surfaced in the
   *  attribution footer so reviewers can correlate the narrative to
   *  a specific snapshot version. */
  generatedAt: string;
}

export async function NarrativeSection({
  narration,
  generatedAt,
}: NarrativeSectionProps) {
  if (narration === null) return null;
  const t = await getTranslations("terminal");

  return (
    <section
      aria-label={t("boardDeck.narrative.ariaLabel")}
      data-testid="board-deck-narrative-full"
      className="rounded-lg bg-card border border-border px-6 md:px-12 py-10 md:py-12 print:border-black print:break-inside-avoid"
    >
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-6">
        {t("boardDeck.narrative.eyebrow")}
      </p>
      <div
        className="space-y-4 font-serif text-base md:text-lg leading-relaxed text-foreground/90 max-w-2xl print:text-black"
        data-testid="narrative-paragraphs"
      >
        {narration.paragraphs.map((paragraph, idx) => (
          <p key={idx}>{paragraph}</p>
        ))}
      </div>
      <p
        data-testid="narrative-attribution"
        className="mt-8 text-[10px] font-mono text-muted-foreground/60 tracking-wide"
      >
        {t("boardDeck.narrative.attribution", {
          model: narration.modelName,
          version: narration.promptVersion,
          generatedAt: generatedAt.replace("T", " ").slice(0, 19) + "Z",
        })}
      </p>
    </section>
  );
}
