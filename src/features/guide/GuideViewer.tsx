"use client";

/**
 * 2026-05-26 — User Guide presentation viewer.
 *
 * Three pieces glued together:
 *   1. Markdown → React via react-markdown + remark-gfm (tables, task
 *      lists, autolinks).
 *   2. Sticky left-sidebar Table of Contents built from H2/H3 headings.
 *      Active section computed via IntersectionObserver.
 *   3. Checklist persistence: every GFM `[ ] Item` becomes a real
 *      <input type="checkbox"> whose state lives in localStorage
 *      under `guide:checks`. Resetting the page doesn't lose the
 *      user's verification progress.
 *
 * Design language follows the dashboard impeccable register: tinted
 * neutrals, generous spacing, hairline borders, no card-in-card. The
 * "presentation" feel comes from the typography scale (serif H1/H2 for
 * section headers, sans body) + screenshot framing + the always-visible
 * progress counter for the checklist.
 *
 * Print: `window.print()` triggered by header button + `@media print`
 * styles in the JSX strip nav/sidebar so a clean PDF comes out.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import {
  Printer,
  CheckCircle2,
  ListChecks,
  ChevronRight,
  ExternalLink,
  Check,
} from "lucide-react";
import {
  useChecklistCount,
  useChecklistItem,
} from "./checklist-store";

export type GuideLanguage = "en" | "ru" | "az";

interface GuideViewerProps {
  markdown: string;
  lang: GuideLanguage;
}

const LANG_META: Record<GuideLanguage, { label: string; flag: string }> = {
  en: { label: "EN", flag: "English" },
  ru: { label: "RU", flag: "Русский" },
  az: { label: "AZ", flag: "Azərbaycan" },
};

const I18N = {
  en: {
    title: "User Guide",
    progress: "checked",
    reset: "reset",
    print: "Print / PDF",
    toc: "Contents",
    openTerminal: "Open Risk Terminal",
    openBoardDeck: "Open Board Deck",
    openAdmin: "Open Admin Tools",
    sourceNote: (file: string, script: string) => (
      <>
        Source: <code>{file}</code>. Screenshots regenerated via{" "}
        <code>{script}</code>. Checklist state lives in your browser (
        <code>localStorage</code>) — never sent to the server.
      </>
    ),
  },
  ru: {
    title: "Руководство пользователя",
    progress: "проверено",
    reset: "сброс",
    print: "Печать / PDF",
    toc: "Содержание",
    openTerminal: "Открыть Risk Terminal",
    openBoardDeck: "Открыть Board Deck",
    openAdmin: "Открыть Admin Tools",
    sourceNote: (file: string, script: string) => (
      <>
        Источник: <code>{file}</code>. Скриншоты переснимаются через{" "}
        <code>{script}</code>. Состояние чек-листа хранится в локальном
        браузере (<code>localStorage</code>) и не уходит на сервер.
      </>
    ),
  },
  az: {
    title: "İstifadəçi Təlimatı",
    progress: "yoxlanıldı",
    reset: "sıfırla",
    print: "Çap / PDF",
    toc: "Mündəricat",
    openTerminal: "Risk Terminal-ı aç",
    openBoardDeck: "Board Deck-i aç",
    openAdmin: "Admin Tools aç",
    sourceNote: (file: string, script: string) => (
      <>
        Mənbə: <code>{file}</code>. Skrinşotlar{" "}
        <code>{script}</code> ilə yenilənir. Yoxlama siyahısının vəziyyəti
        brauzerinizdə saxlanılır (<code>localStorage</code>) — heç vaxt
        serverə göndərilmir.
      </>
    ),
  },
};

interface TocItem {
  level: 2 | 3;
  text: string;
  slug: string;
  /** 1-indexed line number in the markdown source. Used by the renderer
   *  to map each heading back to its dedup'd slug via hast `position`. */
  sourceLine?: number;
}

/**
 * remark plugin: unwrap an image-only paragraph so the image lifts to
 * the document root. Without this, `![alt](path)` parses as a
 * paragraph containing the image — and since our `img` component
 * renders a block-level <figure>, we'd get invalid `<p><figure>...</p>`
 * HTML and a hydration warning. The standard fix is an AST-level
 * unwrap before react-markdown serializes.
 *
 * Identical behavior to the published `remark-unwrap-images` package
 * (inlined to avoid the extra dep — we already have unist-util-visit
 * transitively).
 */
function remarkUnwrapImages() {
  return (tree: Root) => {
    visit(tree, "paragraph", (node, index, parent) => {
      if (
        parent &&
        index != null &&
        node.children.length === 1 &&
        node.children[0].type === "image"
      ) {
        parent.children.splice(index, 1, node.children[0]);
      }
    });
  };
}

/** GitHub-style slugifier — keeps Cyrillic, strips emojis + punctuation. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[✀-➿]/g, "") // dingbats
    .replace(/[\u{1f000}-\u{1f9ff}]/gu, "") // emoji
    .replace(/[`~!@#$%^&*()+={}\[\]|\\:;"'<>,.?/]/g, "")
    .replace(/[\s ]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Extract H2/H3 from raw markdown to build a sidebar TOC. Skipping H1
 *  because there's only one (document title) and we render it as the
 *  hero. Skipping H4+ to keep the TOC scannable.
 *
 *  Code blocks are stripped first so a `## comment` inside a fenced
 *  block doesn't pollute the TOC.
 *
 *  Slugs are deduplicated with `-2`, `-3`, ... suffixes so multiple
 *  headings with the same text (e.g. several "Что проверить" H3s)
 *  produce unique anchors — required for valid HTML + stable React
 *  keys.
 */
function extractToc(md: string): TocItem[] {
  // Strip code blocks but PRESERVE line numbers (replace fence content
  // with empty lines) so heading line numbers stay accurate.
  const withoutCodeBlocks = md.replace(/```[\s\S]*?```/g, (block) =>
    block
      .split(/\r?\n/)
      .map(() => "")
      .join("\n"),
  );
  const lines = withoutCodeBlocks.split(/\r?\n/);
  const out: TocItem[] = [];
  const seen = new Map<string, number>();
  lines.forEach((line, idx) => {
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!m) return;
    const level = m[1].length === 2 ? 2 : 3;
    const text = m[2].replace(/^[\d.\s]+/, "").trim();
    const baseSlug = slugify(m[2]);
    const seenCount = seen.get(baseSlug) ?? 0;
    const slug = seenCount === 0 ? baseSlug : `${baseSlug}-${seenCount + 1}`;
    seen.set(baseSlug, seenCount + 1);
    out.push({
      level: level as 2 | 3,
      text,
      slug,
      sourceLine: idx + 1, // 1-indexed to match hast position.start.line
    });
  });
  return out;
}

export function GuideViewer({ markdown, lang }: GuideViewerProps) {
  const toc = useMemo(() => extractToc(markdown), [markdown]);
  const t = I18N[lang];

  // Active section tracking via IntersectionObserver
  const [activeSlug, setActiveSlug] = useState<string>("");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contentRef.current) return;
    const headings = Array.from(
      contentRef.current.querySelectorAll<HTMLElement>("h2[id], h3[id]"),
    );
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the first heading that's "visible" near top of viewport.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
        if (visible[0]?.target?.id) setActiveSlug(visible[0].target.id);
      },
      {
        rootMargin: "-80px 0px -70% 0px",
        threshold: 0,
      },
    );
    for (const h of headings) observer.observe(h);
    return () => observer.disconnect();
  }, [markdown]);

  // Set of markdown source-line numbers (1-indexed) that are task-list
  // items. The renderer passes hast `node.position.start.line` to
  // `checklistLines.has(...)` to detect a task-list `<li>` and render
  // it as our custom <TaskListItem/> instead of a plain bullet.
  //
  // 1-indexed matches hast's `position.start.line` so the lookup is
  // a single `Set.has`, no off-by-one math.
  const checklistLines = useMemo(() => {
    const set = new Set<number>();
    markdown.split(/\r?\n/).forEach((line, lineIdx) => {
      if (/^\s*-\s+\[[ x]\]\s+/.test(line)) set.add(lineIdx + 1);
    });
    return set;
  }, [markdown]);

  const totalChecks = checklistLines.size;

  // Per-language counter via external store. Increments whenever any
  // <TaskListItem> toggles its checkbox. `reset` clears all checks
  // for this language.
  const { count: checkedCount, reset: resetChecks } = useChecklistCount(lang);
  const progressPct =
    totalChecks > 0 ? Math.round((checkedCount / totalChecks) * 100) : 0;

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  // Memoize the rendered markdown so React doesn't recreate the whole
  // ReactMarkdown tree on every checkbox toggle. Each <TaskListItem>
  // subscribes to its own external-store snapshot — toggling one item
  // does NOT invalidate this memo or re-render unrelated headings,
  // images, tables, etc.
  //
  // Pass the TOC for heading-slug deduplication + the checklist-lines
  // set + the active language (so per-item buttons can scope their
  // localStorage state).
  const renderedMarkdown = useMemo(
    () => (
      <RenderedGuideMarkdown
        markdown={markdown}
        toc={toc}
        checklistLines={checklistLines}
        lang={lang}
      />
    ),
    [markdown, toc, checklistLines, lang],
  );

  return (
    // -m-8 negates the dashboard layout's <main> padding (p-8) so the
    // sticky header below can extend edge-to-edge of the scroll
    // container. Without this, content scrolls UP into the 32px
    // padding-top gap above the sticky header and shows through.
    <div className="-m-8 min-h-screen bg-background">
      {/* Print-only styles. Hides sidebar/nav for clean PDF export. */}
      <style jsx global>{`
        @media print {
          aside[data-guide-toc],
          [data-guide-header] {
            display: none !important;
          }
          [data-guide-content] {
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .prose img {
            max-height: 70vh;
            page-break-inside: avoid;
          }
          h2,
          h3 {
            page-break-after: avoid;
          }
          pre,
          table,
          figure {
            page-break-inside: avoid;
          }
        }
      `}</style>

      {/* Header */}
      <header
        data-guide-header
        className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <ListChecks className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
                BudgetPro
              </div>
              <h1 className="font-serif text-lg tracking-tight text-foreground truncate">
                {t.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Language switcher */}
            <div
              role="group"
              aria-label="Language"
              className="inline-flex items-center rounded-md border border-border/60 bg-card p-0.5 text-[11px]"
            >
              {(["en", "ru", "az"] as const).map((code) => {
                const isActive = lang === code;
                return (
                  <a
                    key={code}
                    href={`/guide?lang=${code}`}
                    title={LANG_META[code].flag}
                    className={`px-2 py-1 rounded transition-colors font-medium ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {LANG_META[code].label}
                  </a>
                );
              })}
            </div>

            {totalChecks > 0 && (
              <div className="hidden sm:flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-1.5 text-xs">
                <CheckCircle2
                  className={
                    progressPct === 100
                      ? "h-4 w-4 text-emerald-500"
                      : "h-4 w-4 text-muted-foreground"
                  }
                />
                <span className="font-mono tabular-nums text-foreground">
                  {checkedCount}/{totalChecks}
                </span>
                <span className="text-muted-foreground">{t.progress}</span>
                {checkedCount > 0 && (
                  <button
                    type="button"
                    onClick={resetChecks}
                    className="ml-1 text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors"
                  >
                    {t.reset}
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Printer className="h-4 w-4" />
              <span>{t.print}</span>
            </button>
          </div>
        </div>

        {/* Progress bar — sliver under header, only when checklist exists */}
        {totalChecks > 0 && (
          <div className="h-1 bg-border/40">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </header>

      {/* Body layout — sticky TOC + content */}
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-10 px-6 py-10 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* TOC */}
        <aside data-guide-toc className="hidden lg:block">
          <nav className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 mb-3">
              {t.toc}
            </div>
            <ul className="space-y-1 text-sm">
              {toc.map((item, idx) => {
                const isActive = activeSlug === item.slug;
                return (
                  <li
                    key={`toc-${idx}-${item.slug}`}
                    className={item.level === 3 ? "pl-3" : ""}
                  >
                    <a
                      href={`#${item.slug}`}
                      className={`flex items-start gap-1.5 rounded-md py-1 px-2 leading-snug transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      }`}
                    >
                      {item.level === 3 && (
                        <ChevronRight className="h-3 w-3 mt-1 shrink-0 opacity-50" />
                      )}
                      <span>{item.text}</span>
                    </a>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 border-t border-border/60 pt-4 space-y-2 text-xs">
              <a
                href="/budgeting/terminal"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {t.openTerminal}
              </a>
              <a
                href="/budgeting/board-deck?period=2026"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {t.openBoardDeck}
              </a>
              <a
                href="/budgeting/admin"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {t.openAdmin}
              </a>
            </div>
          </nav>
        </aside>

        {/* Markdown content */}
        <main
          ref={contentRef}
          data-guide-content
          className="prose prose-neutral dark:prose-invert max-w-3xl"
        >
          {renderedMarkdown}

          <div className="mt-16 border-t border-border/40 pt-8 text-xs text-muted-foreground">
            <p>
              {t.sourceNote(
                `docs/USER_GUIDE.${lang}.md`,
                "node scripts/capture-guide-screenshots.mjs",
              )}
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Memoized markdown renderer — separate component so the entire
 * ReactMarkdown tree is React-memo'd against (markdown, toc,
 * checklistLines, lang). Re-renders ONLY when those source-of-truth
 * inputs change. Individual checkbox toggles flow through
 * <TaskListItem/> via `useChecklistItem(lang, line)` without
 * invalidating this memo.
 */
const RenderedGuideMarkdown = memo(function RenderedGuideMarkdown({
  markdown,
  toc,
  checklistLines,
  lang,
}: {
  markdown: string;
  toc: TocItem[];
  checklistLines: Set<number>;
  lang: GuideLanguage;
}) {
  // react-markdown v10 passes the hast `node` to each component with
  // `position.start.line` (1-indexed line in source). Map every TOC
  // line to its dedup'd slug so duplicate-text headings still get
  // distinct anchors. Counter-based approaches don't work here because
  // ReactMarkdown can invoke heading components multiple times during
  // a single render (StrictMode double-invoke + concurrent rendering)
  // and the only stable identity is source position.
  const lineToSlug = new Map<number, string>();
  for (const item of toc) {
    if (item.sourceLine != null) lineToSlug.set(item.sourceLine, item.slug);
  }
  const slugForNode = (node: unknown, fallback: string): string => {
    const line = (
      node as { position?: { start?: { line?: number } } } | undefined
    )?.position?.start?.line;
    if (line != null) {
      const found = lineToSlug.get(line);
      if (found) return found;
    }
    return fallback;
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkUnwrapImages]}
      components={{
        h1: ({ children }) => {
          const text = String(children);
          return (
            <h1
              id={slugify(text)}
              className="font-serif text-4xl font-bold tracking-tight text-foreground mb-3 mt-0"
            >
              {children}
            </h1>
          );
        },
        h2: ({ children, ...rest }) => {
          const text = String(children);
          const node = (rest as { node?: unknown }).node;
          return (
            <h2
              id={slugForNode(node, slugify(text))}
              className="font-serif text-2xl tracking-tight text-foreground mt-14 mb-4 pt-4 border-t border-border/40 scroll-mt-24"
            >
              {children}
            </h2>
          );
        },
        h3: ({ children, ...rest }) => {
          const text = String(children);
          const node = (rest as { node?: unknown }).node;
          return (
            <h3
              id={slugForNode(node, slugify(text))}
              className="font-serif text-xl tracking-tight text-foreground mt-10 mb-3 scroll-mt-24"
            >
              {children}
            </h3>
          );
        },
        h4: ({ children }) => (
          <h4 className="font-semibold text-base text-foreground mt-6 mb-2">
            {children}
          </h4>
        ),
        p: ({ children }) => (
          <p className="text-[15px] leading-relaxed text-foreground/90 my-3">
            {children}
          </p>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-primary underline-offset-2 hover:underline"
            target={
              href?.startsWith("http") || href?.startsWith("/")
                ? "_blank"
                : undefined
            }
            rel={
              href?.startsWith("http") || href?.startsWith("/")
                ? "noreferrer"
                : undefined
            }
          >
            {children}
          </a>
        ),
        img: ({ src, alt }) => (
          <figure className="my-8">
            <div className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={typeof src === "string" ? src : ""}
                alt={alt ?? ""}
                className="w-full h-auto"
                loading="lazy"
              />
            </div>
            {alt && (
              <figcaption className="mt-2 text-center text-xs text-muted-foreground italic">
                {alt}
              </figcaption>
            )}
          </figure>
        ),
        table: ({ children }) => (
          <div className="my-6 overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            {children}
          </thead>
        ),
        th: ({ children }) => (
          <th className="px-4 py-2 text-left font-medium border-b border-border/60">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-4 py-2.5 border-b border-border/30 align-top text-[14px] text-foreground/90">
            {children}
          </td>
        ),
        code: ({ className, children }) => {
          const isBlock = (className ?? "").includes("language-");
          if (isBlock) {
            return (
              <code className="block whitespace-pre overflow-x-auto rounded-md bg-muted/60 p-4 text-[13px] font-mono leading-relaxed">
                {children}
              </code>
            );
          }
          return (
            <code className="rounded bg-muted/70 px-1.5 py-0.5 text-[0.85em] font-mono">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-4 overflow-x-auto rounded-lg border border-border/60 bg-muted/40">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-4 border-l-2 border-primary/40 pl-4 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        ul: ({ children }) => (
          <ul className="my-3 space-y-1.5 list-disc pl-6 marker:text-muted-foreground/60">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-3 space-y-1.5 list-decimal pl-6 marker:text-muted-foreground/60">
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => {
          const { node, ...rest } = props as { node?: unknown };
          const line = (
            node as { position?: { start?: { line?: number } } } | undefined
          )?.position?.start?.line;
          // Render as our custom <TaskListItem/> if this <li>'s source
          // line is in the pre-computed checklist-lines set. Otherwise
          // strip `node` (so it doesn't leak as a DOM attribute) and
          // render a plain bullet.
          if (line != null && checklistLines.has(line)) {
            return (
              <TaskListItem lang={lang} line={line}>
                {children}
              </TaskListItem>
            );
          }
          return <li {...rest}>{children}</li>;
        },
        hr: () => <hr className="my-12 border-0 border-t border-border/40" />,
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
});

/**
 * Task-list item — renders one row of the verification checklist.
 *
 * Server snapshot is ALWAYS unchecked (no localStorage access during
 * SSR). After hydration, `useChecklistItem` reads from the per-lang
 * store; React's `useSyncExternalStore` handles the snapshot swap
 * without firing a hydration mismatch warning (the whole reason we
 * picked this pattern over post-hydration DOM mutation).
 *
 * remark-gfm prepends a disabled `<input type="checkbox">` as the
 * first React child. We strip it so it doesn't render alongside our
 * custom button (which IS the visible checkbox). The strip walks one
 * level deep — multi-line items wrap content in a `<p>` so we also
 * unwrap that.
 */
function TaskListItem({
  lang,
  line,
  children,
}: {
  lang: GuideLanguage;
  line: number;
  children: ReactNode;
}) {
  const { isChecked, toggle } = useChecklistItem(lang, line);

  const stripCheckbox = (nodes: ReactNode): ReactNode => {
    const arr = Array.isArray(nodes) ? nodes : [nodes];
    return arr
      .map((c) => {
        if (c == null || typeof c !== "object") return c;
        const obj = c as {
          type?: unknown;
          props?: { type?: string; children?: ReactNode };
        };
        if (obj.type === "input" && obj.props?.type === "checkbox") return null;
        if (obj.type === "p" && obj.props) {
          return {
            ...obj,
            props: {
              ...obj.props,
              children: stripCheckbox(obj.props.children ?? null),
            },
          };
        }
        return c;
      })
      .filter((c) => c !== null);
  };
  const cleaned = stripCheckbox(children);

  return (
    <li className="list-none -ml-6 flex items-start gap-2.5 my-1 group">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={isChecked}
        aria-label={isChecked ? "Uncheck item" : "Check item"}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${
          isChecked
            ? "bg-primary border-primary text-primary-foreground"
            : "border-border bg-card hover:border-primary/60"
        }`}
      >
        {isChecked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </button>
      <span
        className={`text-[15px] leading-relaxed transition-colors ${
          isChecked
            ? "text-muted-foreground line-through"
            : "text-foreground/90"
        }`}
      >
        {cleaned}
      </span>
    </li>
  );
}
