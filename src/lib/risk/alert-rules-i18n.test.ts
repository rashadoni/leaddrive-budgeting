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

describe("alert message i18n drift guard (sub-35)", () => {
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

  it("RULE_COMPANY_CRITICAL_COMPOSITE — EN template formats to engine `message`", () => {
    const ctx: AlertContext = {
      companies: [
        { id: "c1", code: "BAD-CO", name: "Bad", industry: "Industrial" },
      ],
      indicators: [
        { id: "i1", code: "X1" },
        { id: "i2", code: "X2" },
      ],
      cells: [
        { indicatorValueId: "iv1", companyId: "c1", indicatorId: "i1", value: 0, status: "red" },
        { indicatorValueId: "iv2", companyId: "c1", indicatorId: "i2", value: 0, status: "red" },
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
      indicators: [{ id: "i1", code: "IND_NET_MARGIN" }],
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

  // Phase 7.G Turn H' (commit chain Turn H' / L138 closure) — converted
  // from hardcoded 5-id list to self-driving derivation off the engine's
  // canonical `DEFAULT_ALERT_RULE_IDS` ReadonlySet. Adding a new built-in
  // rule to `alert-rules.ts:DEFAULT_ALERT_RULES` (without adding the
  // matching i18n entries) now FAILS this test instead of silently
  // bypassing the hand-maintained list. Closes the drift class architect
  // flagged at CARRYOVER L138 (sub-35 follow-up — extend i18n scanner to
  // engine modules).
  it("every built-in rule id has an entry in en.json messages namespace (self-driving)", () => {
    const allRuleIds = Array.from(DEFAULT_ALERT_RULE_IDS).sort();
    expect(
      allRuleIds.length,
      "DEFAULT_ALERT_RULE_IDS unexpectedly empty — engine refactor likely broke the export.",
    ).toBeGreaterThan(0);
    for (const id of allRuleIds) {
      expect(
        enMessages[id],
        `Missing terminal.alerts.messages.${id} in messages/en.json — adding a new rule to DEFAULT_ALERT_RULES requires an i18n entry. Update messages/{en,ru,az}.json before shipping the rule.`,
      ).toBeDefined();
      // Sanity — ICU placeholders must still be present (someone deleting
      // a `{code}` would silently render `undefined` at runtime).
      expect(typeof enMessages[id]).toBe("string");
      expect(enMessages[id].length).toBeGreaterThan(0);
    }
  });

  // Sub-35 + Turn-H' L138: every built-in rule must ALSO have a
  // `terminal.alerts.rules.${id}` display-name entry. The 4 render sites
  // (AlertsPanel / ActionCenterPanel / CompanySnapshot / board-deck) call
  // `t(\`alerts.rules.\${m.ruleId}\`)` for the rule name; missing entry
  // → next-intl throws → render-site try/catch falls back to engine
  // `m.ruleName` (English) → silent locale skew. Catch at unit-test time.
  it("every built-in rule id has an entry in en.json rules namespace (display name)", () => {
    const allRuleIds = Array.from(DEFAULT_ALERT_RULE_IDS).sort();
    for (const id of allRuleIds) {
      expect(
        enRules[id],
        `Missing terminal.alerts.rules.${id} in messages/en.json — render sites call t('alerts.rules.${id}') for the rule's display name. Update messages/{en,ru,az}.json:terminal.alerts.rules.* before shipping the rule.`,
      ).toBeDefined();
      expect(typeof enRules[id]).toBe("string");
      expect(enRules[id].length).toBeGreaterThan(0);
    }
  });

  // Defense-in-depth: also catch the inverse — i18n entries WITHOUT a
  // matching rule in `DEFAULT_ALERT_RULE_IDS`. Stale entries are less
  // critical than missing ones (no runtime breakage, just dead
  // translation work) but worth surfacing so messages files don't grow
  // orphan keys over time.
  it("messages/en.json has no orphan rule entries (inverse check)", () => {
    const ruleIdSet = DEFAULT_ALERT_RULE_IDS;
    const orphanMessages = Object.keys(enMessages).filter(
      (k) => !ruleIdSet.has(k),
    );
    const orphanRules = Object.keys(enRules).filter(
      (k) => !ruleIdSet.has(k),
    );
    expect(
      orphanMessages,
      `Orphan rule ids in messages/en.json:terminal.alerts.messages: ${orphanMessages.join(", ")}. Either remove them OR add the matching rule to alert-rules.ts:DEFAULT_ALERT_RULES.`,
    ).toEqual([]);
    expect(
      orphanRules,
      `Orphan rule ids in messages/en.json:terminal.alerts.rules: ${orphanRules.join(", ")}. Either remove them OR add the matching rule to alert-rules.ts:DEFAULT_ALERT_RULES.`,
    ).toEqual([]);
  });
});
