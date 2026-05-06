/**
 * Phase 7.G Turn XLII (Phase D.1) — AI Web Crawler types.
 *
 * Schema for the IntelItem feed (Prisma model `IntelItem`) + crawler
 * orchestrator I/O. Anthropic SDK + `web_search_20250305` tool wiring
 * lands separately (Phase D.2).
 */

import type { IntelItem } from '@prisma/client';

/** Org-context input for a crawl run. */
export interface IntelCrawlInput {
  organizationId: string;
  /** Industry codes (e.g. `["industrial","hospitality"]`) — feed the LLM
   *  prompt so search is biased toward sector-relevant news. */
  industries: string[];
  /** Active company codes (e.g. `["AAC","ATL"]`) — used both to bias
   *  the prompt AND to score relevance after the search returns. */
  companyCodes: string[];
}

/** Aggregate crawl result for observability. */
export interface IntelCrawlResult {
  /** Raw search hits returned by the LLM (pre-dedup). */
  itemsFetched: number;
  /** New IntelItem rows written this run (post-dedup). */
  itemsCreated: number;
  /** Dedup hits — URL hash matched an existing IntelItem within the
   *  7-day window. */
  itemsSkipped: number;
  /** Per-stage error messages (LLM failure, parse failure, write
   *  failure). Empty array on a clean run. */
  errors: string[];
}

/** API DTO — what `GET /api/intel` returns per item. Maps from the
 *  Prisma `IntelItem` row, with dates serialised as ISO strings + the
 *  `dismissedBy` array shadowed (`isDismissed` boolean for caller). */
export interface IntelItemDTO {
  id: string;
  title: string;
  summary: string;
  url: string;
  sourceLabel: string;
  relevanceScore: number;
  industryTags: string[];
  companyTags: string[];
  publishedAt: string | null;
  fetchedAt: string;
  isPinned: boolean;
  /** Computed per-caller: did THIS user (by id) dismiss the item? */
  isDismissed: boolean;
}

/** Map a Prisma row → DTO. `currentUserId` controls `isDismissed`
 *  computation; pass `null` to suppress the flag (always false). */
export function intelItemToDTO(
  row: IntelItem,
  currentUserId: string | null,
): IntelItemDTO {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    sourceLabel: row.sourceLabel,
    relevanceScore: row.relevanceScore,
    industryTags: row.industryTags,
    companyTags: row.companyTags,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    fetchedAt: row.fetchedAt.toISOString(),
    isPinned: row.isPinned,
    isDismissed:
      currentUserId !== null && row.dismissedBy.includes(currentUserId),
  };
}
