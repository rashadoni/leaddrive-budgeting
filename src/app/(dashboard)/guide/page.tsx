/**
 * 2026-05-26 — In-app user guide page.
 *
 * Renders `docs/USER_GUIDE.md` as a beautiful presentation-style
 * surface inside the dashboard. Auth-required (uses dashboard layout
 * so sidebar + header come for free).
 *
 * Architecture:
 *  - Server component reads markdown at request-time and rewrites image
 *    paths from `guide/screenshots/*.png` → `/guide/screenshots/*.png`
 *    so Next.js serves them from `public/`.
 *  - Client wrapper (`GuideViewer`) handles TOC scroll-spy + persistent
 *    checkbox state + print trigger.
 *
 * Why we read the markdown file at runtime instead of importing as
 * string: that keeps the markdown the single source of truth — edits
 * in `docs/USER_GUIDE.md` ship to /guide on next request without a
 * code change.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { GuideViewer } from "@/features/guide/GuideViewer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Руководство пользователя · BudgetPro",
};

export default async function GuidePage() {
  // Read markdown from repo root. process.cwd() is the project root at
  // runtime (Next.js convention).
  const guidePath = path.join(process.cwd(), "docs", "USER_GUIDE.md");
  const raw = await readFile(guidePath, "utf8");

  // Rewrite relative image paths so they resolve to public/.
  // markdown:  ![Login](guide/screenshots/01-login.png)
  // browser:   <img src="/guide/screenshots/01-login.png" ... />
  const markdown = raw.replace(
    /]\(guide\/screenshots\//g,
    "](/guide/screenshots/",
  );

  return <GuideViewer markdown={markdown} />;
}
