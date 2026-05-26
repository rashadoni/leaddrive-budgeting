"use client"

/**
 * GuideViewer — renders the in-app user guide markdown.
 *
 * Phase 1 (2026-05-26): minimal read-only render via react-markdown.
 * TOC scroll-spy, persistent checkbox state, and print trigger are
 * planned for a follow-up slice once the basic guide content lands.
 */

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface GuideViewerProps {
  markdown: string
}

export function GuideViewer({ markdown }: GuideViewerProps) {
  return (
    <article className="prose prose-invert max-w-4xl mx-auto px-4 py-8">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {markdown}
      </ReactMarkdown>
    </article>
  )
}
