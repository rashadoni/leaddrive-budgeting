/**
 * 2026-05-26 — In-app user guide page (EN / RU / AZ).
 *
 * Renders `docs/USER_GUIDE.<lang>.md` as a beautiful presentation-style
 * surface inside the dashboard. Auth-required (uses dashboard layout
 * so sidebar + header come for free).
 *
 * Language selection:
 *   - `?lang=en|ru|az` query param → server reads the right file
 *   - Default: ru
 *   - Invalid → falls back to ru
 *
 * Architecture:
 *  - Server component reads markdown at request-time and rewrites image
 *    paths from `guide/screenshots/*.png` → `/guide/screenshots/*.png`
 *    so Next.js serves them from `public/`.
 *  - Client wrapper (`GuideViewer`) handles TOC scroll-spy + persistent
 *    checkbox state + print trigger + language toggle.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { GuideViewer, type GuideLanguage } from "@/features/guide/GuideViewer";

export const dynamic = "force-dynamic";

const SUPPORTED: GuideLanguage[] = ["en", "ru", "az"];

export const metadata = {
  title: "User Guide · BudgetPro",
};

export default async function GuidePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const params = await searchParams;
  const requestedLang = (params.lang ?? "").toLowerCase();
  const lang: GuideLanguage = SUPPORTED.includes(
    requestedLang as GuideLanguage,
  )
    ? (requestedLang as GuideLanguage)
    : "ru";

  // Read markdown from repo root. process.cwd() is the project root at
  // runtime (Next.js convention).
  const guidePath = path.join(
    process.cwd(),
    "docs",
    `USER_GUIDE.${lang}.md`,
  );
  const raw = await readFile(guidePath, "utf8");

  // Rewrite relative image paths so they resolve to public/.
  const markdown = raw.replace(
    /]\(guide\/screenshots\//g,
    "](/guide/screenshots/",
  );

  return <GuideViewer markdown={markdown} lang={lang} />;
}
