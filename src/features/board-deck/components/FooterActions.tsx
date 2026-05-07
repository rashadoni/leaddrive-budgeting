/**
 * Phase 7.G Turn LI (Board Deck v2 Turn 4) — bottom-of-page actions.
 *
 * Migrates the Terminal back-link + ExportPptx + Print buttons from
 * the Turn-XLVIII utility-bar (above the hero) to the page footer.
 * The hero owns the visual story; controls live below where they
 * don't compete with the headline. Print-hidden so the printed deck
 * doesn't carry the buttons.
 *
 * Pure presentational — wraps the existing `<PrintButton>` +
 * `<ExportPptxButton>` client components plus a `Link` to Risk
 * Terminal.
 */

import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PrintButton } from "@/app/(dashboard)/budgeting/board-deck/PrintButton";
import { ExportPptxButton } from "@/app/(dashboard)/budgeting/board-deck/ExportPptxButton";

export interface FooterActionsProps {
  period: string;
}

export async function FooterActions({ period }: FooterActionsProps) {
  const t = await getTranslations("terminal");
  return (
    <section
      aria-label={t("boardDeck.footer.ariaLabel")}
      data-testid="board-deck-footer-actions"
      className="rounded-lg bg-card border border-border px-6 md:px-12 py-6 print:hidden"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">
            {t("boardDeck.footer.eyebrow")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("boardDeck.footer.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportPptxButton period={period} />
          <PrintButton />
          <Link
            href="/budgeting/terminal"
            data-testid="footer-terminal-link"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            <span>{t("boardDeck.footer.terminalCta")}</span>
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
