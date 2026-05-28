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
import type {
  NarrationLanguage,
  NarrationOutput,
} from "@/lib/board-deck/narrate-snapshot";
import type { FactCheckResult } from "@/lib/risk/narrative-fact-check";
import { NarrativeLanguagePicker } from "./NarrativeLanguagePicker";

export interface NarrativeSectionProps {
  narration: NarrationOutput | null;
  /** Snapshot's `generatedAt` ISO timestamp — surfaced in the
   *  attribution footer so reviewers can correlate the narrative to
   *  a specific snapshot version. */
  generatedAt: string;
  /** Currently-resolved narration language (`?lang=` or locale).
   *  Drives the active state of the language picker. */
  currentLanguage: NarrationLanguage;
  /** Phase 8 C5 — optional batch-narrative fact-check result. Renders
   *  an amber banner under the article body when flags is non-empty.
   *  Absent → no banner (back-compat with cached/older render paths). */
  factCheck?: FactCheckResult;
}

export async function NarrativeSection({
  narration,
  generatedAt,
  currentLanguage,
  factCheck,
}: NarrativeSectionProps) {
  if (narration === null) return null;
  const t = await getTranslations("terminal");

  return (
    <section
      aria-label={t("boardDeck.narrative.ariaLabel")}
      data-testid="board-deck-narrative-full"
      className="rounded-lg bg-card border border-border px-6 md:px-12 py-10 md:py-12 print:border-black print:break-inside-avoid"
    >
      <div className="flex items-center justify-between gap-4 mb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {t("boardDeck.narrative.eyebrow")}
        </p>
        <NarrativeLanguagePicker currentLanguage={currentLanguage} />
      </div>
      <div
        className="space-y-4 font-serif text-base md:text-lg leading-relaxed text-foreground/90 max-w-2xl print:text-black"
        data-testid="narrative-paragraphs"
      >
        {narration.paragraphs.map((paragraph, idx) => (
          <p key={idx}>{paragraph}</p>
        ))}
      </div>
      {/* Phase 8 C5 — batch-narrative fact-check banner. Hidden when
          factCheck absent or zero flags. Print:hidden so the on-screen
          warning doesn't bleed into the board pack. */}
      {factCheck && factCheck.flags.length > 0 && (
        <div
          data-testid="board-deck-narrative-fact-check"
          role="status"
          aria-live="polite"
          className="mt-6 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 print:hidden"
        >
          <div className="text-amber-700 dark:text-amber-300 text-[10px] uppercase tracking-wider mb-1">
            {t("varianceExplainer.factCheck.title")}
          </div>
          <ul className="space-y-1">
            {factCheck.flags.map((f, i) => (
              <li key={i} className="text-xs leading-snug text-foreground/85">
                <span className="font-mono px-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  {f.claim}
                </span>{" "}
                — {f.reason}{" "}
                <span className="text-muted-foreground">{f.suggestion}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted-foreground mt-1.5">
            {t("varianceExplainer.factCheck.summary", {
              matched: factCheck.matched,
              total: factCheck.totalChecked,
            })}
          </p>
        </div>
      )}
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
