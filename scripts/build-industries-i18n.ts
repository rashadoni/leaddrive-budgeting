/**
 * Phase 7.G Turn LVIII — emit `messages/{en,ru,az}.json:industries.*`
 * slice from canonical `src/lib/industries/data.ts`.
 *
 * Closes 80-turn-stale architect Turn-G Round-1 💡 (`industries.*` JSON
 * namespace duplicating data already in the canonical seed array, with
 * silent translation-value drift between the two).
 *
 * Pre-LVIII state:
 *   - EN JSON had industry CODES instead of human names
 *     (`"hospitality": "hospitality"` — clearly a bug).
 *   - RU JSON had abbreviated lowercase forms ("гостеприимство")
 *     while seed had proper-case full names ("Гостиничный бизнес").
 *   - AZ JSON also had lowercase forms. Drift was silent until
 *     someone happened to inspect alert-message renderings in non-EN
 *     locales.
 *   - The Turn-G consistency-guard test (`alert-message-i18n.test.ts`)
 *     caught code-key drift but NOT translation-value drift.
 *
 * Post-LVIII contract:
 *   - This script is the ONLY way the `industries.*` JSON slice gets
 *     written. Manual edits to that slice will be reverted on next run.
 *   - The script alphabetizes keys for deterministic diffs (matches
 *     existing JSON behavior — keys were already alphabetized).
 *   - A guard test (`industries-i18n-sync.test.ts`) asserts the JSON
 *     content matches the canonical TS data; CI catches any drift
 *     introduced via direct JSON edit.
 *
 * Why preserve the JSON files (instead of switching consumers to read
 * `INDUSTRIES` directly):
 *   - next-intl pipeline expects a JSON-loaded message namespace.
 *   - Server + client + test paths all consume `getTranslations` /
 *     `useTranslations` uniformly. Forking the lookup just for
 *     industries would create inconsistency.
 *   - The slice IS the canonical i18n source for next-intl; the TS
 *     array is the canonical source for `Industry` table seed +
 *     this i18n emitter. The build step keeps both in sync without
 *     coupling next-intl to Prisma.
 *
 * Run:
 *   npm run i18n:industries
 *   # or directly: npx tsx scripts/build-industries-i18n.ts
 *
 * Exit codes: 0 = wrote (or no-op no-change), 1 = error.
 *
 * Idempotency: re-running with no canonical-data change leaves all
 * three JSON files byte-identical (no spurious diff in `git status`).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { INDUSTRIES } from "../src/lib/industries/data";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

type Locale = "en" | "ru" | "az";

const LOCALES: Locale[] = ["en", "ru", "az"];

function pickName(seed: (typeof INDUSTRIES)[number], locale: Locale): string {
  if (locale === "en") return seed.nameEn;
  if (locale === "ru") return seed.nameRu ?? seed.nameEn;
  return seed.nameAz ?? seed.nameEn;
}

/** Build the `industries.*` slice for a given locale, alphabetised. */
function buildSlice(locale: Locale): Record<string, string> {
  const slice: Record<string, string> = {};
  const sorted = [...INDUSTRIES].sort((a, b) => a.code.localeCompare(b.code));
  for (const seed of sorted) {
    slice[seed.code] = pickName(seed, locale);
  }
  return slice;
}

/** Read JSON, replace `industries` slice, write back with the file's
 *  existing 2-space indentation + trailing newline. */
function rewriteLocale(locale: Locale): { changed: boolean; path: string } {
  const path = resolve(REPO_ROOT, "messages", `${locale}.json`);
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const nextSlice = buildSlice(locale);
  const prevSlice = parsed.industries;
  const prevJson =
    prevSlice === undefined ? undefined : JSON.stringify(prevSlice);
  const nextJson = JSON.stringify(nextSlice);
  if (prevJson === nextJson) {
    return { changed: false, path };
  }
  parsed.industries = nextSlice;
  // 2-space indent + trailing newline matches the project's existing
  // JSON formatting (verified via `jq --indent 2`).
  const out = JSON.stringify(parsed, null, 2) + "\n";
  writeFileSync(path, out, "utf8");
  return { changed: true, path };
}

function main() {
  console.log(
    `[i18n:industries] writing industries.* slice to ${LOCALES.length} locales from ${INDUSTRIES.length} canonical entries…`,
  );
  let changedCount = 0;
  for (const locale of LOCALES) {
    const { changed, path } = rewriteLocale(locale);
    const rel = path.replace(REPO_ROOT + "/", "");
    if (changed) {
      console.log(`  ~ ${rel} (rewrote industries.*)`);
      changedCount += 1;
    } else {
      console.log(`  · ${rel} (no change)`);
    }
  }
  console.log("");
  if (changedCount === 0) {
    console.log("All locales were already in sync with the canonical TS data.");
  } else {
    console.log(
      `Updated ${changedCount}/${LOCALES.length} locale file(s). Review the diff + commit.`,
    );
  }
}

try {
  main();
} catch (err) {
  console.error("[i18n:industries] FAILED:", err);
  process.exit(1);
}
