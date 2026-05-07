// @vitest-environment happy-dom
/**
 * Phase 7.G Turn LI (Board Deck v2 Turn 4) — TopAlertsSection tests.
 *
 * Locks: critical-first selection, warning + info fallback, limit
 * cap, "showing of total" footnote when truncated, "all clear"
 * empty-state pane, severity-dot color, affectedCount footnote.
 */

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { AlertMatch, AlertSeverity } from "@/lib/risk/alert-rules";
import { TopAlertsSection } from "./TopAlertsSection";

afterEach(() => {
  cleanup();
});

function makeMatch(
  overrides: Partial<AlertMatch> & { ruleId: string; severity: AlertSeverity },
): AlertMatch {
  return {
    ruleName: overrides.ruleId,
    message: `${overrides.ruleId} message`,
    messageKey: "",
    messageParams: {},
    affectedCompanyIds: [],
    ...overrides,
  };
}

function makeMatches(
  byCount: { critical?: number; warning?: number; info?: number } = {},
): Record<AlertSeverity, AlertMatch[]> {
  return {
    critical: Array.from({ length: byCount.critical ?? 0 }, (_, i) =>
      makeMatch({ ruleId: `crit-${i}`, severity: "critical" }),
    ),
    warning: Array.from({ length: byCount.warning ?? 0 }, (_, i) =>
      makeMatch({ ruleId: `warn-${i}`, severity: "warning" }),
    ),
    info: Array.from({ length: byCount.info ?? 0 }, (_, i) =>
      makeMatch({ ruleId: `info-${i}`, severity: "info" }),
    ),
  };
}

async function renderSection(
  matchesBySeverity: Record<AlertSeverity, AlertMatch[]>,
  limit = 3,
) {
  const tree = await TopAlertsSection({ matchesBySeverity, limit });
  render(tree as React.ReactElement);
}

describe("TopAlertsSection — selection", () => {
  it("renders critical alerts first up to limit", async () => {
    await renderSection(makeMatches({ critical: 5, warning: 5, info: 5 }), 3);
    const items = screen
      .getByTestId("top-alerts-list")
      .querySelectorAll("li");
    expect(items).toHaveLength(3);
    items.forEach((item, i) => {
      expect(item.textContent).toContain(`crit-${i}`);
    });
  });

  it("falls back to warning when no critical", async () => {
    await renderSection(makeMatches({ critical: 0, warning: 4, info: 4 }), 3);
    const items = screen
      .getByTestId("top-alerts-list")
      .querySelectorAll("li");
    expect(items).toHaveLength(3);
    items.forEach((item, i) => {
      expect(item.textContent).toContain(`warn-${i}`);
    });
  });

  it("falls back to info when no critical or warning", async () => {
    await renderSection(makeMatches({ info: 4 }), 3);
    const items = screen
      .getByTestId("top-alerts-list")
      .querySelectorAll("li");
    expect(items).toHaveLength(3);
    items.forEach((item, i) => {
      expect(item.textContent).toContain(`info-${i}`);
    });
  });

  it("mixes severities when one bucket is short", async () => {
    await renderSection(makeMatches({ critical: 1, warning: 2 }), 3);
    const items = screen
      .getByTestId("top-alerts-list")
      .querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("crit-0");
    expect(items[1].textContent).toContain("warn-0");
    expect(items[2].textContent).toContain("warn-1");
  });
});

describe("TopAlertsSection — truncation footnote", () => {
  it("shows 'showing N of M' when truncated", async () => {
    await renderSection(makeMatches({ critical: 5 }), 3);
    const section = screen.getByTestId("board-deck-top-alerts");
    expect(section.textContent).toContain("Showing 3 of 5");
  });

  it("does NOT show truncation footnote when limit covers all", async () => {
    await renderSection(makeMatches({ critical: 2 }), 3);
    const section = screen.getByTestId("board-deck-top-alerts");
    expect(section.textContent).not.toContain("Showing");
  });
});

describe("TopAlertsSection — all-clear empty state", () => {
  it("renders 'all clear' message when zero alerts", async () => {
    await renderSection(makeMatches({}), 3);
    const empty = screen.getByTestId("top-alerts-empty");
    expect(empty.textContent).toContain("✓");
    expect(empty.textContent).toContain("all systems green");
    // No alerts list when empty.
    expect(screen.queryByTestId("top-alerts-list")).toBeNull();
  });
});

describe("TopAlertsSection — band pill + view-all link", () => {
  it("renders a severity band pill per alert (critical → red palette)", async () => {
    await renderSection(makeMatches({ critical: 1 }), 3);
    const pill = screen.getByTestId("top-alert-0-band");
    expect(pill.textContent).toBeTruthy();
    expect(pill.className).toContain("FF4757"); // red palette
  });

  it("renders 'View all alerts' link to /budgeting/terminal", async () => {
    await renderSection(makeMatches({ critical: 1 }), 3);
    const link = screen.getByTestId("top-alerts-view-all");
    expect(link.getAttribute("href")).toBe("/budgeting/terminal");
    expect(link.textContent).toContain("View all alerts");
  });

  it("does NOT render 'View all alerts' link in the all-clear empty state", async () => {
    await renderSection(makeMatches({}), 3);
    expect(screen.queryByTestId("top-alerts-view-all")).toBeNull();
  });
});

describe("TopAlertsSection — severity dot + affected count", () => {
  it("renders affected-count footnote when affectedCompanyIds non-empty", async () => {
    const matches = makeMatches({ critical: 1 });
    matches.critical[0].affectedCompanyIds = [
      "co_1",
      "co_2",
      "co_3",
    ] as readonly string[];
    await renderSection(matches, 3);
    const item = screen.getByTestId("top-alert-0");
    // EXPLICIT_LABELS template renders "{count} affected sub-cos".
    expect(item.textContent).toContain("3");
    expect(item.textContent).toContain("affected");
  });

  it("omits affected-count footnote when affectedCompanyIds is empty", async () => {
    await renderSection(makeMatches({ critical: 1 }), 3);
    const item = screen.getByTestId("top-alert-0");
    expect(item.textContent).not.toContain("affected");
  });
});
