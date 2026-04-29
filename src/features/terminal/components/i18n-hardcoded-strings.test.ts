/**
 * Round-11 architect closure — promoted from post-Tier-3 to Tier-3-blocker.
 *
 * Three audit rounds in a row uncovered same-class hardcoded-English-string
 * regressions in terminal components (Round-9 / Round-10 / Round-11 each
 * found a fresh batch). The architect-name-driven sweep keeps missing
 * residual strings; this regression-style grep guard makes the failure
 * mode permanent and visible at CI-time.
 *
 * Scope: ALL `*.tsx` files in `src/features/terminal/components/` MUST NOT
 * contain unescaped, capitalized English strings in:
 *   - `aria-label="..."` attributes (must use `t(...)`)
 *   - `placeholder="..."` attributes
 *   - `title="..."` attributes (when the value is a quoted literal, not a
 *     template-literal expression that mixes locale-aware sub-expressions)
 *
 * False-positive guards:
 *   - Test files (`*.test.tsx`) are excluded; tests legitimately assert on
 *     literal English strings via `screen.getByLabelText("Filter X")`.
 *   - The visible-text-content sweep (e.g. `<span>Loading…</span>`) is
 *     intentionally NOT included — JSX text node detection is fragile;
 *     this test focuses on the highest-frequency drift channels (attrs).
 *
 * To extend coverage, add patterns to `BANNED_PATTERNS` below.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS_DIR = join(
  process.cwd(),
  "src/features/terminal/components",
);

/**
 * Each pattern is a regex that, when matched, indicates a hardcoded
 * English string that should be in messages.json + read via `t()`.
 *
 * Pattern shape: `attr="<Capitalized-letter><non-{-followed-by-anything>"`
 *  - `<Capitalized-letter>`: filters out lowercase technical strings
 *    like `aria-label="ariaLabel"` (which would be obviously wrong) and
 *    catches user-visible strings that start with a capital letter.
 *  - `<non-{-followed-by-anything>`: rejects template literals like
 *    `aria-label="${something}"` since those typically mix in t() calls
 *    or computed values; grep'ing is too coarse to validate them.
 */
const BANNED_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "aria-label with hardcoded English literal",
    pattern: /\baria-label="([A-Z][^"{}]*?)"/g,
  },
  {
    name: "placeholder with hardcoded English literal",
    pattern: /\bplaceholder="([A-Z][^"{}]*?)"/g,
  },
  {
    name: "title with hardcoded English literal",
    pattern: /\btitle="([A-Z][^"{}]*?)"/g,
  },
];

/** Files allowed to contain literal English in attrs (rare exceptions). */
const ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // Add file basenames here ONLY with a comment justifying why a literal
  // is correct (e.g. third-party-required attribute value).
]);

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listTsxFiles(full));
    } else if (
      entry.endsWith(".tsx") &&
      !entry.endsWith(".test.tsx") &&
      !ALLOWLIST.has(entry)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("i18n hardcoded-string guard (terminal components)", () => {
  const files = listTsxFiles(COMPONENTS_DIR);

  it("finds the components directory and at least 5 files (sanity)", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const { name, pattern } of BANNED_PATTERNS) {
    it(`rejects ${name}`, () => {
      const offenders: Array<{ file: string; line: number; match: string }> =
        [];
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        const lines = text.split("\n");
        // Reset regex state per file to make .exec safe with the global flag.
        const re = new RegExp(pattern.source, pattern.flags);
        for (let i = 0; i < lines.length; i++) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(lines[i])) !== null) {
            offenders.push({
              file: file.replace(process.cwd() + "/", ""),
              line: i + 1,
              match: m[0],
            });
            if (!re.global) break;
          }
        }
      }

      if (offenders.length > 0) {
        const summary = offenders
          .map((o) => `  ${o.file}:${o.line}\n    ${o.match}`)
          .join("\n");
        throw new Error(
          `Found ${offenders.length} hardcoded English string(s) — must use t() from next-intl:\n${summary}\n\n` +
            "Each match must be:\n" +
            "  1. Replaced with t('namespace.key') call\n" +
            "  2. Added to messages/{en,ru,az}.json under the same key\n" +
            "  3. (For tests that assert literal strings) extended in vitest.setup.ts EXPLICIT_LABELS\n",
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
