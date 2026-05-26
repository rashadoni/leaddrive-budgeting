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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Printer,
  CheckCircle2,
  ListChecks,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

interface GuideViewerProps {
  markdown: string;
}

interface TocItem {
  level: 2 | 3;
  text: string;
  slug: string;
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
 *  block doesn't pollute the TOC. */
function extractToc(md: string): TocItem[] {
  const withoutCodeBlocks = md.replace(/```[\s\S]*?```/g, "");
  const lines = withoutCodeBlocks.split(/\r?\n/);
  const out: TocItem[] = [];
  for (const line of lines) {
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length === 2 ? 2 : 3;
    const text = m[2].replace(/^[\d.\s]+/, "").trim();
    out.push({ level: level as 2 | 3, text, slug: slugify(m[2]) });
  }
  return out;
}

export function GuideViewer({ markdown }: GuideViewerProps) {
  const toc = useMemo(() => extractToc(markdown), [markdown]);

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

  // Checklist state — keyed by line index of the markdown so reordering
  // doesn't accidentally inherit old state (it does invalidate on
  // section reorder, which is the safer default).
  const checklistItems = useMemo(() => {
    const items: { line: number; text: string }[] = [];
    const lines = markdown.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const m = /^\s*-\s+\[[ x]\]\s+(.+)$/.exec(line);
      if (m) items.push({ line: idx, text: m[1] });
    });
    return items;
  }, [markdown]);

  const totalChecks = checklistItems.length;
  const [checkedSet, setCheckedSet] = useState<Set<number>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem("guide:checks");
      if (raw) setCheckedSet(new Set(JSON.parse(raw)));
    } catch {
      /* localStorage disabled — silent */
    }
  }, []);

  const toggleCheck = (lineIdx: number) => {
    setCheckedSet((prev) => {
      const next = new Set(prev);
      if (next.has(lineIdx)) next.delete(lineIdx);
      else next.add(lineIdx);
      try {
        localStorage.setItem("guide:checks", JSON.stringify([...next]));
      } catch {
        /* silent */
      }
      return next;
    });
  };

  const resetChecks = () => {
    setCheckedSet(new Set());
    try {
      localStorage.removeItem("guide:checks");
    } catch {
      /* silent */
    }
  };

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  const checkedCount = checkedSet.size;
  const progressPct =
    totalChecks > 0 ? Math.round((checkedCount / totalChecks) * 100) : 0;

  // Memoize the rendered markdown so React doesn't recreate the whole
  // ReactMarkdown tree on every state change (which would blow away
  // the custom checkboxes our useEffect mutates into the DOM).
  const renderedMarkdown = useMemo(
    () => <RenderedGuideMarkdown markdown={markdown} />,
    [markdown],
  );

  // DOM post-processor: transform every `<li class="task-list-item">`
  // into our custom checkbox. Works regardless of how react-markdown
  // wires `className` to the component override (which has been
  // unreliable across nested ULs in v10). Runs whenever the markdown
  // changes — re-runs after React commits — and re-binds click
  // handlers from the latest closure state.
  useEffect(() => {
    if (!contentRef.current) return;
    const root = contentRef.current;

    const tasks = Array.from(
      root.querySelectorAll<HTMLLIElement>("li.task-list-item"),
    );
    // Even if there are no NEW tasks to convert (because we've already
    // converted them in a prior render), we still need to attach the
    // click delegation listener below. Don't early-return.

    const cleanupFns: Array<() => void> = [];

    tasks.forEach((li, idx) => {
      const item = checklistItems[idx];
      if (!item) return;
      // Skip if we've already processed this li in a previous render.
      if (li.dataset.guideChecklistInit === "1") return;
      li.dataset.guideChecklistInit = "1";

      const checkbox = li.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.remove();
      const labelText = (li.textContent ?? "").replace(/^\s+/, "");

      li.innerHTML = "";
      li.className = "list-none -ml-6 flex items-start gap-2.5 group my-1";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-pressed", "false");
      btn.className =
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all border-border bg-card hover:border-primary/60";
      btn.dataset.guideLine = String(item.line);

      const span = document.createElement("span");
      span.textContent = labelText;
      span.className = "text-[15px] leading-relaxed text-foreground/90";
      span.dataset.guideLabel = "1";

      li.appendChild(btn);
      li.appendChild(span);
    });

    // Event delegation: bind ONE listener at the content root that
    // dispatches per-button clicks via data-guide-line. Survives
    // re-renders of individual buttons.
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest<HTMLButtonElement>(
        "button[data-guide-line]",
      );
      if (!btn) return;
      const line = Number(btn.dataset.guideLine);
      if (Number.isFinite(line)) toggleCheck(line);
    };
    root.addEventListener("click", onClick);
    cleanupFns.push(() => root.removeEventListener("click", onClick));

    return () => cleanupFns.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, checklistItems]);

  // Sync visual checkbox state whenever checkedSet changes.
  useEffect(() => {
    if (!contentRef.current) return;
    const buttons = contentRef.current.querySelectorAll<HTMLButtonElement>(
      "button[data-guide-line]",
    );
    buttons.forEach((btn) => {
      const line = Number(btn.dataset.guideLine);
      const isChecked = checkedSet.has(line);
      btn.setAttribute("aria-pressed", isChecked ? "true" : "false");
      btn.className = isChecked
        ? "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all bg-primary border-primary text-white"
        : "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all border-border bg-card hover:border-primary/60";
      btn.innerHTML = isChecked
        ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M20 6 9 17l-5-5"/></svg>'
        : "";
      const span = btn.nextElementSibling as HTMLSpanElement | null;
      if (span && span.dataset.guideLabel === "1") {
        span.className = isChecked
          ? "text-[15px] leading-relaxed text-muted-foreground line-through"
          : "text-[15px] leading-relaxed text-foreground/90";
      }
    });
  }, [checkedSet]);

  return (
    <div className="min-h-screen bg-background">
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
                Руководство пользователя
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
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
                <span className="text-muted-foreground">проверено</span>
                {checkedCount > 0 && (
                  <button
                    type="button"
                    onClick={resetChecks}
                    className="ml-1 text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors"
                  >
                    сброс
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
              <span>Печать / PDF</span>
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
              Содержание
            </div>
            <ul className="space-y-1 text-sm">
              {toc.map((item) => {
                const isActive = activeSlug === item.slug;
                return (
                  <li
                    key={`${item.slug}-${item.level}`}
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
                Открыть Risk Terminal
              </a>
              <a
                href="/budgeting/board-deck?period=2026"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Открыть Board Deck
              </a>
              <a
                href="/budgeting/admin"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Открыть Admin Tools
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
              Источник: <code>docs/USER_GUIDE.md</code>. Скриншоты
              переснимаются через{" "}
              <code>node scripts/capture-guide-screenshots.mjs</code>.
              Состояние чек-листа хранится в локальном браузере (
              <code>localStorage</code>) и не уходит на сервер.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Memoized markdown renderer — separate component so the entire
 * ReactMarkdown tree is React-memo'd against the markdown string.
 * When the parent re-renders due to `checkedSet` / `activeSlug`, the
 * memoized children skip re-render and our DOM mutations stay intact.
 */
const RenderedGuideMarkdown = memo(function RenderedGuideMarkdown({
  markdown,
}: {
  markdown: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
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
        h2: ({ children }) => {
          const text = String(children);
          return (
            <h2
              id={slugify(text)}
              className="font-serif text-2xl tracking-tight text-foreground mt-14 mb-4 pt-4 border-t border-border/40 scroll-mt-24"
            >
              {children}
            </h2>
          );
        },
        h3: ({ children }) => {
          const text = String(children);
          return (
            <h3
              id={slugify(text)}
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
          // Default li — strip `node` so it doesn't leak to DOM.
          // Task-list items are post-processed in the parent's useEffect
          // (sidesteps react-markdown v10's inconsistent className
          // plumbing across nested ULs).
          const { node: _node, ...rest } = props as { node?: unknown };
          return <li {...rest}>{children}</li>;
        },
        hr: () => <hr className="my-12 border-0 border-t border-border/40" />,
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
});
