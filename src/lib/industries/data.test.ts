// @vitest-environment node
/**
 * Phase 7.G Turn LVIII — guard test for `industries.*` JSON sync.
 *
 * Closes 80-turn-stale architect Turn-G Round-1 💡: the prior consistency
 * test (`alert-message-i18n.test.ts:JSON ↔ seed code consistency`) caught
 * code-key drift but NOT translation-value drift. This test fixes that gap
 * by asserting every locale's JSON `industries.*` slice is byte-equivalent
 * to what `scripts/build-industries-i18n.ts` would emit.
 *
 * Failure mode this catches:
 *   - Manual edit to `messages/{en,ru,az}.json:industries.*` that drifts
 *     from the canonical `INDUSTRIES` array in `src/lib/industries/data.ts`.
 *   - Adding a new industry to `INDUSTRIES` without re-running
 *     `npm run i18n:industries`.
 *
 * Closure path on red:
 *   `npm run i18n:industries`  →  commit the regenerated JSON.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { INDUSTRIES } from "./data";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

type Locale = "en" | "ru" | "az";

function expectedSlice(locale: Locale): Record<string, string> {
  const slice: Record<string, string> = {};
  const sorted = [...INDUSTRIES].sort((a, b) => a.code.localeCompare(b.code));
  for (const seed of sorted) {
    if (locale === "en") slice[seed.code] = seed.nameEn;
    else if (locale === "ru") slice[seed.code] = seed.nameRu ?? seed.nameEn;
    else slice[seed.code] = seed.nameAz ?? seed.nameEn;
  }
  return slice;
}

function loadIndustriesSlice(locale: Locale): unknown {
  const path = resolve(REPO_ROOT, "messages", `${locale}.json`);
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return parsed.industries;
}

describe("industries.* JSON ↔ canonical TS data sync (Turn LVIII)", () => {
  it.each<Locale>(["en", "ru", "az"])(
    "%s.json:industries matches canonical INDUSTRIES export",
    (locale) => {
      const actual = loadIndustriesSlice(locale);
      const expected = expectedSlice(locale);
      // Use deep-equality on the parsed object (key order is irrelevant
      // for runtime semantics; the build script does alphabetise but a
      // future re-arranger should still pass this test).
      expect(actual).toEqual(expected);
    },
  );

  it("INDUSTRIES has 14 entries (matches Phase 7.C-extension count)", () => {
    expect(INDUSTRIES).toHaveLength(14);
  });

  it("every entry has a non-empty nameEn (used as fallback for AZ/RU)", () => {
    for (const ind of INDUSTRIES) {
      expect(ind.nameEn.length, `code=${ind.code}`).toBeGreaterThan(0);
    }
  });

  it("codes are unique snake_case", () => {
    const codes = INDUSTRIES.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code, code).toMatch(/^[a-z][a-z_]*$/);
    }
  });
});
