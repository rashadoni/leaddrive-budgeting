"use client"

/**
 * Phase 7.G Turn CXIV (Phase 7.B v2 Day 4 — slice 3, page wiring) —
 * mode toggle between single-sheet and multi-sheet onboarding wizards.
 *
 * **Default = multi** (per user direction Turn CXIV pick A): multi-sheet
 * is now the primary onboarding path; most production workbooks have
 * multiple sheets (P&L, BS, CF, etc.) and the legacy single-sheet flow
 * forced users to manually pick one sheet at a time. Single-sheet remains
 * available as opt-in for the proven AZMADE 5-entity-template workflow.
 *
 * **Conditional render** (not both-mounted-hidden): keeps the live tree
 * lean + state isolation simple. Mode switch resets the inactive wizard
 * — acceptable trade-off since switching modes is an explicit/rare jest
 * (no parallel sessions in v1).
 *
 * **Page-level concern only.** Auth gate lives in the page route's middleware
 * stack (no per-component check needed). Both wizards already enforce auth
 * server-side via their respective routes' `requireRole("manager")` guards.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ImportWizard } from "./ImportWizard"
import { ImportWizardMulti } from "./ImportWizardMulti"

type WizardMode = "single" | "multi"

const DEFAULT_MODE: WizardMode = "multi"

export function OnboardingWizardSwitcher() {
  const [mode, setMode] = useState<WizardMode>(DEFAULT_MODE)
  const t = useTranslations("onboarding")

  return (
    <div className="space-y-4" data-testid="onboarding-wizard-switcher">
      {/* Pill-toggle pattern matching OnboardingTabbedPage tab styling
          (rounded-full + active = primary-tint + shadow). Session 9 redesign
          unified mode-toggle with the tab system above so user reads it as
          "second-level filter" not "different control class". */}
      <fieldset
        className="flex items-center gap-1 rounded-full border border-border bg-card/50 p-1 w-fit shadow-sm"
        aria-label={t("wizardModeLegend")}
      >
        <legend className="sr-only">{t("wizardModeLegend")}</legend>
        <button
          type="button"
          onClick={() => setMode("multi")}
          aria-pressed={mode === "multi"}
          data-testid="mode-multi-button"
          className={`px-4 py-1.5 text-sm rounded-full transition-all duration-150 motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
            mode === "multi"
              ? "bg-primary text-primary-foreground font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
          }`}
        >
          {t("wizardModeMulti")}
          <span
            className={`ml-1.5 text-[9px] uppercase tracking-wider font-semibold ${
              mode === "multi"
                ? "text-primary-foreground/80"
                : "text-muted-foreground/70"
            }`}
          >
            {t("wizardModeDefaultBadge")}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMode("single")}
          aria-pressed={mode === "single"}
          data-testid="mode-single-button"
          className={`px-4 py-1.5 text-sm rounded-full transition-all duration-150 motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
            mode === "single"
              ? "bg-primary text-primary-foreground font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
          }`}
        >
          {t("wizardModeSingle")}
        </button>
      </fieldset>

      {mode === "multi" ? <ImportWizardMulti /> : <ImportWizard />}
    </div>
  )
}
