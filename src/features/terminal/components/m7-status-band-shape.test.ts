/**
 * Tier-3 sub-29 Round-18 closure — promoted from Round-15 💡 to MANDATORY
 * after FOUR consecutive silent reframes (Round-15 → 16 → 17 → 18) each
 * caught one more leak in the M7 "every status indicator carries a shape
 * glyph alongside color" sweep. Empirical record: by-eye sweep doesn't
 * scale; only automation prevents Round-N+1.
 *
 * What this test enforces:
 *   For every `src/features/terminal/components/*.tsx` (excluding
 *   `*.test.tsx`), if the file ENCODES status state via Tailwind color
 *   literals (`text-[#xxx]` / `bg-[#xxx]` / `border-[#xxx]`) keyed on a
 *   status-band variable (severity / band / status / confidence / m.severity
 *   / cs.band / score.band / forecast.confidence / s.severity), the file
 *   MUST also reference one of the canonical shape helpers:
 *     - `statusShape(`         (heatmap-matrix.ts pure helper)
 *     - `forecastShape(`       (IndicatorDetail.tsx local mirror)
 *     - `shapeForDelta(`       (ComparePanel.tsx local mirror)
 *     - `SEVERITY_SHAPE`       (AlertsPanel.tsx const map)
 *
 * Failure mode: a file has band-keyed color literals but lacks any of the
 * shape-helper references. The fix is always to add the corresponding glyph
 * adjacent to the colored text/element.
 *
 * Allowlist: files where color literals are decorative (NOT band-encoded
 * status), e.g. brand-color logos, active-row highlights, ARIA-role-encoded
 * feedback. List of allowed-files documented inline; each entry must carry
 * a 1-line rationale.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS_DIR = join(
  process.cwd(),
  "src/features/terminal/components",
);

/** Status-coded Tailwind color hexes used across the terminal theme.
 *  These are the green/amber/red/info-cyan brand tokens; NOT slate-500
 *  (#6B7280) since that's also unknown-status (correct band-encoded use). */
const STATUS_COLOR_HEXES = [
  "FF4757", // red
  "FFB020", // amber (primary)
  "FFB800", // amber (secondary brand)
  "FFA502", // amber tooltip variant
  "00D4AA", // green
  "6B7280", // unknown / slate-500
] as const;

const STATUS_COLOR_PATTERN = new RegExp(
  `(?:text|bg|border)-\\[#(${STATUS_COLOR_HEXES.join("|")})\\]`,
);

/** Patterns that indicate the color literal is keyed on a status-band
 *  variable. If the file uses one of these AND a status-color literal,
 *  the file MUST also reference a shape helper. */
const BAND_KEY_PATTERNS = [
  /\bm\.severity\s*===/,
  /\bcs\.band\s*===/,
  /\bscore\.band\s*===/,
  /\bforecast\.confidence\s*===/,
  /\bconfidence\s*===\s*["']high["']/,
  /\bstatus\s*===\s*["'](?:green|amber|red|unknown|missing)["']/,
  /\bsev\s*===\s*["']/,
  /\bs\.severity\s*===/,
  /\bseverity\s*===\s*["'](?:critical|warning|info)["']/,
];

/** Canonical shape-helper references. A file using any of these is
 *  considered M7-compliant. */
const SHAPE_HELPER_PATTERNS = [
  /\bstatusShape\s*\(/,
  /\bforecastShape\s*\(/,
  /\bshapeForDelta\s*\(/,
  /\bSEVERITY_SHAPE\b/,
];

/** Files explicitly allowed to use status-coded color literals without
 *  shape helpers. Each MUST carry a rationale (decorative chrome, ARIA-
 *  role-encoded redundant signal, brand logo, etc.). */
const ALLOWLIST: Record<string, string> = {
  // Decorative chrome / brand colors / active-row indicators / ARIA-role-encoded feedback:
  "AuditTicker.tsx":
    "Decorative cyan accent on action highlight; not band-encoded.",
  "CommandBar.tsx":
    "Feedback messages use role='status' / role='alert' for ARIA redundancy; suggestion-kind chips are categorization (verb/company/indicator), not severity.",
  "RelatedFunctionsMenu.tsx":
    "Brand-color hover/active states only; no status encoding.",
  "PanelGrid.tsx":
    "Active-panel cyan ring is a focus indicator, not a status band.",
  "LayoutMenu.tsx":
    "Save button cyan accent is a brand color; pendingDelete uses border-red as alert chrome (severity is content-encoded via the dialog text).",
  "WelcomeHint.tsx":
    "First-run hint uses cyan brand accent only; no status.",
  "HotkeyToolbar.tsx":
    "Hover/active hotkey accents are brand-colored, not band-encoded.",
  "KeyboardShortcutsModal.tsx":
    "Group-header amber + close-button cyan are brand chrome only.",
  "Sparkline.tsx":
    "Line color comes from prop `status` directly; the sparkline IS the visual signal.",
  "ScenarioPanel.tsx":
    "Beaker icon + selected-scenario amber accent are chrome decoration.",
  "AuditModal.tsx":
    "No status-band content; only brand chrome.",
};

function listProductionTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listProductionTsxFiles(full));
    } else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

function fileMatchesAny(text: string, patterns: readonly RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(text)) return true;
  }
  return false;
}

describe("M7 status-band-without-shape regression guard", () => {
  const files = listProductionTsxFiles(COMPONENTS_DIR);

  it("finds the components directory and at least 10 files (sanity)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("every file with band-encoded status color literals also references a shape helper", () => {
    const offenders: Array<{ file: string; reason: string }> = [];

    for (const file of files) {
      const basename = file.split("/").pop() ?? file;

      // Allowlisted? Skip with rationale (rationale enforced by ALLOWLIST
      // type — every key requires a string value at construction).
      if (basename in ALLOWLIST) continue;

      const text = readFileSync(file, "utf8");

      const hasStatusColor = STATUS_COLOR_PATTERN.test(text);
      const hasBandKey = fileMatchesAny(text, BAND_KEY_PATTERNS);
      const hasShapeHelper = fileMatchesAny(text, SHAPE_HELPER_PATTERNS);

      // We only flag files that BOTH use a status-coded hex literal AND key
      // it on a status-band variable AND lack any shape helper. This avoids
      // false positives on chrome-only color usage (which the allowlist
      // would otherwise need to enumerate exhaustively).
      if (hasStatusColor && hasBandKey && !hasShapeHelper) {
        offenders.push({
          file: file.replace(process.cwd() + "/", ""),
          reason:
            "uses status-band-keyed Tailwind color literal but has no statusShape / forecastShape / shapeForDelta / SEVERITY_SHAPE reference",
        });
      }
    }

    if (offenders.length > 0) {
      const summary = offenders.map((o) => `  ${o.file}\n    ${o.reason}`).join("\n");
      throw new Error(
        `Found ${offenders.length} M7 sweep violation(s) — every status-band-encoded color surface must have a shape glyph companion:\n${summary}\n\n` +
          "Fix: add `<span aria-hidden=\"true\">{statusShape(...)}</span>` (or forecastShape / shapeForDelta) adjacent to the colored element.\n" +
          "If the color is genuinely decorative (chrome/brand/active-state), add the file basename to ALLOWLIST in this test with a rationale.",
      );
    }
    expect(offenders).toEqual([]);
  });

  it("ALLOWLIST entries are non-empty (rationale required)", () => {
    for (const [file, rationale] of Object.entries(ALLOWLIST)) {
      expect(rationale.trim().length, `ALLOWLIST entry for ${file} needs a rationale`).toBeGreaterThan(0);
    }
  });
});
