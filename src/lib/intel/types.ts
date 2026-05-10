/**
 * Phase 7.G Turn XLII (Phase D.1) — AI Web Crawler types.
 *
 * Schema for the IntelItem feed (Prisma model `IntelItem`) + crawler
 * orchestrator I/O. Anthropic SDK + `web_search_20250305` tool wiring
 * lands separately (Phase D.2).
 */

import type { IntelItem } from '@prisma/client';

/** Output language for crawler summaries. Phase 7.G Turn LXXXXIII (D.5c)
 *  — defaults to "en" when unspecified. Russian (ru) and Azerbaijani (az)
 *  flow through to the LLM SYSTEM_PROMPT so summaries land in the user's
 *  preferred language. */
export type IntelOutputLanguage = "en" | "ru" | "az";

/** Org-context input for a crawl run. */
export interface IntelCrawlInput {
  organizationId: string;
  /** Industry codes (e.g. `["industrial","hospitality"]`) — feed the LLM
   *  prompt so search is biased toward sector-relevant news. */
  industries: string[];
  /** Active company codes (e.g. `["AAC","ATL"]`) — used both to bias
   *  the prompt AND to score relevance after the search returns. */
  companyCodes: string[];
  /** Phase 7.G Turn LXXXXIII (D.5c) — output language for `summary` /
   *  `sourceLabel` strings. Default "en" (backwards-compatible). */
  language?: IntelOutputLanguage;
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
  /** Phase D.2: token usage from the Anthropic SDK envelope. Optional
   *  because the short-circuit path (empty industries + companyCodes)
   *  never calls the LLM. Caller (POST /api/intel/refresh) reads these
   *  for the audit_event metadata. */
  usage?: { inputTokens: number; outputTokens: number };
  /** Phase D.2: resolved Anthropic model id, e.g.
   *  "claude-sonnet-4-5-20250929". Captured for audit attestation —
   *  future model swap MUST NOT silently erase the trail. Optional for
   *  the same reason as `usage`. */
  modelName?: string;
  /** Phase D.2: hand-bumped `INTEL_PROMPT_VERSION` from `crawler.ts`.
   *  Bump on any change to SYSTEM_PROMPT or buildIntelPrompt structure
   *  so the audit log links each item back to the prompt variant that
   *  produced it. */
  promptVersion?: string;
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
