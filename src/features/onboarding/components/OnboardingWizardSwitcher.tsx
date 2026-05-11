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
import { ImportWizard } from "./ImportWizard"
import { ImportWizardMulti } from "./ImportWizardMulti"

type WizardMode = "single" | "multi"

const DEFAULT_MODE: WizardMode = "multi"

export function OnboardingWizardSwitcher() {
  const [mode, setMode] = useState<WizardMode>(DEFAULT_MODE)

  return (
    <div className="space-y-4" data-testid="onboarding-wizard-switcher">
      <fieldset className="flex items-center gap-2 rounded-lg border border-gray-700 bg-card p-1 w-fit" aria-label="Wizard mode">
        <legend className="sr-only">Wizard mode</legend>
        <button
          type="button"
          onClick={() => setMode("multi")}
          aria-pressed={mode === "multi"}
          data-testid="mode-multi-button"
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            mode === "multi"
              ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40"
              : "text-muted-foreground hover:bg-gray-800"
          }`}
        >
          Multi-sheet
          <span className="ml-1 text-[10px] uppercase tracking-wider opacity-70">default</span>
        </button>
        <button
          type="button"
          onClick={() => setMode("single")}
          aria-pressed={mode === "single"}
          data-testid="mode-single-button"
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            mode === "single"
              ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40"
              : "text-muted-foreground hover:bg-gray-800"
          }`}
        >
          Single sheet
        </button>
      </fieldset>

      {mode === "multi" ? <ImportWizardMulti /> : <ImportWizard />}
    </div>
  )
}
