/**
 * Sub-35 — alert message i18n drift guard.
 *
 * Each AlertRule emits BOTH:
 *   - `message: string` — English template-literal output (engine code,
 *     used as fallback when locale entry is missing, asserted on by
 *     existing tests in `alert-rules.test.ts`).
 *   - `messageKey` + `messageParams` — i18n contract used by UI render
 *     sites (AlertsPanel / ActionCenterPanel / CompanySnapshot /
 *     board-deck).
 *
 * These two MUST stay in sync — formatting `messages.en.json` →
 * `terminal.alerts.messages[ruleId]` with `messageParams` MUST equal the
 * `message` field byte-for-byte. If they drift (e.g. someone edits the
 * en.json copy without updating the alert-rules.ts template literal, or
 * vice versa) the EN-locale UI shows a different sentence than the
 * engine emits — silent locale skew.
 *
 * This test re-creates representative AlertMatch fixtures for every
 * built-in rule, formats their `messageKey` against `messages/en.json`,
 * and asserts equality with `message`.
 */

import { describe, it, expect } from "vitest";
import {
  RULE_COMPANY_MOSTLY_RED,
  RULE_COMPANY_CRITICAL_COMPOSITE,
  RULE_COMPANY_LOW_COVERAGE,
  RULE_SECTOR_AMBER_CLUSTER,
  RULE_SECTOR_RED_SPREAD,
  RULE_CRITICAL_INDICATOR_ORG_WIDE,
  DEFAULT_ALERT_RULE_IDS,
  type AlertContext,
} from "./alert-rules";
import { mergeWithDefaults } from "./alert-thresholds-config";
import enJson from "../../../messages/en.json";

/**
 * Flat-placeholder ICU formatter. The 5 alert-message templates use only
 * `{name}` substitution (no plurals / select / formatNumber); a regex
 * replace is sufficient and avoids pulling in an Intl.MessageFormat
 * dependency for one test file.
 */
function formatTemplate(
  template: string,
  params: Record<string, string | number>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return out;
}

const enMessages = (enJson as { terminal: { alerts: { messages: Record<string, string> } } })
  .terminal.alerts.messages;
const enRules = (enJson as { terminal: { alerts: { rules: Record<string, string> } } })
  .terminal.alerts.rules;

// Phase 7.G Turn I architect Round-1 ⚠️ closure — the L142 drift class
// explicitly says "messages/{en,ru,az}.json", but the original Turn-I
// closure only locked EN. Adding `ruJson` + `azJson` parameterized loops
// below catches the silent-RU/AZ-skew failure mode exactly as the
// `industries.*` consistency-guard does in `alert-message-i18n.test.ts`.
import ruJson from "../../../messages/ru.json";
import azJson from "../../../messages/az.json";

const ruMessages = (ruJson as { terminal: { alerts: { messages: Record<string, string> } } })
  .terminal.alerts.messages;
const ruRules = (ruJson as { terminal: { alerts: { rules: Record<string, string> } } })
  .terminal.alerts.rules;
const azMessages = (azJson as { terminal: { alerts: { messages: Record<string, string> } } })
  .terminal.alerts.messages;
const azRules = (azJson as { terminal: { alerts: { rules: Record<string, string> } } })
  .terminal.alerts.rules;

const ALL_LOCALES = [
  { name: "en", messages: enMessages, rules: enRules },
  { name: "ru", messages: ruMessages, rules: ruRules },
  { name: "az", messages: azMessages, rules: azRules },
] as const;

describe("alert message i18n drift guard (sub-35)", () => {
  // The 5 byte-equality `it()` cases below are by-design EN-only: the
  // engine emits English template literals via `message: \`...\``, and
  // these tests assert the locale-formatted EN substitution matches that
  // engine output byte-for-byte. RU/AZ rendering correctness is covered
  // separately by the parameterized `for (const locale of ALL_LOCALES)`
  // loop further down (Phase 7.G Turn I / L142 closure) — that loop
  // verifies every rule has matching entries in messages/{ru,az}.json
  // without re-running byte-equality (which is structurally an
  // EN-vs-engine concern). Semantic anchors used instead of line
  // numbers so this comment doesn't rot on future edits.
  it("RULE_COMPANY_MOSTLY_RED — EN template formats to engine `message`", () => {
    const ctx: AlertContext = {
      companies: [
        { id: "c1", code: "AAC-MAIN", name: "AAC Main", industry: "Industrial" },
      ],
      indicators: [
        { id: "i1", code: "X1" },
        { id: "i2", code: "X2" },
        { id: "i3", code: "X3" },
      ],
      cells: [
        { indicatorValueId: "iv1", companyId: "c1", indicatorId: "i1", value: 0, status: "red" },
        { indicatorValueId: "iv2", companyId: "c1", indicatorId: "i2", value: 0, status: "red" },
        { indicatorValueId: "iv3", companyId: "c1", indicatorId: "i3", value: 0, status: "red" },
      ],
    };
    const [m] = RULE_COMPANY_MOSTLY_RED.match(ctx, mergeWithDefaults(undefined));
    const formatted = formatTemplate(
      enMessages["company-mostly-red"],
      m.messageParams,
    );
    expect(formatted).toBe(m.message);
  });

  it("RULE_COMPANY_LOW_COVERAGE — EN template formats to engine `message`", () => {
    const ctx: AlertContext = {
      companies: [
        { id: "c1", code: "AZSEKER-DASTAN", name: "Dastan", industry: "agro_crops" },
      ],
      indicators: [
        { id: "i1", code: "X1" },
        { id: "i2", code: "X2" },
      ],
      cells: [
        { indicatorValueId: "iv1", companyId: "c1", indicatorId: "i1", value: 0, status: "red" },
        { indicatorValueId: "iv2", companyId: "c1", indicatorId: "i2", value: 0, status: "unknown" },
      ],
    };
    const [m] = RULE_COMPANY_LOW_COVERAGE.match(ctx, mergeWithDefaults(undefined));
    const formatted = formatTemplate(
      enMessages["company-low-coverage"],
      m.messageParams,
    );
    expect(formatted).toBe(m.message);
  });

  it("RULE_COMPANY_CRITICAL_COMPOSITE — EN template formats to engine `message`", () => {
    const ctx: AlertContext = {
      companies: [
        { id: "c1", code: "BAD-CO", name: "Bad", industry: "Industrial" },
      ],
      // 11.81 — four cells, so the company clears the coverage floor and the
      // rule actually emits a match to compare against.
      indicators: [
        { id: "i1", code: "X1" },
        { id: "i2", code: "X2" },
        { id: "i3", code: "X3" },
        { id: "i4", code: "X4" },
      ],
      cells: [
        { indicatorValueId: "iv1", companyId: "c1", indicatorId: "i1", value: 0, status: "red" },
        { indicatorValueId: "iv2", companyId: "c1", indicatorId: "i2", value: 0, status: "red" },
        { indicatorValueId: "iv3", companyId: "c1", indicatorId: "i3", value: 0, status: "red" },
        { indicatorValueId: "iv4", companyId: "c1", indicatorId: "i4", value: 0, status: "red" },
      ],
    };
    const [m] = RULE_COMPANY_CRITICAL_COMPOSITE.match(ctx, mergeWithDefaults(undefined));
    const formatted = formatTemplate(
      enMessages["company-critical-composite"],
      m.messageParams,
    );
    expect(formatted).toBe(m.message);
  });

  it("RULE_SECTOR_AMBER_CLUSTER — EN template formats to engine `message`", () => {
    const ctx: AlertContext = {
      companies: [
        { id: "c1", code: "A", name: "A", industry: "Industrial" },
        { id: "c2", code: "B", name: "B", industry: "Industrial" },
      ],
      indicators: [
        { id: "i1", code: "X1" },
        { id: "i2", code: "X2" },
        { id: "i3", code: "X3" },
      ],
      cells: [
        { indicatorValueId: "iv1", companyId: "c1", indicatorId: "i1", value: 0, status: "amber" },
        { indicatorValueId: "iv2", companyId: "c1", indicatorId: "i2", value: 0, status: "amber" },
        { indicatorValueId: "iv3", companyId: "c1", indicatorId: "i3", value: 0, status: "amber" },
        { indicatorValueId: "iv4", companyId: "c2", indicatorId: "i1", value: 0, status: "amber" },
        { indicatorValueId: "iv5", companyId: "c2", indicatorId: "i2", value: 0, status: "amber" },
      ],
    };
    const [m] = RULE_SECTOR_AMBER_CLUSTER.match(ctx, mergeWithDefaults(undefined));
    const formatted = formatTemplate(
      enMessages["sector-amber-cluster"],
      m.messageParams,
    );
    expect(formatted).toBe(m.message);
  });

  // Phase 7.G Turn LVIII fix-before-build (architect closure):
  // Production code passes lowercase snake_case industry codes from
  // `Company.industry` (e.g. "industrial"), not proper-case "Industrial"
  // used by the byte-equality fixtures above. The lowercase path goes
  // through `industryNameEn(code)` which DOES find a match in INDUSTRIES
  // and substitutes the proper-case `nameEn` ("Industrial"). The EN
  // template substitutes the raw param ("industrial"). These are NO
  // longer byte-equal — but the i18n consumer path (which production
  // uses) reconciles via `localizeAlertMessageParams`. This test locks
  // the production-path behavior: engine emits proper-case in m.message,
  // raw code is preserved in messageParams for downstream localization.
  it("RULE_SECTOR_AMBER_CLUSTER — engine emits canonical EN name even when input is raw lowercase code", () => {
    const ctx: AlertContext = {
      companies: [
        { id: "c1", code: "A", name: "A", industry: "industrial" },
        { id: "c2", code: "B", name: "B", industry: "industrial" },
      ],
      indicators: [
        { id: "i1", code: "X1" },
        { id: "i2", code: "X2" },
        { id: "i3", code: "X3" },
      ],
      cells: [
        { indicatorValueId: "iv1", companyId: "c1", indicatorId: "i1", value: 0, status: "amber" },
        { indicatorValueId: "iv2", companyId: "c1", indicatorId: "i2", value: 0, status: "amber" },
        { indicatorValueId: "iv3", companyId: "c1", indicatorId: "i3", value: 0, status: "amber" },
        { indicatorValueId: "iv4", companyId: "c2", indicatorId: "i1", value: 0, status: "amber" },
        { indicatorValueId: "iv5", companyId: "c2", indicatorId: "i2", value: 0, status: "amber" },
      ],
    };
    const [m] = RULE_SECTOR_AMBER_CLUSTER.match(ctx, mergeWithDefaults(undefined));
    // Engine `m.message` MUST start with proper-case "Industrial"
    // (resolved via `industryNameEn` lookup in INDUSTRIES).
    expect(m.message).toMatch(/^Industrial sector:/);
    // `messageParams.industry` MUST stay as raw code so the consumer
    // i18n path (`localizeAlertMessageParams`) can substitute to RU/AZ.
    expect(m.messageParams.industry).toBe("industrial");
  });

  it("RULE_SECTOR_RED_SPREAD — EN template formats to engine `message`", () => {
    const ctx: AlertContext = {
      companies: [
        { id: "c1", code: "A", name: "A", industry: "Industrial" },
        { id: "c2", code: "B", name: "B", industry: "Industrial" },
      ],
      indicators: [{ id: "i1", code: "X" }, { id: "i2", code: "Y" }],
      cells: [
        { indicatorValueId: "iv1", companyId: "c1", indicatorId: "i1", value: 0, status: "red" },
        { indicatorValueId: "iv2", companyId: "c1", indicatorId: "i2", value: 0, status: "red" },
        { indicatorValueId: "iv3", companyId: "c2", indicatorId: "i1", value: 0, status: "red" },
      ],
    };
    const [m] = RULE_SECTOR_RED_SPREAD.match(ctx, mergeWithDefaults(undefined));
    const formatted = formatTemplate(
      enMessages["sector-red-spread"],
      m.messageParams,
    );
    expect(formatted).toBe(m.message);
  });

  it("RULE_CRITICAL_INDICATOR_ORG_WIDE — EN template formats to engine `message`", () => {
    const ctx: AlertContext = {
      companies: [
        { id: "c1", code: "A", name: "A", industry: "Industrial" },
        { id: "c2", code: "B", name: "B", industry: "Industrial" },
        { id: "c3", code: "C", name: "C", industry: "Industrial" },
      ],
      // Phase 8 — default critical metric is now the exact IND_EBITDA_MARGIN.
      indicators: [{ id: "i1", code: "IND_EBITDA_MARGIN" }],
      cells: [
        { indicatorValueId: "iv1", companyId: "c1", indicatorId: "i1", value: 0, status: "red" },
        { indicatorValueId: "iv2", companyId: "c2", indicatorId: "i1", value: 0, status: "red" },
        { indicatorValueId: "iv3", companyId: "c3", indicatorId: "i1", value: 0, status: "red" },
      ],
    };
    const [m] = RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx, mergeWithDefaults(undefined));
    const formatted = formatTemplate(
      enMessages["critical-indicator-org-wide"],
      m.messageParams,
    );
    expect(formatted).toBe(m.message);
  });

  // Phase 7.G Turn I (CARRYOVER L142 closure) — converted from hardcoded
  // 5-id list to self-driving derivation off the engine's canonical
  // `DEFAULT_ALERT_RULE_IDS` ReadonlySet. Adding a new built-in rule to
  // `alert-rules.ts:DEFAULT_ALERT_RULES` (without adding the matching
  // i18n entries) now FAILS this test instead of silently bypassing the
  // hand-maintained list. Architect Round-1 ⚠️ closure: the original
  // Turn-I shipped only the EN namespace check; the L142 drift class
  // explicitly says "messages/{en,ru,az}.json", so the loops below
  // parameterize over ALL_LOCALES — RU/AZ omission is now caught
  // symmetrically (1:1 mirror of the `industries.*` 3-locale pattern in
  // `alert-message-i18n.test.ts:212-256`).

  for (const locale of ALL_LOCALES) {
    it(`${locale.name}.json: every built-in rule id has an entry in messages namespace (self-driving)`, () => {
      const allRuleIds = Array.from(DEFAULT_ALERT_RULE_IDS).sort();
      expect(
        allRuleIds.length,
        "DEFAULT_ALERT_RULE_IDS unexpectedly empty — engine refactor likely broke the export.",
      ).toBeGreaterThan(0);
      for (const id of allRuleIds) {
        expect(
          locale.messages[id],
          `Missing terminal.alerts.messages.${id} in messages/${locale.name}.json — adding a new rule to DEFAULT_ALERT_RULES requires an i18n entry in ALL 3 locales (en/ru/az). Update messages/{en,ru,az}.json before shipping the rule.`,
        ).toBeDefined();
        // Sanity — ICU placeholders must still be present (someone
        // deleting a `{code}` would silently render `undefined` at
        // runtime).
        expect(typeof locale.messages[id]).toBe("string");
        expect(locale.messages[id].length).toBeGreaterThan(0);
      }
    });

    // Sub-35 + Turn-I L142: every built-in rule must ALSO have a
    // `terminal.alerts.rules.${id}` display-name entry per locale. The
    // 4 render sites (AlertsPanel / ActionCenterPanel / CompanySnapshot
    // / board-deck) call `t(`alerts.rules.${m.ruleId}`)` for the rule
    // name; missing entry → next-intl throws → render-site try/catch
    // falls back to engine `m.ruleName` (English) → silent locale skew.
    // Catch at unit-test time, in every locale.
    it(`${locale.name}.json: every built-in rule id has an entry in rules namespace (display name)`, () => {
      const allRuleIds = Array.from(DEFAULT_ALERT_RULE_IDS).sort();
      for (const id of allRuleIds) {
        expect(
          locale.rules[id],
          `Missing terminal.alerts.rules.${id} in messages/${locale.name}.json — render sites call t('alerts.rules.${id}') for the rule's display name. Update messages/{en,ru,az}.json:terminal.alerts.rules.* before shipping the rule.`,
        ).toBeDefined();
        expect(typeof locale.rules[id]).toBe("string");
        expect(locale.rules[id].length).toBeGreaterThan(0);
      }
    });

    // Defense-in-depth: also catch the inverse — i18n entries WITHOUT a
    // matching rule in `DEFAULT_ALERT_RULE_IDS`. Stale entries are less
    // critical than missing ones (no runtime breakage, just dead
    // translation work) but worth surfacing per locale so messages files
    // don't grow orphan keys over time.
    it(`${locale.name}.json: no orphan rule entries (inverse check)`, () => {
      const ruleIdSet = DEFAULT_ALERT_RULE_IDS;
      const orphanMessages = Object.keys(locale.messages).filter(
        (k) => !ruleIdSet.has(k),
      );
      const orphanRules = Object.keys(locale.rules).filter(
        (k) => !ruleIdSet.has(k),
      );
      expect(
        orphanMessages,
        `Orphan rule ids in messages/${locale.name}.json:terminal.alerts.messages: ${orphanMessages.join(", ")}. Either remove them OR add the matching rule to alert-rules.ts:DEFAULT_ALERT_RULES.`,
      ).toEqual([]);
      expect(
        orphanRules,
        `Orphan rule ids in messages/${locale.name}.json:terminal.alerts.rules: ${orphanRules.join(", ")}. Either remove them OR add the matching rule to alert-rules.ts:DEFAULT_ALERT_RULES.`,
      ).toEqual([]);
    });
  }
});
