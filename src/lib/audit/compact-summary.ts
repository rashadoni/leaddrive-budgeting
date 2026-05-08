/**
 * Phase 7.G Turn W — single source of truth for audit-event summarization.
 *
 * Returns BOTH a compact one-liner (≤ ~40 chars, used by AuditTicker
 * bottom strip) and a verbose form (table-row detail with line counts /
 * dates, used by AuditFeed). Both forms read the same `action` switch +
 * the same per-action metadata fields, so adding a new audit action
 * requires updating one site, not two.
 *
 * Closes Turn-40-sub3 architect ⚠️ on drift between
 *   AuditTicker.compactSummary (3-4 action branches, missed
 *     `ai_variance_explainer_run` until Turn-40 inline-fix)
 *   AuditFeed.summarizeMetadata (8 action branches, missing
 *     `ai_variance_explainer_run` entirely)
 * Pre-Turn-W, future audit actions wired in `src/lib/audit/log.ts`
 * required updates at both sites or one would silently fall through to
 * its generic-fallback branch.
 *
 * Design notes:
 *   - Single switch covering every `AuditAction` enum member from the
 *     Prisma client (compile-time exhaustiveness via TypeScript).
 *   - Consumers pass `{action, entityType, metadata}` — minimal shape so
 *     both API-response objects and partial fixtures work.
 *   - Each branch returns `{compact, verbose}`; if metadata fields are
 *     missing, fall through to a per-action default that uses entityType
 *     or a JSON preview.
 */

import type { AuditAction } from '@prisma/client';

export interface AuditEventLike {
  action: AuditAction;
  entityType: string;
  metadata: Record<string, unknown>;
}

export interface AuditSummary {
  /** Tight one-liner for ticker / strip surfaces. ≤ ~40 chars typical.
   *  Skips counts and dates — keeps the most identifying token (code,
   *  name, year). */
  compact: string;
  /** Fuller form for table rows / detail panes. Includes counts, dates,
   *  status transitions, etc. Falls back to JSON preview for unknown
   *  actions. */
  verbose: string;
}

export function summarizeAuditEvent(e: AuditEventLike): AuditSummary {
  const m = e.metadata;
  switch (e.action) {
    case 'company_role_change': {
      const code = stringField(m, 'companyCode');
      const from = stringField(m, 'from');
      const to = stringField(m, 'to');
      const compact = code ?? e.entityType;
      const verbose =
        from && to ? `${code ? code + ' · ' : ''}${from} → ${to}` : compact;
      return { compact, verbose };
    }
    case 'import_budget_create': {
      const code = stringField(m, 'companyCode');
      const year = numberField(m, 'year');
      const inserted = numberField(m, 'inserted');
      const compact = code ?? e.entityType;
      const verbose =
        code && year !== null
          ? `${code} · ${year}${inserted !== null ? ` · ${inserted} lines` : ''}`
          : compact;
      return { compact, verbose };
    }
    case 'import_staging_apply': {
      const year = numberField(m, 'year');
      const inserted = numberField(m, 'inserted');
      const deleted = numberField(m, 'deleted');
      const compact = year !== null ? String(year) : e.entityType;
      let verbose: string;
      if (year !== null) {
        const parts = [`${year}`];
        if (inserted !== null) parts.push(`${inserted} inserted`);
        if (deleted !== null) parts.push(`${deleted} deleted`);
        verbose = parts.join(' · ');
      } else {
        verbose = compact;
      }
      return { compact, verbose };
    }
    case 'import_staging_expired': {
      const triggeredBy = stringField(m, 'triggeredBy');
      const expiresAt = stringField(m, 'expiresAt');
      const compact = triggeredBy ? `via ${triggeredBy}` : e.entityType;
      const verbose =
        triggeredBy && expiresAt
          ? `via ${triggeredBy} · expired ${formatTimestamp(expiresAt)}`
          : compact;
      return { compact, verbose };
    }
    case 'budget_plan_create': {
      const name = stringField(m, 'planName');
      const year = numberField(m, 'year');
      const compact = name ?? e.entityType;
      const verbose =
        name && year !== null ? `${name} · ${year}` : compact;
      return { compact, verbose };
    }
    case 'budget_plan_approve': {
      const name = stringField(m, 'planName');
      const prior = stringField(m, 'priorStatus');
      const compact = name ?? e.entityType;
      const verbose =
        name && prior ? `${name} · was ${prior}` : compact;
      return { compact, verbose };
    }
    case 'indicator_override_create':
    case 'indicator_override_update':
    case 'indicator_override_delete': {
      const code = stringField(m, 'code');
      const compact = code ?? e.entityType;
      let verbose = compact;
      if (code) {
        const tags: string[] = [];
        if (m.formulaChanged === true) tags.push('formula');
        if (m.thresholdsChanged === true) tags.push('thresholds');
        verbose = tags.length > 0 ? `${code} · ${tags.join(', ')}` : code;
      }
      return { compact, verbose };
    }
    case 'ai_variance_explainer_run':
    case 'ai_forecast_explainer_run': {
      // Variance + forecast explainers share metadata shape
      // (indicatorCode + language) — see route.ts emission sites at
      // `src/app/api/indicators/values/[id]/explain/route.ts` +
      // `.../forecast/explain/route.ts`. Pre-Turn-W, AuditFeed had no
      // branch and would fall through to JSON preview — drift class
      // this helper closes via TS exhaustiveness.
      const code = stringField(m, 'indicatorCode');
      const lang = stringField(m, 'language');
      const compact = code
        ? lang
          ? `${code} · ${lang.toUpperCase()}`
          : code
        : e.entityType;
      const verbose = compact;
      return { compact, verbose };
    }
    case 'alert_thresholds_update': {
      // Org settings change — no per-row code; entityType is the org
      // identity. Compact uses entityType, verbose adds change-count
      // hint if metadata exposes one.
      const compact = e.entityType;
      const after = m.after;
      const ruleCount =
        after && typeof after === 'object'
          ? Object.keys(after as Record<string, unknown>).length
          : null;
      const verbose =
        ruleCount !== null && ruleCount > 0
          ? `${e.entityType} · ${ruleCount} rule${ruleCount === 1 ? '' : 's'}`
          : compact;
      return { compact, verbose };
    }
    case 'intel_crawl_run': {
      // Phase 7.G D.2 — admin-triggered AI Web Crawler run, scoped to
      // the org. No per-row code; verbose surfaces item counts so the
      // feed shows at a glance whether a crawl was productive.
      const compact = e.entityType;
      const created = numberField(m, 'itemsCreated');
      const fetched = numberField(m, 'itemsFetched');
      const verbose =
        created !== null && fetched !== null
          ? `${e.entityType} · ${created} new / ${fetched} hit${fetched === 1 ? '' : 's'}`
          : compact;
      return { compact, verbose };
    }
    case 'ai_board_deck_narration_run': {
      // Phase 7.G E.2 v2 — Board Deck narration cache miss. Compact
      // shows the org; verbose surfaces period + language so review
      // can spot whether a particular period was re-narrated.
      const compact = e.entityType;
      const period = stringField(m, 'period');
      const lang = stringField(m, 'language');
      const verbose =
        period && lang
          ? `${e.entityType} · ${period} · ${lang.toUpperCase()}`
          : compact;
      return { compact, verbose };
    }
    case 'period_lock_add':
    case 'period_lock_remove': {
      // Phase 7.G Turn LXX — admin lock/unlock of a fiscal period.
      // Compact = period; verbose adds reason (or "removed" annotation).
      const period = stringField(m, 'period');
      const reason = stringField(m, 'reason');
      const compact = period ?? e.entityType;
      let verbose = compact;
      if (period && e.action === 'period_lock_add') {
        verbose = reason ? `${period} · ${reason}` : period;
      } else if (period && e.action === 'period_lock_remove') {
        verbose = `${period} · removed`;
      }
      return { compact, verbose };
    }
    case 'period_lock_blocked_mutation': {
      // Phase 7.G Turn LXX — a mutation was rejected by the period-lock
      // gate. Compact = period; verbose surfaces route + reason so the
      // CFO can see "who tried to write to a closed period".
      const period = stringField(m, 'period');
      const route = stringField(m, 'route');
      const reason = stringField(m, 'lockReason');
      const compact = period ?? e.entityType;
      let verbose = compact;
      if (period && route) {
        verbose = reason ? `${period} · ${route} · "${reason}"` : `${period} · ${route}`;
      }
      return { compact, verbose };
    }
    default: {
      // Compile-time exhaustiveness: assigning the narrowed `e.action`
      // (now type `never` because every other AuditAction member was
      // handled above) to a `never`-typed local fails tsc if a new
      // enum member is added without a corresponding case. Runtime
      // fallback for enum-DB drift (DB has a value the TS type doesn't
      // know about): emit JSON-preview verbose like pre-Turn-W. Closes
      // Turn-W architect Round-1 💡 #1 — switch shape now has explicit
      // default arm with the assertion at the discriminator level.
      const _exhaust: never = e.action;
      void _exhaust;
      const preview = JSON.stringify(m);
      const verbose = preview.length > 80 ? preview.slice(0, 77) + '…' : preview;
      return { compact: e.entityType, verbose };
    }
  }
}

/** Coerce metadata field to a non-empty string or null. Exported so test
 *  fixtures + future audit-summary call sites can reuse the same shape. */
export function stringField(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const v = metadata[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Coerce metadata field to a finite number or null. */
export function numberField(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const v = metadata[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
