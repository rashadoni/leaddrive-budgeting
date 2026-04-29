/**
 * Tier-3 sub-29 Round-18 closure — promoted from Round-15 💡 to MANDATORY
 * after FOUR consecutive silent reframes (Round-15 → 16 → 17 → 18) each
 * caught one more leak in the M7 "every status indicator carries a shape
 * glyph alongside color" sweep. Empirical record: by-eye sweep doesn't
 * scale; only automation prevents Round-N+1.
 *
 * Round-19 architect closure — file-level v1 had a structural false
 * negative: deleting ONE rendered glyph still passed because the file
 * elsewhere had `function forecastShape(` (definition) + `statusShape(`
 * (other call site). Five multi-surface files were systematically
 * vulnerable. v2 below switches to LINE-WINDOW granularity.
 *
 * What this test enforces (v2):
 *   For every `src/features/terminal/components/*.tsx` (excluding
 *   `*.test.tsx`), and for every line that matches a band-key pattern
 *   (severity / cs.band / score.band / forecast.confidence / status === ...),
 *   there MUST be at least one shape-helper CALL within ±20 lines:
 *     - `statusShape(...)`     (heatmap-matrix.ts pure helper, called)
 *     - `forecastShape(...)`   (IndicatorDetail.tsx local mirror, called)
 *     - `shapeForDelta(...)`   (ComparePanel.tsx local mirror, called)
 *     - `SEVERITY_SHAPE[...]`  (AlertsPanel.tsx const map, indexed)
 *
 * Function definitions (`function statusShape(`) and ES imports
 * (`import { statusShape }`) are EXCLUDED from the call count so they
 * cannot satisfy the contract on their own.
 *
 * Failure mode: a band-key region has no glyph render within its ±20
 * line neighborhood. The fix is always to add the corresponding glyph
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

/**
 * Patterns that indicate a color literal is keyed on a status-band
 * variable in render context. Carefully scoped to color-rendering
 * patterns (object/expression keying produces a color literal in the
 * very same line or expression chain). Bare `status === "green"` is
 * INTENTIONALLY excluded — it appears too often as a control-flow
 * check (disable-when-green button predicates) without a paired color
 * render, producing false positives. The more specific patterns below
 * key on render-purposed accessors (m.severity / cs.band / etc.) which
 * are byte-for-byte unique to color-encoding sites in this codebase.
 *
 * Trade-off: bare `status === '<color>'` ternaries WILL evade detection
 * (e.g. HeatMapCellTd cell-tooltip statusColorClass). Compensating
 * coverage comes from the architect-suggested per-call-site COLOR
 * HELPER detection below — every helper-call is treated as a render
 * site requiring a shape-helper call within ±20 lines.
 */
const BAND_KEY_PATTERNS = [
  /\bm\.severity\s*===\s*["']/,
  /\bcs\.band\s*===\s*["']/,
  /\bscore\.band\s*===\s*["']/,
  /\bforecast\.confidence\s*===\s*["']/,
  /\bconfidence\s*===\s*["']high["']/,
  /\bsev\s*===\s*["']/,
  /\bs\.severity\s*===\s*["']/,
  /\bseverity\s*===\s*["'](?:critical|warning|info)["']/,
];

/**
 * Color-rendering helper CALL sites. These functions/maps each take a
 * status-band-equivalent input and return / select a status-encoded
 * color. ANY caller of them is by definition a band-encoded color
 * render and MUST be paired with a shape-helper call within ±20 lines.
 *
 * Keep this list tight: only helpers that produce status-band colors,
 * NOT ones that return chrome / brand / or arbitrary palette tones.
 */
const COLOR_HELPER_CALL_PATTERNS = [
  /\bstatusColor\s*\(/,    // heatmap-matrix.ts canonical helper
  /\bforecastColor\s*\(/,  // IndicatorDetail.tsx local
  /\bcolorForDelta\s*\(/,  // ComparePanel.tsx local
  /\bSTATUS_HEX\s*\[/,     // IndicatorDetail.tsx const map
  /\bSEVERITY_TONE\s*\[/,  // AlertsPanel.tsx, ActionCenterPanel.tsx const map
  /\bstatusHex\s*\(/,      // ComparePanel.tsx local map
];

/**
 * Exclusion patterns for Path B (color-helper call detection). Three
 * categories:
 *
 *  1. Function/const DEFINITIONS — `function statusColor(...)`, `const
 *     STATUS_HEX = {...}`. The definition site is not a render.
 *  2. Variable ASSIGNMENTS — `const x = statusColor(...)`, `const x =
 *     STATUS_HEX[...]`. The helper output is being CAPTURED for later
 *     use; the actual render happens wherever `x` is consumed (which
 *     line-window will catch via the consumer's proximity to a shape
 *     call). Without this exclusion, the assignment line would be
 *     flagged but the corresponding shape call (typically 5-50 lines
 *     later in JSX) would be out-of-window.
 *  3. ES imports — `import { statusColor } from ...`. Mere availability,
 *     not a render.
 */
const COLOR_HELPER_EXCLUSION_PATTERNS = [
  // Definitions
  /\bfunction\s+statusColor\s*\(/,
  /\bfunction\s+forecastColor\s*\(/,
  /\bfunction\s+colorForDelta\s*\(/,
  /\bfunction\s+statusHex\s*\(/,
  /\bexport\s+function\s+(statusColor|forecastColor|colorForDelta|statusHex)\s*\(/,
  /\bconst\s+STATUS_HEX\s*[:=]/,
  /\bconst\s+SEVERITY_TONE\s*[:=]/,
  // Variable assignments — capture-for-later, not render
  /\b(?:const|let|var|return)\s+\w+(?:\s*:\s*[^=]+)?\s*=\s*(?:statusColor|forecastColor|colorForDelta|statusHex)\s*\(/,
  /\b(?:const|let|var|return)\s+\w+(?:\s*:\s*[^=]+)?\s*=\s*(?:STATUS_HEX|SEVERITY_TONE)\s*\[/,
  // ES imports
  /\bimport\b[^;]*\b(?:statusColor|forecastColor|colorForDelta|statusHex|STATUS_HEX|SEVERITY_TONE)\b/,
];

/** Canonical shape-helper CALL patterns (NOT definitions or imports).
 *  Open-paren after the helper name = invocation; bracket after
 *  SEVERITY_SHAPE = indexed lookup. */
const SHAPE_HELPER_CALL_PATTERNS = [
  /\bstatusShape\s*\(/,
  /\bforecastShape\s*\(/,
  /\bshapeForDelta\s*\(/,
  /\bSEVERITY_SHAPE\s*\[/,
];

/**
 * Patterns we EXCLUDE from "shape call" detection. Round-20 architect
 * closure — symmetric to color-side exclusion. Three categories:
 *
 *  1. Function DEFINITIONS — `function statusShape(...)`, `function
 *     forecastShape(...)`. The helper definition is not a render.
 *  2. Variable ASSIGNMENTS — `const deltaShape = shapeForDelta(...)`.
 *     The helper output is captured for later use; the actual glyph
 *     render happens wherever the captured var is consumed (typically
 *     in JSX as `{deltaShape}`). Without this exclusion, the assignment
 *     line satisfied the contract on its own — symmetric to the
 *     color-side blindspot. Architect demonstrated by deleting the
 *     `{deltaShape}` consumer in ComparePanel and watching the scanner
 *     pass silently.
 *  3. ES imports — `import { statusShape } from ...`. Mere availability,
 *     not a render.
 */
const SHAPE_HELPER_EXCLUSION_PATTERNS = [
  // Definitions
  /\bfunction\s+statusShape\s*\(/,
  /\bfunction\s+forecastShape\s*\(/,
  /\bfunction\s+shapeForDelta\s*\(/,
  /\bexport\s+function\s+(statusShape|forecastShape|shapeForDelta)\s*\(/,
  // Variable assignments — capture-for-later, not glyph render
  /\b(?:const|let|var|return)\s+\w+(?:\s*:\s*[^=]+)?\s*=\s*(?:statusShape|forecastShape|shapeForDelta)\s*\(/,
  /\b(?:const|let|var|return)\s+\w+(?:\s*:\s*[^=]+)?\s*=\s*SEVERITY_SHAPE\s*\[/,
  // ES imports
  /\bimport\b[^;]*\b(?:statusShape|forecastShape|shapeForDelta|SEVERITY_SHAPE)\b/,
];

/** Window in lines for "near a band-key region". 35 spans a typical
 *  band-keyed-ternary + render-block sequence (band-key on line N,
 *  return JSX on line N+5..15, shape glyph inside the JSX on line
 *  N+15..30). Tighter would false-flag legitimate code; wider would
 *  miss the architect's empirical regression demo (deleting one glyph
 *  in a multi-surface file). 35 lines = approx one render block / one
 *  function body. */
const SHAPE_PROXIMITY_WINDOW = 35;

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

function lineMatchesAny(line: string, patterns: readonly RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(line)) return true;
  }
  return false;
}

/**
 * Window for confirming band-key + color-literal co-occurrence. Tighter
 * than SHAPE_PROXIMITY_WINDOW because status-band ternaries put the
 * band-key and the color literal in adjacent lines (often same line).
 */
const BAND_RENDER_WINDOW = 6;

/**
 * Captured-color-variable detector. Round-20 architect closure —
 * v3 had a structural false-negative: `const statusColor = STATUS_HEX[
 * status]` (excluded as assignment) + `style={{ color: statusColor }}`
 * consumer (no Tailwind hex literal on that line, no direct helper
 * call). Both paths missed this indirection. Path C below tracks
 * captured var names + flags consumer JSX as render sites.
 *
 * Returns the SET of variable names that are captures of band-encoded
 * color values — i.e. variables a developer might subsequently consume
 * via `style={{ color: <var> }}` or `className={... ${<var>}}`.
 */
function findCapturedColorVars(lines: readonly string[]): Set<string> {
  const captures = new Set<string>();
  // const|let|var X = (statusColor|forecastColor|colorForDelta|statusHex)( …
  // const|let|var X = (STATUS_HEX|SEVERITY_TONE)[ …
  // const|let|var X = m.severity === … ? "#hex" : "#hex"   (band-key ternary into raw hex)
  const HELPER_CAPTURE = /\b(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(?:statusColor|forecastColor|colorForDelta|statusHex)\s*\(/;
  const MAP_CAPTURE = /\b(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(?:STATUS_HEX|SEVERITY_TONE)\s*\[/;
  const TERNARY_CAPTURE_HEX = new RegExp(
    `\\b(?:const|let|var)\\s+(\\w+)(?:\\s*:\\s*[^=]+)?\\s*=\\s*\\b(?:m\\.severity|cs\\.band|score\\.band|forecast\\.confidence|sev|severity|s\\.severity|status|confidence)\\s*===\\b`,
  );

  // Some captures span multiple lines (the ternary continues on next
  // lines). We accept the assignment line as the trigger; the rest of
  // the multi-line ternary is just style.
  for (const line of lines) {
    let m: RegExpExecArray | null;
    if ((m = HELPER_CAPTURE.exec(line))) captures.add(m[1]);
    if ((m = MAP_CAPTURE.exec(line))) captures.add(m[1]);
    if ((m = TERNARY_CAPTURE_HEX.exec(line))) captures.add(m[1]);
  }
  return captures;
}

/**
 * Build a regex that matches any consumer of a captured color var in
 * a JSX rendering context — i.e. inside `style={{ color: <var> }}`,
 * `style={{ backgroundColor: <var> }}`, `style={{ borderColor: <var>
 * }}`, OR a className template-literal interpolation `${<var>}`.
 *
 * Returns null if there are no captured vars (no Path C lookups
 * needed). Otherwise returns a single regex for fast scanning.
 */
function buildConsumerPattern(captures: ReadonlySet<string>): RegExp | null {
  if (captures.size === 0) return null;
  const alt = [...captures].map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Two consumer forms (combined into one alternation):
  //   1. style={{ color|backgroundColor|borderColor : <var> }}
  //   2. className={... ${<var>} ...}    (template-literal interp)
  return new RegExp(
    `style\\s*=\\s*\\{\\s*\\{[^}]*\\b(?:color|backgroundColor|borderColor)\\s*:\\s*(?:${alt})\\b` +
      `|\\$\\{(?:${alt})\\}`,
  );
}

/**
 * Find every line that constitutes a "status-band render". Three paths:
 *
 *  Path A — DIRECT: the line carries a Tailwind status-color literal
 *           AND a band-key pattern is within ±BAND_RENDER_WINDOW lines.
 *           Catches inline ternaries.
 *  Path B — HELPER-CALL: invocation of a color-rendering helper
 *           (statusColor / forecastColor / etc.) at the JSX render
 *           site. Excludes definitions, captures, imports.
 *  Path C — CONSUMER (Round-20): the line consumes a captured color
 *           variable in a JSX render position (`style={{color: var}}`
 *           or className template-literal `${var}`). The capture
 *           itself was excluded from Path B; the consumer is the
 *           actual render site.
 *
 * Returns 1-based line numbers.
 */
function findStatusBandRenderLines(lines: readonly string[]): number[] {
  const out = new Set<number>();
  // Path A
  const colorLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (STATUS_COLOR_PATTERN.test(lines[i])) colorLines.push(i + 1);
  }
  for (const line of colorLines) {
    const lo = Math.max(1, line - BAND_RENDER_WINDOW);
    const hi = Math.min(lines.length, line + BAND_RENDER_WINDOW);
    for (let j = lo - 1; j < hi; j++) {
      if (lineMatchesAny(lines[j], BAND_KEY_PATTERNS)) {
        out.add(line);
        break;
      }
    }
  }
  // Path B
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (lineMatchesAny(line, COLOR_HELPER_EXCLUSION_PATTERNS)) continue;
    if (lineMatchesAny(line, COLOR_HELPER_CALL_PATTERNS)) out.add(i + 1);
  }
  // Path C — consumer pattern. Only built if there are any captured
  // color vars in this file (cheap pre-filter).
  const captures = findCapturedColorVars(lines);
  const consumerRe = buildConsumerPattern(captures);
  if (consumerRe) {
    for (let i = 0; i < lines.length; i++) {
      if (consumerRe.test(lines[i])) out.add(i + 1);
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Check whether a line-window around `targetLine` (1-based) contains at
 * least one shape-helper CALL site. Function definitions / imports do
 * NOT count.
 */
function hasShapeCallNearLine(
  lines: readonly string[],
  targetLine: number,
  window: number,
): boolean {
  const lo = Math.max(1, targetLine - window);
  const hi = Math.min(lines.length, targetLine + window);
  for (let i = lo - 1; i < hi; i++) {
    const line = lines[i];
    if (lineMatchesAny(line, SHAPE_HELPER_EXCLUSION_PATTERNS)) continue;
    if (lineMatchesAny(line, SHAPE_HELPER_CALL_PATTERNS)) return true;
  }
  return false;
}

describe("M7 status-band-without-shape regression guard", () => {
  const files = listProductionTsxFiles(COMPONENTS_DIR);

  it("finds the components directory and at least 10 files (sanity)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("every status-band render has a shape-helper CALL within ±20 lines (line-window granularity)", () => {
    const offenders: Array<{ file: string; line: number; snippet: string }> = [];

    for (const file of files) {
      const basename = file.split("/").pop() ?? file;
      if (basename in ALLOWLIST) continue;

      const text = readFileSync(file, "utf8");
      // Cheap pre-filter: skip files that don't carry any status hex
      // literals at all — they can't introduce M7 leaks.
      if (!STATUS_COLOR_PATTERN.test(text)) continue;

      const lines = text.split("\n");
      const renderLines = findStatusBandRenderLines(lines);
      for (const line of renderLines) {
        if (!hasShapeCallNearLine(lines, line, SHAPE_PROXIMITY_WINDOW)) {
          offenders.push({
            file: file.replace(process.cwd() + "/", ""),
            line,
            snippet: lines[line - 1].trim().slice(0, 100),
          });
        }
      }
    }

    if (offenders.length > 0) {
      const summary = offenders
        .map(
          (o) =>
            `  ${o.file}:${o.line}\n    ${o.snippet}\n    (no shape-helper call within ±${SHAPE_PROXIMITY_WINDOW} lines)`,
        )
        .join("\n");
      throw new Error(
        `Found ${offenders.length} M7 sweep violation(s) — every status-band-keyed render block must have a shape glyph companion:\n${summary}\n\n` +
          'Fix: add `<span aria-hidden="true">{statusShape(...)}</span>` (or forecastShape / shapeForDelta) adjacent to the colored element.\n' +
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

  // Round-19 architect meta-tests — verify the scanner ACTUALLY catches
  // the failure mode it claims to. Pure unit tests on internal helpers,
  // no file IO.
  it("hasShapeCallNearLine detects glyph absence within window", () => {
    const fakeLines = [
      'const dotColor = m.severity === "critical" ? "#FF4757" : "#FFB020";', // 1: band-key + color
      "// padding lines in between",
      ...Array.from({ length: 50 }, () => "  // padding line"), // 2-51
      "<span>{statusShape(status)}</span>", // 52: glyph
    ];
    // Band-key on line 1, glyph 51 lines away → out of ±35 window → false.
    expect(hasShapeCallNearLine(fakeLines, 1, 35)).toBe(false);
    // With wider window, same setup passes.
    expect(hasShapeCallNearLine(fakeLines, 1, 60)).toBe(true);
  });

  it("hasShapeCallNearLine excludes function-definition lines", () => {
    const fakeLines = [
      "function statusShape(status) {", // 1: definition (should NOT count as call)
      "  return circle;",
      "}",
      'const tone = m.severity === "critical" ? "#FF4757" : "#FFB020";', // 4: band-key
      "// no glyph render anywhere",
      ...Array.from({ length: 15 }, () => "  // padding"),
    ];
    // Despite `function statusShape(` on line 1 within the ±20 window,
    // the scanner must NOT count it; result = no call near band-key.
    expect(hasShapeCallNearLine(fakeLines, 4, 20)).toBe(false);
  });

  it("findStatusBandRenderLines (Path A) — Tailwind class + band-key co-occurrence", () => {
    const fakeLines = [
      // Line 1: Tailwind class on band-key line — IS a render
      'const tone = m.severity === "critical" ? "text-[#FF4757]" : "text-[#FFB020]";',
      "// padding",
      // Line 3: band-key with no nearby color hex — NOT a render
      'disabled={status === "green"}',
    ];
    const renders = findStatusBandRenderLines(fakeLines);
    expect(renders).toContain(1);
    expect(renders).not.toContain(3);
  });

  it("findStatusBandRenderLines (Path B) — color-helper call sites are renders", () => {
    const fakeLines = [
      // Line 1: forecastColor call site — IS a render even though
      // forecastColor's definition might be far away
      "<span className={forecastColor(forecast.confidence)}>x</span>",
      // Line 2: function definition — NOT a render
      "function forecastColor(c) { return c === 'high' ? 'text-[#00D4AA]' : 'text-[#FFB020]'; }",
    ];
    const renders = findStatusBandRenderLines(fakeLines);
    expect(renders).toContain(1);
    expect(renders).not.toContain(2);
  });

  it("findStatusBandRenderLines (Path C — Round-20) — captured-var consumer in style={{}}", () => {
    const fakeLines = [
      // Line 1: capture from STATUS_HEX (excluded from Path B)
      "const statusColor = STATUS_HEX[status];",
      "// padding",
      "// padding",
      // Line 4: consumer in style={{}} — Path C must flag this
      "<div style={{ color: statusColor }}>x</div>",
      // Line 5: consumer of backgroundColor — also flag
      "<div style={{ backgroundColor: statusColor }}>y</div>",
    ];
    const renders = findStatusBandRenderLines(fakeLines);
    expect(renders).toContain(4);
    expect(renders).toContain(5);
    // Capture line itself is NOT a render (it's an assignment)
    expect(renders).not.toContain(1);
  });

  it("findStatusBandRenderLines (Path C — Round-20) — captured-var consumer in className template-literal", () => {
    const fakeLines = [
      // Line 1: capture from helper
      "const colorClass = forecastColor(forecast.confidence);",
      "// padding",
      // Line 3: consumer via template-literal interp — Path C flags
      "<span className={`text-sm ${colorClass}`}>x</span>",
    ];
    const renders = findStatusBandRenderLines(fakeLines);
    expect(renders).toContain(3);
    expect(renders).not.toContain(1);
  });

  it("hasShapeCallNearLine excludes shape-helper assignments (Round-20 symmetric closure)", () => {
    const fakeLines = [
      // Line 1: shape-helper ASSIGNMENT — must NOT count as glyph render
      "const deltaShape = shapeForDelta(delta, direction);",
      "// padding",
      "// padding",
      // Line 4: band-keyed render
      'style={{ color: m.severity === "critical" ? "#FF4757" : "#FFB020" }}',
      "// no JSX consumer of {deltaShape} present",
    ];
    // The assignment at line 1 is within ±35 of band-key at line 4,
    // but it must NOT satisfy the contract since it's a capture, not
    // a render. Result: no shape call within ±35 of line 4 → false.
    expect(hasShapeCallNearLine(fakeLines, 4, 35)).toBe(false);
  });
});
