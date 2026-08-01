/**
 * Phase C6 (Bloomberg uplift plan) — multi-indicator alert rules engine.
 *
 * A "rule" is a named predicate that scans the current matrix snapshot
 * (companies × indicators × cells) and returns zero or more matches.
 * Each match is a structured alert with severity, human message, and
 * pointers to the offending entities (companyIds + indicatorCodes) so
 * the UI can navigate the user directly to the trouble spot.
 *
 * Plan §C6 quote: "≥3 amber in a sector → red rollup". This module
 * generalises that pattern: a rule is data + predicate, the engine is
 * a stateless `evaluateAlertRules(rules, ctx, config?) → AlertMatch[]`
 * that runs every rule against every (company, sector) cross-section
 * and returns the union of matches.
 *
 * v1 ships 5 default rules covering the common Bloomberg-style patterns:
 *   - companyMostlyRed: company has N+ red indicators
 *   - companyCriticalComposite: composite score < threshold
 *   - sectorAmberCluster: industry has N+ amber cells across companies
 *   - sectorRedSpread: industry has N+ red cells (more urgent)
 *   - criticalIndicatorOrgWide: a key indicator is red for N+ companies
 *
 * v2 (Phase 7.E sub-9 closure) externalises every threshold to the
 * `ResolvedAlertThresholds` config object passed through `evaluateAlertRules`.
 * Each rule's `match(ctx, config)` reads its own slice; defaults from
 * `alert-thresholds-config.ts` reproduce v1 behavior exactly when callers
 * pass `undefined`.
 *
 * UI integration is a separate concern — this module is pure data + logic.
 * Tests lock the rule semantics so future calibration tweaks don't drift
 * silently.
 */

import { isAggregateRollup, type HeatMapCell } from './heatmap-matrix';
import { computeCompositeScore, MIN_SCORING_CELLS } from './composite-score';
import { INDUSTRIES } from '@/lib/industries/data';
import {
  mergeWithDefaults,
  resolveForSector as resolveForSectorImpl,
  type AlertThresholdsConfig,
  type ResolvedAlertThresholds,
} from './alert-thresholds-config';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AlertCompany {
  id: string;
  code: string;
  name: string;
  industry?: string | null;
  isSubgroup?: boolean;
}

export interface AlertIndicator {
  id: string;
  code: string;
}

export interface AlertContext {
  companies: readonly AlertCompany[];
  indicators: readonly AlertIndicator[];
  cells: readonly HeatMapCell[];
  /**
   * Optional pre-built index from `companyId` → that company's non-rollup
   * cells. Populated by `evaluateAlertRules` exactly once per call (so
   * each rule's `match` doesn't re-walk the full cells array). Callers
   * who construct an `AlertContext` manually can omit this — the
   * `cellsForCompany` helper falls back to a linear filter. Phase F
   * matters here: 60 cos × 80 inds × 5 rules = 24K filter passes per
   * evaluation without the index, vs 5 × 4800 + 1 × 4800 = 28K ops
   * with it. Architect Round-1 sub-9 flag.
   */
  cellsByCompany?: ReadonlyMap<string, readonly HeatMapCell[]>;
}

export interface AlertMatch {
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  /**
   * English template-literal output. Kept for: (a) backward-compat with
   * existing `m.message`-based tests, (b) non-React callers like CLI
   * scripts and server-side log output, (c) i18n fallback when a
   * locale file lacks the per-rule `messageKey`. Sub-35 introduced
   * `messageKey` + `messageParams` for UI rendering — the EN
   * translation of `messageKey(messageParams)` MUST equal `message`
   * byte-for-byte (locked in `alert-rules-i18n.test.ts`).
   */
  message: string;
  /**
   * Sub-35 — i18n key under `terminal.alerts.messages.<ruleId>`. UI
   * render sites (AlertsPanel / ActionCenterPanel / CompanySnapshot /
   * board-deck) call `t(messageKey, messageParams)` and fall back to
   * `message` when the key is missing.
   */
  messageKey: string;
  /**
   * ICU-shaped placeholder values for `messageKey`. Per-rule shape is
   * fixed but loose-typed at the interface level so future rules can
   * vary their params without a discriminated-union refactor (deferred
   * until rule count > 10 — see CARRYOVER).
   */
  messageParams: Record<string, string | number>;
  /** Companies the user should drill into to investigate. */
  affectedCompanyIds: readonly string[];
  /** Indicator codes that triggered the alert (when applicable). */
  affectedIndicatorCodes?: readonly string[];
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  /**
   * In-severity sort tiebreaker. Lower = more urgent within the same
   * severity tier. CRO-mental-model priority: sector contagion (10)
   * runs ahead of org-wide-indicator (20) ahead of single-company
   * problems (30+) within `critical`. Engine falls back to alphabetic
   * `ruleName` when priorities tie. Default 100 — set explicitly per rule.
   */
  priority: number;
  /**
   * Returns zero or more matches. Pure function — caller treats output
   * as immutable. Returning an empty array means "rule did not trigger".
   *
   * `config` is the fully-resolved org-wide threshold config; the engine
   * merges defaults before passing it in, so each rule reads concrete
   * numbers.
   *
   * `resolveForSector` (Phase 7.E C6 v3) — optional callable that takes
   * an industry code and returns the sector-resolved threshold (sector
   * override layered over org-wide layered over defaults). Sector-aware
   * rules use this to look up per-industry thresholds; org-wide rules
   * (mostlyRed / criticalComposite / criticalIndicator) ignore it. The
   * arg is third (after `config`) so existing call sites that pass only
   * `(ctx, config)` stay backward-compatible — `resolveForSector` is
   * absent when the engine has no per-sector overrides to apply, and
   * sector-aware rules fall back to `config` (the org-wide resolution).
   */
  match: (
    ctx: AlertContext,
    config: ResolvedAlertThresholds,
    resolveForSector?: (industry: string) => ResolvedAlertThresholds,
  ) => AlertMatch[];
}

/**
 * Evaluate every rule against the given context, return the flat union
 * of all matches sorted by severity (critical → warning → info), then
 * by `priority` (lower first) within severity, then by `ruleName`
 * (alphabetic) for stable determinism on tied priorities.
 *
 * `config` may be undefined (uses defaults) or a partial
 * `AlertThresholdsConfig` (missing keys filled with defaults). Engine
 * resolves it once before iterating rules so every `match()` reads the
 * same fully-populated object.
 */
export function evaluateAlertRules(
  rules: readonly AlertRule[],
  ctx: AlertContext,
  config?: AlertThresholdsConfig | null,
): AlertMatch[] {
  const resolved = mergeWithDefaults(config ?? undefined);
  // Phase 7.E C6 v3 — per-sector resolver. Memoized so repeated lookups
  // for the same industry across a single evaluation reuse the resolved
  // object. `null` config + no `bySector` → memoized cache empty;
  // sector-aware rules effectively get the org-wide `resolved`.
  const sectorCache = new Map<string, ResolvedAlertThresholds>();
  const resolveForSector = (industry: string): ResolvedAlertThresholds => {
    const hit = sectorCache.get(industry);
    if (hit) return hit;
    const r = resolveForSectorImpl(config ?? undefined, industry);
    sectorCache.set(industry, r);
    return r;
  };
  const ruleMeta = new Map<string, { priority: number }>();
  for (const r of rules) ruleMeta.set(r.id, { priority: r.priority });
  // Pre-index cells by companyId once (filtering rollup rows) so each
  // rule's `match(ctx)` can read company-scoped cells in O(1) lookups
  // instead of O(N) per call. Architect Round-1 sub-9 closure: at
  // Phase F (60 cos × 80 inds × 5 rules) the index saves ~1.4M ops
  // per evaluation vs the per-rule filter pattern.
  const indexed: AlertContext = ctx.cellsByCompany
    ? ctx
    : { ...ctx, cellsByCompany: buildCellsByCompany(ctx.cells) };
  const out: AlertMatch[] = [];
  for (const rule of rules) {
    const matches = rule.match(indexed, resolved, resolveForSector);
    out.push(...matches);
  }
  return out.sort((a, b) => {
    const severityRank = (s: AlertSeverity): number =>
      s === 'critical' ? 0 : s === 'warning' ? 1 : 2;
    const sd = severityRank(a.severity) - severityRank(b.severity);
    if (sd !== 0) return sd;
    const pa = ruleMeta.get(a.ruleId)?.priority ?? 100;
    const pb = ruleMeta.get(b.ruleId)?.priority ?? 100;
    if (pa !== pb) return pa - pb;
    return a.ruleName.localeCompare(b.ruleName);
  });
}

/**
 * Build a `companyId → non-rollup cells` index in a single linear pass.
 * Used by `evaluateAlertRules` to amortize the filter across every rule
 * that reads the same context (architect Round-1 sub-9 closure).
 */
function buildCellsByCompany(
  cells: readonly HeatMapCell[],
): ReadonlyMap<string, readonly HeatMapCell[]> {
  const out = new Map<string, HeatMapCell[]>();
  for (const c of cells) {
    // Sub-44 cont'd architect closure — gate via shared
    // `isAggregateRollup` helper (covers Turn 33.5 synthetic averages
    // AND sub-44 real parent-co rollup IVs). Hand-rolled
    // `isSubgroupRollup` check would silently miss the new variant.
    if (isAggregateRollup(c)) continue;
    const list = out.get(c.companyId);
    if (list) list.push(c);
    else out.set(c.companyId, [c]);
  }
  return out;
}

/**
 * Helper: get cells belonging to a given company id, excluding rollup
 * rows (Phase C5 composite contract). Reads the pre-built index when
 * present (engine populates it once per `evaluateAlertRules` call) and
 * falls back to a linear filter for direct callers (e.g. unit tests
 * exercising a single rule's `match`).
 */
function cellsForCompany(
  ctx: AlertContext,
  companyId: string,
): readonly HeatMapCell[] {
  if (ctx.cellsByCompany) {
    return ctx.cellsByCompany.get(companyId) ?? [];
  }
  return ctx.cells.filter(
    (c) => c.companyId === companyId && !isAggregateRollup(c),
  );
}

// ────────────────────────────────────────────────────────────────────────
// Default rule pack
// ────────────────────────────────────────────────────────────────────────

export const RULE_COMPANY_MOSTLY_RED: AlertRule = {
  id: 'company-mostly-red',
  name: 'Company has many red indicators',
  description:
    'Flags companies with N or more red indicators — typical signal of a struggling sub-co needing executive attention. Threshold N is configurable per org.',
  severity: 'critical',
  priority: 30,
  match(ctx, config) {
    const out: AlertMatch[] = [];
    const threshold = config.mostlyRed.redCountMin;
    for (const co of ctx.companies) {
      if (co.isSubgroup) continue;
      const redCells = cellsForCompany(ctx, co.id).filter(
        (c) => c.status === 'red',
      );
      if (redCells.length >= threshold) {
        const indicatorIdToCode = new Map(
          ctx.indicators.map((i) => [i.id, i.code]),
        );
        out.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: this.severity,
          message: `${co.code} has ${redCells.length} red indicators — needs review`,
          messageKey: `alerts.messages.${this.id}`,
          messageParams: { code: co.code, redCount: redCells.length },
          affectedCompanyIds: [co.id],
          affectedIndicatorCodes: redCells
            .map((c) => indicatorIdToCode.get(c.indicatorId))
            .filter((code): code is string => typeof code === 'string'),
        });
      }
    }
    return out;
  },
};

export const RULE_COMPANY_CRITICAL_COMPOSITE: AlertRule = {
  id: 'company-critical-composite',
  name: 'Composite score below threshold',
  description:
    'Flags companies whose composite risk score (Phase C5) is below the configured floor — overall poor health regardless of which specific indicators are red.',
  severity: 'critical',
  priority: 40,
  match(ctx, config) {
    const out: AlertMatch[] = [];
    const threshold = config.criticalComposite.scoreMax;
    for (const co of ctx.companies) {
      if (co.isSubgroup) continue;
      const cells = cellsForCompany(ctx, co.id);
      const composite = computeCompositeScore(cells);
      // 11.81 — this rule is the one the bug report is about: DASTAN and SAF
      // read «composite score 0/100 (1/28 indicators)» and each such reading
      // persists an AlertEvent row. The `coverage === 'full'` clause is
      // redundant against the CompositeScore null invariant and is written
      // anyway — a rule should state its own precondition rather than inherit
      // it. No new entry in alert-thresholds-config: the gate rides on the
      // object the rule already computes, so the badge and the alert can
      // never disagree about who is scorable.
      if (composite.coverage === 'full' && composite.score !== null && composite.score < threshold) {
        out.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: this.severity,
          message: `${co.code} composite score ${composite.score}/100 (${composite.contributingCount}/${composite.totalCount} indicators)`,
          messageKey: `alerts.messages.${this.id}`,
          messageParams: {
            code: co.code,
            score: composite.score,
            contributing: composite.contributingCount,
            total: composite.totalCount,
          },
          affectedCompanyIds: [co.id],
        });
      }
    }
    return out;
  },
};

/**
 * 11.81 — the replacement for what the coverage floor takes away.
 *
 * Removing an alert and shipping silence in its place is not an improvement:
 * the brief's own constraint is that "not enough data" must read as a
 * MEASURABLE FACT, and a company with one indicator generates no signal at
 * all today. `warning`, not `critical`, because it is a state rather than a
 * risk, and it must not compete with real risk in the list.
 *
 * Fires on BOTH `none` and `insufficient` — a company with zero indicator
 * data is the stronger version of the same fact.
 *
 * Reads `MIN_SCORING_CELLS` directly so this rule and the gate that silences
 * `company-critical-composite` cannot drift apart.
 */
export const RULE_COMPANY_LOW_COVERAGE: AlertRule = {
  id: 'company-low-coverage',
  name: 'Too few indicators to score',
  description:
    'Flags companies with figures for fewer than the minimum number of indicators needed to publish a composite score. No composite score exists for them, so company-critical-composite cannot fire — this rule carries the fact instead.',
  severity: 'warning',
  priority: 20,
  match(ctx) {
    const out: AlertMatch[] = [];
    for (const co of ctx.companies) {
      if (co.isSubgroup) continue;
      const composite = computeCompositeScore(cellsForCompany(ctx, co.id));
      if (composite.coverage === 'full') continue;
      out.push({
        ruleId: this.id,
        ruleName: this.name,
        severity: this.severity,
        message: `${co.code} has figures for ${composite.contributingCount} of ${composite.totalCount} indicators — below the ${MIN_SCORING_CELLS} needed to publish a composite score`,
        messageKey: `alerts.messages.${this.id}`,
        messageParams: {
          code: co.code,
          contributing: composite.contributingCount,
          total: composite.totalCount,
          min: MIN_SCORING_CELLS,
        },
        affectedCompanyIds: [co.id],
      });
    }
    return out;
  },
};

/**
 * Phase 7.G Turn LVIII — resolve raw industry code to its canonical
 * EN human name (e.g. `"industrial"` → `"Industrial"`). Falls back to
 * the raw code when unknown so unrecognized industries still render
 * something rather than blank.
 *
 * Used by sector rules so the engine-emitted `m.message` reads cleanly
 * for fallback consumers (anywhere `match.message` is rendered without
 * the `messageKey + localizeAlertMessageParams` i18n substitution path).
 * After Turn LVIII the messages JSON namespace also returns proper-case
 * names; the engine's `m.message` now matches what the i18n path emits
 * for EN, restoring the byte-equality contract that
 * `alert-rules-i18n.test.ts` locks.
 */
function industryNameEn(code: string): string {
  return INDUSTRIES.find((i) => i.code === code)?.nameEn ?? code;
}

export const RULE_SECTOR_AMBER_CLUSTER: AlertRule = {
  id: 'sector-amber-cluster',
  name: 'Sector amber cluster',
  description:
    'Flags industries where amber cells aggregate across multiple companies — suggests sector-wide stress (FX, commodity, regulatory) rather than single-company issues.',
  severity: 'warning',
  priority: 10,
  match(ctx, config, resolveForSector) {
    const out: AlertMatch[] = [];
    const byIndustry = new Map<string, { companyIds: Set<string>; amberCount: number }>();
    for (const co of ctx.companies) {
      if (co.isSubgroup || !co.industry) continue;
      const amberCells = cellsForCompany(ctx, co.id).filter(
        (c) => c.status === 'amber',
      );
      if (amberCells.length === 0) continue;
      let bucket = byIndustry.get(co.industry);
      if (!bucket) {
        bucket = { companyIds: new Set(), amberCount: 0 };
        byIndustry.set(co.industry, bucket);
      }
      bucket.companyIds.add(co.id);
      bucket.amberCount += amberCells.length;
    }
    for (const [industry, bucket] of byIndustry) {
      // Phase 7.E C6 v3 — per-industry threshold lookup. Falls back to
      // org-wide `config` when no resolver supplied (back-compat with
      // direct `match(ctx, config)` callers in older tests).
      const sectorConfig = resolveForSector
        ? resolveForSector(industry)
        : config;
      const threshold = sectorConfig.sectorAmber.amberCountMin;
      if (bucket.amberCount >= threshold) {
        out.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: this.severity,
          message: `${industryNameEn(industry)} sector: ${bucket.amberCount} amber cells across ${bucket.companyIds.size} companies`,
          messageKey: `alerts.messages.${this.id}`,
          messageParams: {
            industry,
            amberCount: bucket.amberCount,
            companyCount: bucket.companyIds.size,
          },
          affectedCompanyIds: Array.from(bucket.companyIds),
        });
      }
    }
    return out;
  },
};

export const RULE_SECTOR_RED_SPREAD: AlertRule = {
  id: 'sector-red-spread',
  name: 'Sector red contagion',
  description:
    'Flags industries where red cells appear across multiple companies — suggests sector contagion rather than isolated company problem.',
  severity: 'critical',
  priority: 10,
  match(ctx, config, resolveForSector) {
    const out: AlertMatch[] = [];
    const byIndustry = new Map<string, { companyIds: Set<string>; redCount: number }>();
    for (const co of ctx.companies) {
      if (co.isSubgroup || !co.industry) continue;
      const redCells = cellsForCompany(ctx, co.id).filter(
        (c) => c.status === 'red',
      );
      if (redCells.length === 0) continue;
      let bucket = byIndustry.get(co.industry);
      if (!bucket) {
        bucket = { companyIds: new Set(), redCount: 0 };
        byIndustry.set(co.industry, bucket);
      }
      bucket.companyIds.add(co.id);
      bucket.redCount += redCells.length;
    }
    for (const [industry, bucket] of byIndustry) {
      // Phase 7.E C6 v3 — per-industry threshold lookup; back-compat fall
      // back to org-wide `config` when no resolver supplied.
      const sectorConfig = resolveForSector
        ? resolveForSector(industry)
        : config;
      const redThreshold = sectorConfig.sectorRedSpread.redCountMin;
      const coThreshold = sectorConfig.sectorRedSpread.companyCountMin;
      if (bucket.redCount >= redThreshold && bucket.companyIds.size >= coThreshold) {
        out.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: this.severity,
          message: `${industryNameEn(industry)} sector: ${bucket.redCount} red cells across ${bucket.companyIds.size} companies — possible contagion`,
          messageKey: `alerts.messages.${this.id}`,
          messageParams: {
            industry,
            redCount: bucket.redCount,
            companyCount: bucket.companyIds.size,
          },
          affectedCompanyIds: Array.from(bucket.companyIds),
        });
      }
    }
    return out;
  },
};

export const RULE_CRITICAL_INDICATOR_ORG_WIDE: AlertRule = {
  id: 'critical-indicator-org-wide',
  name: 'Critical indicator org-wide',
  description:
    'Flags org-wide pressure on a designated critical metric: if N+ companies have it red, the holding has a consolidated-level problem. The configured indicatorCode may be an exact code OR a "family" pattern with a leading "*" (e.g. "*_NET_MARGIN") that matches every per-sector variant (FP_NET_MARGIN / SVC_NET_MARGIN / …). Code + threshold are configurable per org.',
  severity: 'critical',
  priority: 20,
  match(ctx, config) {
    const configured = config.criticalIndicator.indicatorCode;
    const threshold = config.criticalIndicator.redCountMin;
    // Phase 8 fix: support a "family" pattern. A leading '*' suffix-matches
    // every indicator whose code ends with the rest — '*_NET_MARGIN' covers
    // FP_NET_MARGIN / SVC_NET_MARGIN / IND_NET_MARGIN across all industry
    // templates. Phase 7.M replaced the generic IND_* margins with
    // per-sector codes, so the old exact-match default ('IND_NET_MARGIN')
    // matched ZERO companies and this rule silently never fired. A plain
    // code (no '*') stays an exact match — back-compat for orgs that pinned
    // one specific indicator via Organization.settings.alertThresholds.
    const isFamily = configured.startsWith('*');
    const suffix = configured.slice(1); // e.g. '_NET_MARGIN'
    const targets = isFamily
      ? ctx.indicators.filter((i) => i.code.endsWith(suffix))
      : ctx.indicators.filter((i) => i.code === configured);
    if (targets.length === 0) return [];
    const targetIds = new Set(targets.map((i) => i.id));
    const redCells = ctx.cells.filter(
      (c) =>
        targetIds.has(c.indicatorId) &&
        c.status === 'red' &&
        !isAggregateRollup(c),
    );
    const uniqueCompanyIds = Array.from(
      new Set(redCells.map((c) => c.companyId)),
    );
    // Threshold is on COMPANY count (a company red on its sector's net
    // margin counts once), not raw cell count. Identical to cell count in
    // the single-indicator exact case → no behavior change there.
    if (uniqueCompanyIds.length < threshold) return [];
    // Distinct REAL codes that fired (not the '*_…' pattern) so downstream
    // consumers can resolve them — e.g. ['FP_NET_MARGIN', 'SVC_NET_MARGIN'].
    const idToCode = new Map(targets.map((i) => [i.id, i.code]));
    const matchedCodes = Array.from(
      new Set(redCells.map((c) => idToCode.get(c.indicatorId) as string)),
    );
    // Display label: strip the '*'/'*_' so the message reads
    // 'NET_MARGIN red for N companies', not '*_NET_MARGIN'.
    const label = isFamily ? configured.replace(/^\*_?/, '') : configured;
    return [
      {
        ruleId: this.id,
        ruleName: this.name,
        severity: this.severity,
        message: `${label} red for ${uniqueCompanyIds.length} companies — consolidated pressure on critical metric`,
        messageKey: `alerts.messages.${this.id}`,
        messageParams: {
          code: label,
          companyCount: uniqueCompanyIds.length,
        },
        affectedCompanyIds: uniqueCompanyIds,
        affectedIndicatorCodes: matchedCodes,
      },
    ];
  },
};

/**
 * Default rule pack shipped with the engine. Customers can override or
 * extend by passing their own `AlertRule[]` to `evaluateAlertRules`.
 */
export const DEFAULT_ALERT_RULES: readonly AlertRule[] = [
  RULE_COMPANY_MOSTLY_RED,
  RULE_COMPANY_CRITICAL_COMPOSITE,
  // 11.81 — `RULE_COMPANY_MOSTLY_RED` is deliberately untouched by the
  // coverage floor: it counts OBSERVED red cells, and an observation is not
  // an inference. Coverage gates inference. The two can therefore coexist on
  // one company — "we cannot grade you, and everything we can see is red" is
  // more informative than either statement alone.
  RULE_COMPANY_LOW_COVERAGE,
  RULE_SECTOR_RED_SPREAD,
  RULE_SECTOR_AMBER_CLUSTER,
  RULE_CRITICAL_INDICATOR_ORG_WIDE,
];

/**
 * Sub-35 — id-set view of `DEFAULT_ALERT_RULES`. UI render sites use it
 * to gate `t(\`alerts.rules.\${id}\`)` and `t(\`alerts.messages.\${id}\`)`
 * calls — only built-in rule ids have locale entries; custom user rules
 * + synthetic test fixtures fall back to engine-emitted English fields.
 *
 * Single source of truth — replaces the 3 hand-maintained duplicates
 * that previously lived in AlertsPanel / ActionCenterPanel /
 * CompanySnapshot. Adding a new built-in rule to `DEFAULT_ALERT_RULES`
 * automatically registers it for the locale path.
 */
export const DEFAULT_ALERT_RULE_IDS: ReadonlySet<string> = new Set(
  DEFAULT_ALERT_RULES.map((r) => r.id),
);
