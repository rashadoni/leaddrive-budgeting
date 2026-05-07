// @vitest-environment happy-dom
/**
 * Phase 7.G Turn XLIX (Board Deck v2 Turn 3) — MetricCard tests.
 *
 * Locks: label/value/context render, optional delta + tone color,
 * accent left-bar color, default testId, child render.
 */

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MetricCard } from "./MetricCard";

afterEach(() => {
  cleanup();
});

describe("MetricCard — basic render", () => {
  it("renders label + value", () => {
    render(<MetricCard label="Red cells" value="18" />);
    const card = screen.getByTestId("metric-card");
    expect(card.textContent).toContain("Red cells");
    expect(screen.getByTestId("metric-card-value").textContent).toBe("18");
  });

  it("renders the optional context line below the value", () => {
    render(
      <MetricCard label="X" value="12" context="of 7 sub-cos scored" />,
    );
    expect(screen.getByTestId("metric-card").textContent).toContain(
      "of 7 sub-cos scored",
    );
  });

  it("respects a custom testId", () => {
    render(
      <MetricCard label="X" value="1" testId="custom-card" />,
    );
    expect(screen.getByTestId("custom-card")).toBeTruthy();
    expect(screen.getByTestId("custom-card-value")).toBeTruthy();
  });

  it("renders children at the end of the card body", () => {
    render(
      <MetricCard label="X" value="1">
        <span data-testid="child-content">extra</span>
      </MetricCard>,
    );
    expect(screen.getByTestId("child-content")).toBeTruthy();
  });
});

describe("MetricCard — delta", () => {
  it("renders delta line when tone is non-null", () => {
    render(
      <MetricCard
        label="X"
        value="1"
        delta={{ label: "+3 vs Q3", tone: "improving" }}
      />,
    );
    const delta = screen.getByTestId("metric-card-delta");
    expect(delta.textContent).toBe("+3 vs Q3");
    expect(delta.className).toContain("00D4AA"); // green tone
  });

  it("uses the worsening tone color for losses", () => {
    render(
      <MetricCard
        label="X"
        value="1"
        delta={{ label: "-5 vs Q3", tone: "worsening" }}
      />,
    );
    const delta = screen.getByTestId("metric-card-delta");
    expect(delta.className).toContain("FF4757"); // red tone
  });

  it("suppresses delta when tone is null", () => {
    render(
      <MetricCard
        label="X"
        value="1"
        delta={{ label: "—", tone: null }}
      />,
    );
    expect(screen.queryByTestId("metric-card-delta")).toBeNull();
  });

  it("suppresses delta when delta prop is omitted", () => {
    render(<MetricCard label="X" value="1" />);
    expect(screen.queryByTestId("metric-card-delta")).toBeNull();
  });
});

describe("MetricCard — accent bar", () => {
  it("renders accent bar when accent prop is set", () => {
    render(<MetricCard label="X" value="1" accent="red" />);
    const card = screen.getByTestId("metric-card");
    const accentBar = card.querySelector("span[aria-hidden='true']");
    expect(accentBar).toBeTruthy();
    expect(accentBar?.className).toContain("FF4757"); // red bg
  });

  it("does NOT render accent bar when accent is null", () => {
    render(<MetricCard label="X" value="1" accent={null} />);
    const card = screen.getByTestId("metric-card");
    const accentBar = card.querySelector("span[aria-hidden='true']");
    expect(accentBar).toBeNull();
  });

  it("does NOT render accent bar when accent is omitted", () => {
    render(<MetricCard label="X" value="1" />);
    const card = screen.getByTestId("metric-card");
    const accentBar = card.querySelector("span[aria-hidden='true']");
    expect(accentBar).toBeNull();
  });
});
