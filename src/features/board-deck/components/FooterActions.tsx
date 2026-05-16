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

import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowRight, FileDown } from "lucide-react";
import { PrintButton } from "@/app/(dashboard)/budgeting/board-deck/PrintButton";
import { ExportPptxButton } from "@/app/(dashboard)/budgeting/board-deck/ExportPptxButton";
import { ExportPdfButton } from "@/app/(dashboard)/budgeting/board-deck/ExportPdfButton";

/**
 * Phase 7.G Turn LV — Suspense fallback for ExportPptxButton.
 *
 * Turn LIV gave ExportPptxButton a `useSearchParams()` dependency
 * (URL-thread for `?lang=` + `?regenerate=`). Per Next.js App Router
 * spec, any client component reading `useSearchParams` MUST sit
 * inside a `<Suspense>` boundary or the parent route is forced to
 * dynamic-render-only. The board-deck page is fully dynamic today
 * (auth + DB + searchParams), so the absence of Suspense was non-
 * fatal — but it would become a hard build error if the route ever
 * ships `export const dynamic = "force-static"`.
 *
 * Architect Turn-LIV flagged as a defensive follow-up; closed here.
 *
 * The fallback renders an inert button skeleton matching the live
 * button's exact dimensions so the footer layout doesn't shift
 * during the brief client-hydration tick on page load.
 */
function ExportPptxFallback() {
  return (
    <div
      data-testid="export-pptx-fallback"
      className="flex items-center gap-2 print:hidden"
    >
      <button
        type="button"
        disabled
        aria-hidden="true"
        className="inline-flex items-center gap-2 rounded border border-[#00D4AA]/40 bg-[#00D4AA]/5 text-[#00D4AA]/60 px-3 py-1.5 text-sm cursor-not-allowed"
      >
        <FileDown size={14} aria-hidden="true" />
        Export PPTX
      </button>
    </div>
  );
}

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
          <Suspense fallback={<ExportPptxFallback />}>
            <ExportPptxButton period={period} />
          </Suspense>
          {/* Phase 7.G Turn XLVII recovery (2026-05-16) — server-side PDF
              export via Playwright headless Chromium. Sibling to the PPTX
              button; no Suspense wrapper needed because ExportPdfButton
              doesn't consume `useSearchParams`. */}
          <ExportPdfButton period={period} />
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
