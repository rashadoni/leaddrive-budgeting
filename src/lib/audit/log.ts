/**
 * Phase 7.F (Turn 11) — audit logger.
 *
 * One narrow entry point: `logAuditEvent(prisma, event)`. Every call-site
 * passes a discriminated-union event so the metadata shape is locked in
 * at compile time per action — no free-form JSON soup. Adding a new
 * audit action = add a new variant here + add the enum member to
 * prisma/schema.prisma + run a migration.
 *
 * Never-throws contract: a failure to log MUST NOT break the calling
 * action. Audit infrastructure being down is a serious problem, but
 * not as serious as silently dropping an import the user just kicked
 * off. We log the audit-write failure to console.error and return
 * `{ ok: false, error }` so the caller can surface it as a soft warning
 * (e.g. an `auditStale: true` flag in the API response, mirroring the
 * existing `indicatorsStale` pattern from the recompute pipeline).
 *
 * Tenant scoping: `organizationId` is required on every event.
 * Defense-in-depth — if a future API route forgets it, the type-system
 * catches it before runtime.
 *
 * Retention: 365 days documented in schema; auto-prune is a Phase 6
 * (BullMQ) follow-up. The logger itself does not delete.
 */

// `Prisma` MUST be a value import — `Prisma.JsonNull` is a runtime
// sentinel object that signals "store SQL NULL in this Json column",
// distinct from JS `null` (which Prisma rejects on non-nullable Json
// fields) and from `undefined` (which means "skip this field"). Earlier
// implementations had `import type { Prisma }` and `Prisma.JsonNull`
// became `undefined` at runtime — caught by failing tests.
import { Prisma } from '@prisma/client';
import type { AuditAction, PrismaClient } from '@prisma/client';

/**
 * Per-action metadata contracts. Every variant carries:
 *  - `action` discriminator → matches the Prisma enum 1:1.
 *  - `entityType` / `entityId` → the row the action targeted.
 *  - `metadata` → action-specific structured fields.
 *
 * `context` is optional and shared across variants (added at the call
 * site by the API route to capture origin info).
 */
export type AuditEventInput =
  | {
      action: 'company_role_change';
      entityType: 'Company';
      entityId: string;
      metadata: {
        from: 'operational' | 'admin' | 'holding';
        to: 'operational' | 'admin' | 'holding';
        companyCode: string;
      };
    }
  | {
      action: 'budget_plan_create';
      entityType: 'BudgetPlan';
      entityId: string;
      metadata: {
        planName: string;
        year: number;
        scope?: string;
      };
    }
  | {
      action: 'budget_plan_approve';
      entityType: 'BudgetPlan';
      entityId: string;
      metadata: {
        planName: string;
        approvedBy: string;
        priorStatus: string;
      };
    }
  | {
      action: 'import_budget_create';
      entityType: 'BudgetPlan';
      entityId: string;
      metadata: {
        companyId: string;
        companyCode: string;
        year: number;
        parser: 'sopl' | 'rollup';
        inserted: number;
        deleted: number;
        warnings: number;
        parentRollupsDropped: number;
        parentRollupsUnallocated: number;
        recompute: { ok: number; unknown: number; failed: number; targets: number };
      };
    }
  | {
      action: 'import_staging_apply';
      entityType: 'ImportStaging';
      entityId: string;
      metadata: {
        companyId: string;
        year: number;
        inserted: number;
        deleted: number;
        warnings: number;
        parentRollupsDropped: number;
        parentRollupsUnallocated: number;
        recompute: { ok: number; unknown: number; failed: number; targets: number };
      };
    }
  | {
      action: 'import_staging_expired';
      entityType: 'ImportStaging';
      entityId: string;
      metadata: {
        companyId: string;
        expiresAt: string; // ISO timestamp (Date serialised)
        triggeredBy: 'lazy_get' | 'lazy_apply';
      };
    }
  | {
      action: 'indicator_override_create' | 'indicator_override_update' | 'indicator_override_delete';
      entityType: 'IndicatorDefinition';
      entityId: string;
      metadata: {
        code: string;
        formulaChanged?: boolean;
        thresholdsChanged?: boolean;
      };
    }
  | {
      // Phase 7.E AI-suite — POST /api/indicators/values/[id]/explain.
      // Compliance/audit will ask "what AI calls were made on what data";
      // recording indicator id + language + token usage gives a complete
      // attestation trail without storing the LLM prompt or response body.
      action: 'ai_variance_explainer_run';
      entityType: 'IndicatorValue';
      entityId: string; // IndicatorValue.id
      metadata: {
        indicatorCode: string;
        companyId: string;
        period: string;
        status: 'amber' | 'red' | 'unknown';
        language: 'en' | 'ru' | 'az';
        tokensIn: number;
        tokensOut: number;
        durationMs: number;
      };
    };

/**
 * Optional forensics context; set by the API route, NOT by the
 * caller's business logic. Pure CLI / system events leave it null.
 */
export interface AuditEventContext {
  /** API route that emitted the event ("/api/onboarding/import/budget"). */
  route?: string;
  /** First-octet hash of the client IP, for incident-response triangulation
   *  WITHOUT storing raw addresses. Optional — many call-sites can't
   *  cheaply derive it. */
  ipHashPrefix?: string;
  /** User-agent first 60 chars, for spotting CLI-vs-browser actor patterns. */
  userAgent?: string;
}

export interface LogAuditEventArgs {
  organizationId: string;
  /** null for system events (cron, CLI scripts, anonymous lazy-flips). */
  actorUserId: string | null;
  event: AuditEventInput;
  context?: AuditEventContext | null;
}

export type LogAuditEventResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Persist an audit event. Never throws.
 *
 * Returns the inserted row's id on success, or a structured error on
 * failure. Callers may surface the error as a soft warning in the API
 * response (e.g. `auditStale: true`); the action itself MUST already be
 * committed before this is called — audit logging is a side-effect, not
 * a precondition.
 */
export async function logAuditEvent(
  prisma: PrismaClient,
  args: LogAuditEventArgs,
): Promise<LogAuditEventResult> {
  try {
    if (!args.organizationId) {
      // Defensive — types should already enforce this, but a CLI script
      // passing an empty-string env var should not silently log a
      // tenant-less row. Fail loudly (in console) but don't throw.
      const err = 'audit/log: organizationId is required (got empty string)';
      console.error(err);
      return { ok: false, error: err };
    }

    const created = await prisma.auditEvent.create({
      data: {
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        action: args.event.action as AuditAction,
        entityType: args.event.entityType,
        entityId: args.event.entityId,
        metadata: args.event.metadata as unknown as Prisma.InputJsonValue,
        context:
          args.context == null
            ? Prisma.JsonNull
            : (args.context as unknown as Prisma.InputJsonValue),
      },
      select: { id: true },
    });
    return { ok: true, id: created.id };
  } catch (err) {
    // Audit-write failures are logged but never re-thrown. The caller's
    // primary action has already committed; missing audit trail is bad
    // but missing the action would be worse.
    const reason = err instanceof Error ? err.message : String(err);
    console.error('audit/log: write failed:', reason);
    return { ok: false, error: reason };
  }
}

/**
 * Narrow `Prisma.InputJsonValue` union for callers that build context
 * inline (e.g. NextRequest header inspection). Lifts a partial bag into
 * the shape `logAuditEvent` accepts; trims user-agent to its first 60
 * chars to avoid leaking long SSO redirects into the audit row.
 */
export function buildAuditContext(
  partial: Partial<AuditEventContext>,
): AuditEventContext | null {
  const out: AuditEventContext = {};
  if (partial.route) out.route = partial.route;
  if (partial.ipHashPrefix) out.ipHashPrefix = partial.ipHashPrefix;
  if (partial.userAgent) out.userAgent = partial.userAgent.slice(0, 60);
  return Object.keys(out).length === 0 ? null : out;
}
