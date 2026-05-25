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

import type { Language } from '@/lib/ai/prompts';

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
        // Phase 7.G Turn CXI (Phase 7.B v2 Day 4) — multi-sheet apply
        // emits this same enum value with these optional fields populated.
        // Reusing import_staging_apply (vs adding a new enum value) avoids
        // schema migration drift; multi-sheet apply rows are distinguishable
        // by the presence of `multiSheet: true`.
        multiSheet?: boolean;
        sheetCount?: number;
        successCount?: number;
        failureCount?: number;
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
        language: Language;
        tokensIn: number;
        tokensOut: number;
        durationMs: number;
        /** Resolved Anthropic model id (e.g. "claude-sonnet-4-5-20250929").
         *  Without this, a future model swap silently erases the audit
         *  trail of which engine answered the CFO. */
        modelName: string;
        /** Hand-bumped EXPLAINER_PROMPT_VERSION; identifies the prompt
         *  template variant that produced the narrative. v1 = initial. */
        promptVersion: string;
      };
    }
  | {
      // Phase C2 v2 (sub-22) — POST /api/indicators/values/[id]/forecast/explain.
      // Mirror of ai_variance_explainer_run for forecast narration:
      // captures the indicator + forecast confidence + token usage so
      // compliance can attest "this CFO action was based on a forecast
      // with R²=X confidence, narrated by model Y on prompt v Z".
      action: 'ai_forecast_explainer_run';
      entityType: 'IndicatorValue';
      entityId: string; // IndicatorValue.id
      metadata: {
        indicatorCode: string;
        companyId: string;
        period: string;
        language: Language;
        /** Forecast confidence band (sub-13 v1 categorical: high/medium/low). */
        forecastConfidence: 'high' | 'medium' | 'low';
        /** R² 0-1 from the linear-regression fit. */
        forecastR2: number;
        /** Number of non-null sparkline points used in the fit. */
        contributingCount: number;
        tokensIn: number;
        tokensOut: number;
        durationMs: number;
        modelName: string;
        promptVersion: string;
      };
    }
  | {
      // Phase 7.E C6 v2 (sub-9 closure) — PATCH /api/organizations/settings.
      // Captures admin-driven alert-rule threshold tuning. Storing the
      // full before/after config gives auditors a complete trail
      // ("what was company-mostly-red threshold on 2026-04-29?")
      // without any join. `before` is null when the org sets thresholds
      // for the first time (settings.alertThresholds was undefined).
      // Threshold structures stay decoupled from this module — audit
      // accepts the shape the caller passes (Zod-validated upstream at
      // the API boundary).
      action: 'alert_thresholds_update';
      entityType: 'Organization';
      entityId: string; // organizationId
      metadata: {
        before: Record<string, unknown> | null;
        after: Record<string, unknown>;
      };
    }
  | {
      // Phase 7.G Turn XLIII (Phase D.2) — POST /api/intel/refresh.
      // Records every admin-triggered AI Web Crawler run for an org.
      // Compliance attestation: which admin ran the crawl, against
      // which org context (industries × company codes), what items were
      // written, what tokens were spent, on which model. Mirrors
      // `ai_variance_explainer_run` shape but scoped to the org rather
      // than a single IndicatorValue.
      action: 'intel_crawl_run';
      entityType: 'Organization';
      entityId: string; // organizationId
      metadata: {
        /** Distinct industry codes fed to the LLM (cardinality, not the
         *  list — full list lives in IntelItem rows the run produced). */
        industriesCount: number;
        /** Distinct active company codes fed to the LLM. */
        companyCodesCount: number;
        /** Raw search hits returned by the LLM (pre-dedup). */
        itemsFetched: number;
        /** New IntelItem rows written this run (post-dedup). */
        itemsCreated: number;
        /** Dedup hits — URL hash matched an existing IntelItem. */
        itemsSkipped: number;
        durationMs: number;
        tokensIn: number;
        tokensOut: number;
        /** Resolved Anthropic model id (e.g. "claude-sonnet-4-5-20250929")
         *  or "unknown" if the SDK envelope didn't echo it. */
        modelName: string;
        /** Hand-bumped `INTEL_PROMPT_VERSION` from
         *  `src/lib/intel/crawler.ts`. v1 = initial Phase D.2 ship. */
        promptVersion: string;
        /** Length of the run's `errors[]` array — non-zero ≠ failure
         *  (per-item DB write failure increments without aborting the
         *  run); audit reviewers can drill into IntelItem rows for the
         *  org × time-window if errorsCount > 0. */
        errorsCount: number;
      };
    }
  | {
      // Phase 7.G E.2 v2 (Turn XLVII) — Board Deck narration cache miss.
      // Emitted ONLY on cache miss (i.e. when a fresh LLM call fired);
      // cache hits do NOT emit, otherwise the audit log would explode
      // on heavy traffic. The original miss already covers compliance
      // attestation for the cached row's lifetime.
      action: 'ai_board_deck_narration_run';
      entityType: 'Organization';
      entityId: string; // organizationId
      metadata: {
        period: string;
        language: 'en' | 'ru' | 'az';
        /** sha256 over snapshot's load-bearing fields — lets reviewers
         *  match cache rows to audit events. */
        snapshotHash: string;
        tokensIn: number;
        tokensOut: number;
        modelName: string;
        promptVersion: string;
      };
    }
  | {
      // Phase 7.G Turn LXX (Phase 4.2 closure) — admin added a period lock.
      // CFO compliance: who locked which period, when, with what reason.
      action: 'period_lock_add';
      entityType: 'Organization';
      entityId: string; // organizationId
      metadata: {
        /** Locked period — "YYYY" / "YYYY-Q[1-4]" / "YYYY-MM". */
        period: string;
        /** Optional reason text from admin form (≤500 chars; truncate at API). */
        reason?: string;
      };
    }
  | {
      // Phase 7.G Turn LXX (Phase 4.2 closure) — admin removed a period lock.
      // Captures lock-removal so re-opening a closed period leaves a trail.
      action: 'period_lock_remove';
      entityType: 'Organization';
      entityId: string; // organizationId
      metadata: {
        /** Period that was unlocked. */
        period: string;
        /** Original-lock metadata (preserves who/when/reason of the
         *  original lock now being removed; otherwise the trail loses
         *  context once the row is gone). */
        removedLock: {
          lockedAt: string;
          lockedBy: string;
          reason?: string;
        };
      };
    }
  | {
      // Phase 7.G Turn LXX (Phase 4.2 closure) — a mutation was REJECTED
      // by the period-lock gate (returned 423 Locked). Records the user's
      // attempt to mutate a closed period — CFO needs trail of attempted
      // post-close edits to spot bad-actor patterns or training gaps.
      // Fire-and-forget from `lockedResponse()`; audit-write failures are
      // swallowed so the 423 always reaches the caller intact.
      action: 'period_lock_blocked_mutation';
      entityType: 'Organization';
      entityId: string; // organizationId
      metadata: {
        /** Locked period that triggered the rejection. */
        period: string;
        /** Original lock's reason (if any) — surfaces "why this period is closed". */
        lockReason?: string;
        /** Route + verb that was attempted, e.g. "POST /api/budgeting/lines". */
        route: string;
      };
    }
  | {
      // Phase 7.G Turn CIV (Phase 7.E #3 v2 E.2e LLM wire) — daily
      // predictive-breach digest emission. Records the LLM call's cost +
      // breach count + top 3 companies the digest cited. Pattern B
      // (fire-and-forget) — digest narrative is returned to caller
      // synchronously; audit row is for compliance trail + admin spend
      // tracking, not for blocking the response.
      action: 'ai_breach_digest';
      entityType: 'Organization';
      entityId: string; // organizationId
      metadata: {
        period: string;
        language: 'en' | 'ru' | 'az';
        breachCount: number;
        topCompanies: string[]; // first 3 distinct companyIds in the digest
        tokensIn: number;
        tokensOut: number;
        modelName: string;
        promptVersion: string;
      };
    }
  | {
      // Phase 7.G Turn LXXXXIV (Phase 5.1.2 audit closure) — admin
      // override of `ChartOfAccount.role`. Affects P&L aggregation
      // across every consumer reading account roles (revenue / cogs /
      // opex / etc.) — must be auditable.
      //
      // Pattern A1 (await + soft surface) — caller surfaces auditStale
      // in response. Schema enum value (`coa_role_change`) lives in
      // `prisma/schema.prisma:1646`; runtime DB enum addition pending
      // user `prisma migrate deploy` — until applied the audit insert
      // fails gracefully (logger never-throws contract) and the role
      // change still commits.
      action: 'coa_role_change';
      entityType: 'ChartOfAccount';
      entityId: string;
      metadata: {
        /** Account code (e.g. "601-01") for human-readable forensics. */
        accountCode: string;
        /** Account name (snapshot — name may change later). */
        accountName: string;
        /** Prior role value (null = no override / Prisma default). */
        from: string | null;
        /** New role value (null = "clear override"). */
        to: string | null;
      };
    }
  | {
      // Phase 7.F sub-group RBAC admin v2 — admin updated a user's
      // allowedSubGroupIds. `entityId` = target user id; `before`/`after`
      // arrays let the audit feed render diffs cleanly.
      action: 'user_access_change';
      entityType: 'User';
      entityId: string;
      metadata: {
        targetEmail: string;
        before: string[];
        after: string[];
      };
    }
  | {
      // Phase 7.F admin v2 — admin promoted/demoted a user's role.
      // entityId = target user id; before/after capture the role
      // transition for compliance ("who promoted X to admin").
      action: 'user_role_change';
      entityType: 'User';
      entityId: string;
      metadata: {
        targetEmail: string;
        from: string;
        to: string;
      };
    }
  | {
      action: 'user_create';
      entityType: 'User';
      entityId: string;
      metadata: {
        targetEmail: string;
        targetName: string;
        role: string;
      };
    }
  | {
      action: 'user_password_reset';
      entityType: 'User';
      entityId: string;
      metadata: {
        targetEmail: string;
      };
    }
  | {
      action: 'user_active_toggle';
      entityType: 'User';
      entityId: string;
      metadata: {
        targetEmail: string;
        from: boolean;
        to: boolean;
      };
    }
  | {
      // Phase 7.H Feature 1 — Today's Brief AI news summary LLM call.
      // entityType=Organization since the summary is org-wide, not tied
      // to any single IndicatorValue.
      action: 'ai_news_summary_run';
      entityType: 'Organization';
      entityId: string;
      metadata: {
        language: 'en' | 'ru' | 'az';
        itemsConsumed: number;
        bulletsProduced: number;
        fromCache: boolean;
        usage?: { inputTokens: number; outputTokens: number };
      };
    }
  | {
      // Phase 7.E AI Morning Brief — composed CFO narrative LLM call.
      // entityType=Organization since the brief is org-wide.
      action: 'ai_morning_brief_run';
      entityType: 'Organization';
      entityId: string;
      metadata: {
        language: 'en' | 'ru' | 'az';
        worstCellsCount: number;
        moversCount: number;
        alertsCount: number;
        newsBulletsCount: number;
        fromCache: boolean;
        usage?: { inputTokens: number; outputTokens: number };
      };
    }
  | {
      // Phase 7.H F4.v2.3 — admin entered/updated/deleted a manual
      // operational KPI through `/budgeting/admin/data-entry`. Captures
      // the metric + value + source-note so a finance reviewer can
      // later replay why the indicator landed where it did.
      action:
        | 'operational_fact_create'
        | 'operational_fact_update'
        | 'operational_fact_delete';
      entityType: 'OperationalFact';
      entityId: string;
      metadata: {
        companyId: string;
        metric: string;
        date: string;
        value?: number;
        unit?: string;
        sourceNote?: string;
        previousValue?: number;
      };
    }
  | {
      // Phase 7.H F4.v2.3 — admin entered/updated/deleted a manual ESG
      // disclosure override. When the create lands, the next recompute
      // flips the IndicatorValue.valueSource from 'modeled_generic' to
      // 'disclosed' and the Panel-3 badge switches to teal "РАСКРЫТО".
      action:
        | 'indicator_disclosure_create'
        | 'indicator_disclosure_update'
        | 'indicator_disclosure_delete';
      entityType: 'IndicatorDisclosure';
      entityId: string;
      metadata: {
        companyId: string;
        indicatorCode: string;
        period: string;
        value?: number;
        unit?: string;
        sourceNote?: string;
        previousValue?: number;
      };
    }
  | {
      // Phase 7.H Feature 5 — client-reported reconciliation reference
      // values. `submit` covers both first-insert and update (upsert
      // path); `previousValue` in metadata is null for create, present
      // for update so audit reviewers can diff. Currency is logged
      // alongside value so a "1.5M" delta isn't ambiguous between AZN
      // and USD when the trail is replayed.
      action: 'client_reconciliation_submit';
      entityType: 'ClientReconciliation';
      entityId: string;
      metadata: {
        companyId: string;
        period: string;
        indicatorKey: string;
        clientValue: number;
        currency: string;
        noteLength?: number;
        previousValue?: number;
      };
    }
  | {
      action: 'client_reconciliation_delete';
      entityType: 'ClientReconciliation';
      entityId: string;
      metadata: {
        companyId: string;
        period: string;
        indicatorKey: string;
        deletedValue: number;
        currency: string;
      };
    }
  | {
      // Phase 7.I — admin updated `Company.settings` JSON (per-industry
      // operational descriptors: hectares, region, totalRooms, processing
      // capacity, etc.). The diff between previous and next is logged so
      // a future review can see what was changed without joining
      // back to the row's mutation history.
      action: 'company_settings_update';
      entityType: 'Company';
      entityId: string;
      metadata: {
        companyCode: string;
        industry: string | null;
        /** Keys that changed (added/modified/removed). Audit reviewer can
         *  drill: "AZSEKER-EDEN gained region=salyan, hectaresPlanted bumped
         *  10000→12000". */
        keysChanged: string[];
        /** Pre/post snapshot for forensics. Capped at 8 keys × 200 char
         *  values upstream to keep the audit row size reasonable. */
        before: Record<string, unknown> | null;
        after: Record<string, unknown>;
      };
    }
  | {
      // Phase 7.K Phase 5a — admin set/cleared an external API key in
      // Organization.settings.apiKeys (EIA / USDA / Google Trends
      // proxy). NEVER carries the key value — only source names that
      // changed, so a leaked audit log can't expose secrets.
      action: 'api_key_update';
      entityType: 'Organization';
      entityId: string; // organizationId
      metadata: {
        /** Sources whose keys were set/replaced. */
        updated: string[];
        /** Sources whose keys were cleared. */
        cleared: string[];
      };
    }
  | {
      // Phase 7.M Step 4 (2026-05-18) — self-service archive trail.
      // Used by both the admin Archive UI and the recovery flow; the
      // discriminating field is `metadata.entityKind`. Each invocation
      // captures the scope (companyCode + year/period) + rows affected
      // + an optional finance-user reason string so the IFRS 7-year
      // audit can reconstruct who archived what and why.
      action: 'data_archive' | 'data_restore';
      entityType:
        | 'BudgetLine'
        | 'BalanceSheetLine'
        | 'CashFlowEntry'
        | 'Counterparty';
      entityId: string; // companyCode + ":" + scope key (e.g. "AZSEKER-AZSF:2025")
      metadata: {
        entityKind:
          | 'BudgetLine'
          | 'BalanceSheetLine'
          | 'CashFlowEntry'
          | 'Counterparty';
        companyCode?: string;
        year?: number;
        period?: string;
        rowsAffected: number;
        reason?: string;
      };
    }
  | {
      // Phase 1.4 (2026-05-26) — BullMQ cleanup processor physically
      // removed soft-deleted rows past the 30-day retention. One audit
      // event per scheduled run (per-row would explode the table on a
      // heavy purge; data_archive already captured per-row intent).
      // Emitted from `cleanup-processor.ts` after the helper completes.
      action: 'soft_delete_purge';
      // System-wide event, not scoped to a single entity row. Reuse
      // "Organization" as a marker so list queries by entityType can
      // group infra events together.
      entityType: 'Organization';
      entityId: string; // organizationId emitting the event (single-org per run today)
      metadata: {
        counts: {
          budgetPlans: number;
          cashFlowEntries: number;
          balanceSheetLines: number;
          counterparties: number;
          total: number;
        };
        cutoffDays: number;
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
 *
 * ## Calling-pattern contract (Turn-38-sub8 architect ⚠️ closed Turn-Z)
 *
 * The function returns a Promise that NEVER rejects, only resolves to
 * `{ok: true|false, ...}`. Two legitimate caller patterns; choose based
 * on whether audit-write FAILURE should be visible to the user vs
 * silently swallowed for background observability.
 *
 * ### Pattern A1 — `await` + soft-warning surface (CRUD with response body)
 * ```ts
 * const auditResult = await logAuditEvent(prisma, { ... });
 * if (!auditResult.ok) {
 *   return NextResponse.json({ ...payload, auditStale: true });
 * }
 * ```
 * Use when the action is a user-initiated CRUD mutation (role change,
 * budget plan create/approve, staging apply, etc.) and an operator
 * looking at the audit log later would NOTICE the absence of a row.
 * Surfacing `auditStale: true` lets the UI either retry or warn.
 * Examples: `src/app/api/companies/[id]/route.ts:117` (role change),
 * `src/app/api/onboarding/import/staging/[id]/apply/route.ts:421` (budget apply).
 *
 * ### Pattern A2 — `await` without surface (status flips on response shapes that have no slot)
 * ```ts
 * await logAuditEvent(prisma, { ... });  // result ignored
 * return NextResponse.json({ error: 'gone' }, { status: 410 });
 * ```
 * Use when the response is an HTTP error/sentinel with no body to
 * attach `auditStale` to (e.g. 410 Gone on lazy-expire of a stale
 * staging row). Trade-off: blocks the user-facing response on the
 * audit write, but the action is rare and the audit row is required
 * for compliance trail. Caller MUST add inline comment ("logging
 * failure must not block X" — even though `await` does block) or
 * convert to Pattern B. NOT preferred for new code; only documented
 * because one site exists today: `src/app/api/onboarding/import/staging/[id]/apply/route.ts:104`.
 *
 * ### Pattern B — `void` + `.catch(console.error)` (background observability)
 * ```ts
 * void logAuditEvent(prisma, { ... }).catch(console.error);
 * ```
 * Use when the action is an AI/analytics side-effect (Variance/Forecast
 * Explainer, AI suite emissions) where the user expects an immediate
 * response and audit-write failure should NOT block or warn the user —
 * the row appearing in the audit log is for compliance/observability,
 * not for user-visible action confirmation. Examples:
 * `src/app/api/indicators/values/[id]/explain/route.ts:224` (variance explainer),
 * `src/app/api/indicators/values/[id]/forecast/explain/route.ts:262` (forecast explainer).
 *
 * ### Decision rubric
 *
 * | Action class                     | Pattern | Why                                 |
 * |----------------------------------|---------|-------------------------------------|
 * | CRUD mutation (POST/PUT/PATCH)   | A1      | Operator audit visibility load-bearing |
 * | Status flip on response w/ body  | A1      | Same compliance tier as CRUD        |
 * | Status flip on error/sentinel    | A2      | No body slot for auditStale         |
 * | Settings change (org thresholds) | A1      | Audited per compliance              |
 * | AI explainer / non-CRUD telemetry| B       | User UX > audit-failure surface     |
 * | Background cron (future)         | B       | No user-facing surface at all       |
 *
 * (The "background cron" row is a future placeholder — no cron-triggered
 * audit emissions exist in repo today; Phase 7.F audit-prune cron is a
 * pending CARRYOVER row, not yet shipped. When it lands, the new caller
 * pattern is locked in advance by this rubric.)
 *
 * Both patterns benefit from the same internal try/catch shape — the
 * function itself is identical regardless of caller choice. The contract
 * is purely about how the CALLER handles the resolved result.
 */
// Phase 5.2 Stage 2 (2026-05-21) — accept either the global PrismaClient
// or a Prisma.TransactionClient so callers wrapped in `withOrgScope`
// can pass their tx (preserves the SET LOCAL session var when the
// audit_events RLS migration applies). Existing callsites passing
// `prisma` keep working unchanged.
export async function logAuditEvent(
  prisma: PrismaClient | Prisma.TransactionClient,
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
