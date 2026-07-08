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
import { prisma as defaultPrisma } from "@/lib/prisma";
import { prismaAdmin } from "@/lib/db/prisma-admin"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log";
import { getLogger } from "@/lib/log";

// Phase 8 D4 continuation (2026-05-28) — structured logger for the
// board-deck narration cache helper. 2 console.error → logger:
// cache-write-failed + audit-emission-failed.
const log = getLogger("board-deck:narration");
import {
  runNarration,
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
        score: c?.score ?? null,
        band: c?.band ?? "unknown",
      };
    })
    // Sort to ensure deterministic ordering even if upstream changes.
    .sort((a, b) => a.code.localeCompare(b.code));

  const alertCounts = {
    critical: snapshot.matchesBySeverity.critical.length,
    warning: snapshot.matchesBySeverity.warning.length,
    info: snapshot.matchesBySeverity.info.length,
  };

  const payload = {
    org: snapshot.org.slug,
    period: snapshot.period,
    totals: snapshot.totals,
    composites: compositeRows,
    alertCounts,
  };

  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
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

  // Cache miss (or stale or bypass) — call LLM.
  let result: NarrationOutput;
  try {
    result = await runImpl({
      snapshot: input.snapshot,
      language: input.language,
    });
  } catch {
    // Failure path: caller renders without narrative.
    return null;
  }

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

  // Audit emission (cache miss — LLM dollars spent, attestation
  // needed). Non-blocking — failure logs but doesn't propagate.
  void logAuditEvent(defaultPrisma, {
    organizationId: input.organizationId,
    actorUserId: input.audit?.actorUserId ?? null,
    event: {
      action: "ai_board_deck_narration_run",
      entityType: "Organization",
      entityId: input.organizationId,
      metadata: {
        period: input.snapshot.period,
        language: input.language,
        snapshotHash: hash,
        tokensIn: result.usage?.inputTokens ?? 0,
        tokensOut: result.usage?.outputTokens ?? 0,
        modelName: result.modelName,
        promptVersion: result.promptVersion,
      },
    },
    context: buildAuditContext({
      route: input.audit?.route,
      userAgent: input.audit?.userAgent,
    }),
  }).catch((err) => {
    log.error("audit emission failed (non-blocking)", {
      organizationId: input.organizationId,
      err: err instanceof Error ? err.message : String(err),
    });
  });

  return result;
}
