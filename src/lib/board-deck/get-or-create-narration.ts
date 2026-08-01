/**
 * Phase 7.G Turn XLVII (Board Deck v2 Turn 1) — narrative cache.
 *
 * Wraps `runNarration` with a Postgres-backed cache so the AI summary
 * can be ON BY DEFAULT for Board Deck v2 without burning $0.05 +
 * 10-30s per page-load. Cache key: (organizationId, period,
 * snapshotHash, language).
 *
 * **snapshotHash semantics** — sha256 over `BoardSnapshot`'s load-
 * bearing fields ONLY. Excludes `generatedAt` (ISO instant — would
 * vary between identical fetches milliseconds apart) and any other
 * time-varying field. Two callers building the snapshot 10ms apart
 * MUST hit the same hash → same cache row.
 *
 * **TTL** — 24h on top of hash equality. Rationale: composite scores
 * + alert thresholds may shift via cron / threshold edits without
 * the snapshot's load-bearing fields changing. 24h is short enough
 * to feel fresh, long enough to avoid cache thrash for a slowly
 * changing snapshot.
 *
 * Failure mode: if `runNarration` throws (LLM down, schema violation,
 * etc.) we return `null`. Caller renders without narrative — same
 * graceful-degradation contract as Turn XLVI's direct call.
 *
 * Audit: cache MISS emits `ai_board_deck_narration_run` (LLM call
 * fired, dollars spent, attestation needed). Cache HIT does NOT emit
 * — would explode the audit log on heavy traffic, and the original
 * miss already covers the attestation.
 *
 * **Why orgId is a separate input** — `BoardSnapshot.org` only
 * carries `{name, slug, settings}` today (no id; see
 * `build-snapshot.ts:37`). Threading orgId from the caller keeps the
 * cache key correct without an upstream BoardSnapshot refactor.
 */

import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prismaAdmin } from "@/lib/db/prisma-admin"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log";
import { getLogger } from "@/lib/log";

// Phase 8 D4 continuation (2026-05-28) — structured logger for the
// board-deck narration cache helper. 2 console.error → logger:
// cache-write-failed + audit-emission-failed.
const log = getLogger("board-deck:narration");
import {
  NARRATION_PROMPT_VERSION,
  NarrationProviderResponseError,
  runNarration,
  sortedNarrationAlerts,
  type NarrationLanguage,
  type NarrationOutput,
} from "./narrate-snapshot";
import type { BoardSnapshot } from "./build-snapshot";

/** Stale-after window. 24h chosen so a snapshot whose load-bearing
 *  fields didn't shift but whose surrounding context (rule
 *  thresholds, prior period comparisons) might have, still
 *  re-narrates daily. */
export const NARRATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Compute a stable hash of the snapshot's narrative-driving content.
 *  Deliberately serializes a SUBSET of `BoardSnapshot` so the hash is
 *  stable across milliseconds-apart fetches (excludes `generatedAt`,
 *  Maps over Maps, etc). The fields included are the ones the LLM
 *  actually sees in `buildNarrationPrompt`. */
export function snapshotHash(snapshot: BoardSnapshot): string {
  const compositeRows = snapshot.operational
    .map((co) => {
      const c = snapshot.compositeByCompany.get(co.id);
      return {
        code: co.code,
        name: co.name,
        industry: co.industry,
        score: c?.score ?? null,
        band: c?.band ?? "unknown",
        // 11.81 — the hash must move when coverage moves. A company can go
        // from `insufficient` to `full` while landing on the same score, and
        // the prompt now says something different about it; without this the
        // cached narration would outlive the sentence it was written from.
        coverage: c?.coverage ?? "none",
      };
    })
    // Sort to ensure deterministic ordering even if upstream changes.
    .sort((a, b) => a.code.localeCompare(b.code));

  const alerts = (["critical", "warning", "info"] as const).flatMap(
    (severity) =>
      sortedNarrationAlerts(snapshot.matchesBySeverity[severity])
        .map((match) => ({
          severity,
          ruleId: match.ruleId,
          ruleName: match.ruleName,
          message: match.message,
          messageKey: match.messageKey ?? null,
          messageParams: match.messageParams ?? null,
          affectedCompanyIds: [...match.affectedCompanyIds].sort(),
        })),
  );

  const payload = {
    promptVersion: NARRATION_PROMPT_VERSION,
    org: { slug: snapshot.org.slug, name: snapshot.org.name },
    period: snapshot.period,
    totals: snapshot.totals,
    persistedIndicatorRows: snapshot.cells.length,
    composites: compositeRows,
    alerts,
  };

  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

interface AuditContext {
  /** API route or page path — for audit forensics. */
  route?: string;
  /** User-Agent header — for audit forensics. */
  userAgent?: string;
  /** Caller's user id — actor on the audit event. Null = system / cron. */
  actorUserId?: string | null;
}

export interface GetOrCreateNarrationInput {
  organizationId: string;
  snapshot: BoardSnapshot;
  language: NarrationLanguage;
  /** Optional audit context piped into the cache-miss audit emission. */
  audit?: AuditContext;
}

interface PrismaSurface {
  boardDeckNarration: {
    findUnique: PrismaClient["boardDeckNarration"]["findUnique"];
    create: PrismaClient["boardDeckNarration"]["create"];
    update: PrismaClient["boardDeckNarration"]["update"];
  };
  auditEvent: PrismaClient["auditEvent"];
}

interface ReadPrismaSurface {
  boardDeckNarration: {
    findUnique: PrismaClient["boardDeckNarration"]["findUnique"];
  };
}

export interface CachedNarrationResult {
  narration: NarrationOutput;
  /** When the AI narrative itself was generated (not when the page snapshot was read). */
  generatedAt: string;
  /** A stale row is still safe to display, but the UI must disclose its age. */
  isStale: boolean;
}

export interface GetOrCreateNarrationOptions {
  /** Bypass the cache entirely — write a fresh narration regardless
   *  of existing rows. Used by an admin-only "Regenerate" path. */
  bypassCache?: boolean;
  /** Inject Prisma client (test seam). */
  prisma?: PrismaSurface;
  /** Inject runNarration (test seam). Default = real LLM call. */
  runNarrationImpl?: typeof runNarration;
  /** Override TTL (test seam). */
  ttlMs?: number;
  /** Override "now" (test seam, lets us assert stale-after behavior
   *  without time travel). */
  now?: () => Date;
}

export interface GetCachedNarrationOptions {
  /** Inject Prisma client (test seam). */
  prisma?: ReadPrismaSurface;
  /** Override TTL (test seam). */
  ttlMs?: number;
  /** Override "now" (test seam). */
  now?: () => Date;
}

/**
 * Read the exact `(org, period, snapshot hash, language)` cache row without
 * calling an AI provider, mutating the cache, or emitting an audit event.
 *
 * Expired rows remain visible with `isStale=true`: absence must not silently
 * replace previously generated board narrative, while the caller can clearly
 * label that an explicit paid refresh is required.
 */
export async function getCachedNarration(
  input: Pick<
    GetOrCreateNarrationInput,
    "organizationId" | "snapshot" | "language"
  >,
  opts: GetCachedNarrationOptions = {},
): Promise<CachedNarrationResult | null> {
  const prismaClient =
    opts.prisma ?? (prismaAdmin as unknown as ReadPrismaSurface);
  const ttl = opts.ttlMs ?? NARRATION_CACHE_TTL_MS;
  const now = opts.now ?? (() => new Date());
  const hash = snapshotHash(input.snapshot);
  const cached = await prismaClient.boardDeckNarration.findUnique({
    where: {
      organizationId_period_snapshotHash_language: {
        organizationId: input.organizationId,
        period: input.snapshot.period,
        snapshotHash: hash,
        language: input.language,
      },
    },
  });
  if (!cached || cached.paragraphs.length !== 3) return null;

  return {
    narration: {
      headline: cached.headline,
      paragraphs: [
        cached.paragraphs[0],
        cached.paragraphs[1],
        cached.paragraphs[2],
      ],
      modelName: cached.modelName,
      promptVersion: cached.promptVersion,
      usage:
        cached.tokensIn > 0 || cached.tokensOut > 0
          ? {
              inputTokens: cached.tokensIn,
              outputTokens: cached.tokensOut,
            }
          : undefined,
    },
    generatedAt: cached.generatedAt.toISOString(),
    isStale: now().getTime() - cached.generatedAt.getTime() >= ttl,
  };
}

/** Look up cached narration; on miss, call the LLM, write the row,
 *  emit audit. Returns null on LLM failure (caller degrades). */
export async function getOrCreateNarration(
  input: GetOrCreateNarrationInput,
  opts: GetOrCreateNarrationOptions = {},
): Promise<NarrationOutput | null> {
  const prismaClient =
    opts.prisma ?? (prismaAdmin as unknown as PrismaSurface);
  const runImpl = opts.runNarrationImpl ?? runNarration;
  const ttl = opts.ttlMs ?? NARRATION_CACHE_TTL_MS;
  const now = opts.now ?? (() => new Date());

  const hash = snapshotHash(input.snapshot);

  // Cache lookup unless explicitly bypassed.
  if (!opts.bypassCache) {
    const cached = await prismaClient.boardDeckNarration.findUnique({
      where: {
        organizationId_period_snapshotHash_language: {
          organizationId: input.organizationId,
          period: input.snapshot.period,
          snapshotHash: hash,
          language: input.language,
        },
      },
    });
    if (cached) {
      const ageMs = now().getTime() - cached.generatedAt.getTime();
      if (ageMs < ttl && cached.paragraphs.length === 3) {
        // Cache hit. `paragraphs` is `String[]` in Prisma; narrow to
        // the [string,string,string] tuple the caller expects.
        return {
          headline: cached.headline,
          paragraphs: [
            cached.paragraphs[0],
            cached.paragraphs[1],
            cached.paragraphs[2],
          ],
          modelName: cached.modelName,
          promptVersion: cached.promptVersion,
          usage:
            cached.tokensIn > 0 || cached.tokensOut > 0
              ? {
                  inputTokens: cached.tokensIn,
                  outputTokens: cached.tokensOut,
                }
              : undefined,
        };
      }
    }
  }

  const auditMetadataBase = {
    period: input.snapshot.period,
    language: input.language,
    snapshotHash: hash,
    promptVersion: NARRATION_PROMPT_VERSION,
  };

  // Cache miss (or stale or bypass) — record explicit intent before any paid
  // provider call. If audit is unavailable, fail closed and spend nothing.
  let auditId: string;
  try {
    const audit = await logAuditEvent(prismaAdmin, {
      organizationId: input.organizationId,
      actorUserId: input.audit?.actorUserId ?? null,
      event: {
        action: "ai_board_deck_narration_run",
        entityType: "Organization",
        entityId: input.organizationId,
        metadata: {
          ...auditMetadataBase,
          tokensIn: 0,
          tokensOut: 0,
          modelName: "pending-provider-response",
          outcome: "pending",
        },
      },
      context: buildAuditContext({
        route: input.audit?.route,
        userAgent: input.audit?.userAgent,
      }),
    });
    if (!audit.ok) {
      log.error("pre-provider audit rejected; paid call withheld", {
        organizationId: input.organizationId,
        err: audit.error,
      });
      return null;
    }
    auditId = audit.id;
  } catch (err) {
    log.error("pre-provider audit failed; paid call withheld", {
      organizationId: input.organizationId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  // Cache miss (or stale or bypass) — call LLM.
  let result: NarrationOutput;
  try {
    result = await runImpl({
      snapshot: input.snapshot,
      language: input.language,
    });
  } catch (err) {
    // Preserve the attempted paid action without storing raw provider or
    // billing error text. A failed status is materially different from a
    // successful zero-token call in usage/audit reporting.
    await prismaClient.auditEvent
      .update({
        where: { id: auditId, organizationId: input.organizationId },
        data: {
          metadata: {
            ...auditMetadataBase,
            tokensIn:
              err instanceof NarrationProviderResponseError
                ? (err.usage?.inputTokens ?? 0)
                : 0,
            tokensOut:
              err instanceof NarrationProviderResponseError
                ? (err.usage?.outputTokens ?? 0)
                : 0,
            modelName:
              err instanceof NarrationProviderResponseError
                ? err.modelName
                : "provider-response-unavailable",
            outcome: "provider_failed",
          },
        },
      })
      .catch((err: unknown) => {
        log.error("provider-failure audit finalization failed", {
          organizationId: input.organizationId,
          auditId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    return null;
  }

  // Finalize the same durable audit row with actual provider usage. If this
  // write fails, the pre-provider row remains explicitly `pending` rather
  // than falsely claiming a zero-token success.
  await prismaClient.auditEvent
    .update({
      where: { id: auditId, organizationId: input.organizationId },
      data: {
        metadata: {
          ...auditMetadataBase,
          tokensIn: result.usage?.inputTokens ?? 0,
          tokensOut: result.usage?.outputTokens ?? 0,
          modelName: result.modelName,
          promptVersion: result.promptVersion,
          outcome: "succeeded",
        },
      },
    })
    .catch((err: unknown) => {
      log.error("provider-success audit finalization failed", {
        organizationId: input.organizationId,
        auditId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

  // Persist. Upsert isn't ideal because findUnique-then-update vs
  // create races on concurrent miss — use create with conflict
  // handling: P2002 = another request raced us; fall through to
  // update so the last writer's narrative wins (both are equally
  // valid for the same hash).
  try {
    await prismaClient.boardDeckNarration.create({
      data: {
        organizationId: input.organizationId,
        period: input.snapshot.period,
        snapshotHash: hash,
        language: input.language,
        headline: result.headline,
        paragraphs: result.paragraphs,
        modelName: result.modelName,
        promptVersion: result.promptVersion,
        tokensIn: result.usage?.inputTokens ?? 0,
        tokensOut: result.usage?.outputTokens ?? 0,
        generatedAt: now(),
      },
    });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: unknown }).code
        : undefined;
    if (code === "P2002") {
      try {
        await prismaClient.boardDeckNarration.update({
          where: {
            organizationId_period_snapshotHash_language: {
              organizationId: input.organizationId,
              period: input.snapshot.period,
              snapshotHash: hash,
              language: input.language,
            },
          },
          data: {
            headline: result.headline,
            paragraphs: result.paragraphs,
            modelName: result.modelName,
            promptVersion: result.promptVersion,
            tokensIn: result.usage?.inputTokens ?? 0,
            tokensOut: result.usage?.outputTokens ?? 0,
            generatedAt: now(),
          },
        });
      } catch {
        // Even the update failed — return the result anyway; we
        // don't want to lose the LLM call's output to a DB blip.
      }
    } else {
      log.error("cache write failed", {
        organizationId: input.organizationId,
        period: input.snapshot.period,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
