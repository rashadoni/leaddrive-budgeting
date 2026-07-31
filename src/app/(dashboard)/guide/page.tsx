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
import { getTranslations } from "next-intl/server";
import { GuideViewer, type GuideLanguage } from "@/features/guide/GuideViewer";

export const dynamic = "force-dynamic";

const SUPPORTED: GuideLanguage[] = ["en", "ru", "az"];

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: `${t("guide")} · BudgetPro` };
}

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

  // The prod image is Next.js `output: "standalone"`; the Dockerfile must
  // COPY `docs/` into the runtime stage (it does as of the P0-1 UX fix). If
  // the file is still missing for any reason, degrade to a friendly notice
  // INSIDE the dashboard layout instead of throwing a 500 — a single missing
  // file must never take down the page a non-technical user opens to learn.
  let raw: string;
  try {
    raw = await readFile(guidePath, "utf8");
  } catch {
    return <GuideUnavailable lang={lang} />;
  }

  // Rewrite relative image paths so they resolve to public/.
  const markdown = raw.replace(
    /]\(guide\/screenshots\//g,
    "](/guide/screenshots/",
  );

  return <GuideViewer markdown={markdown} lang={lang} />;
}

const UNAVAILABLE_COPY: Record<GuideLanguage, { title: string; body: string }> =
  {
    en: {
      title: "Guide temporarily unavailable",
      body: "The user guide could not be loaded right now. Please try again in a moment or contact your administrator.",
    },
    ru: {
      title: "Руководство временно недоступно",
      body: "Не удалось загрузить руководство. Попробуйте позже или обратитесь к администратору.",
    },
    az: {
      title: "Bələdçi müvəqqəti əlçatmazdır",
      body: "Bələdçini hazırda yükləmək mümkün olmadı. Bir azdan yenidən cəhd edin və ya administratora müraciət edin.",
    },
  };

function GuideUnavailable({ lang }: { lang: GuideLanguage }) {
  const copy = UNAVAILABLE_COPY[lang];
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">{copy.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
      </div>
    </div>
  );
}
