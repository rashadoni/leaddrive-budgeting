// @vitest-environment happy-dom
/**
 * Phase 7.G Turn LIII — NarrativeLanguagePicker tests.
 *
 * Locks: 3 buttons render (EN/RU/AZ), active language reflected via
 * aria-pressed + lavender styling, click pushes the new ?lang= query
 * while preserving other params (?period= etc.) and dropping
 * ?regenerate=, no-op when clicking the active language.
 */

import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NarrativeLanguagePicker } from "./NarrativeLanguagePicker";

const pushMock = vi.fn();
let searchParamsState = "";
const pathnameState = "/budgeting/board-deck";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(searchParamsState),
  usePathname: () => pathnameState,
}));

beforeEach(() => {
  pushMock.mockReset();
  searchParamsState = "";
});

afterEach(() => {
  cleanup();
});

describe("NarrativeLanguagePicker — render", () => {
  it("renders 3 buttons (en/ru/az) with mono uppercase labels", () => {
    render(<NarrativeLanguagePicker currentLanguage="en" />);
    const group = screen.getByTestId("narrative-language-picker");
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Narrative language");
    const en = screen.getByTestId("narrative-lang-en");
    const ru = screen.getByTestId("narrative-lang-ru");
    const az = screen.getByTestId("narrative-lang-az");
    expect(en.textContent?.toLowerCase()).toBe("en");
    expect(ru.textContent?.toLowerCase()).toBe("ru");
    expect(az.textContent?.toLowerCase()).toBe("az");
  });

  it("marks the current language with aria-pressed + lavender accent", () => {
    render(<NarrativeLanguagePicker currentLanguage="ru" />);
    expect(
      screen.getByTestId("narrative-lang-en").getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByTestId("narrative-lang-ru").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId("narrative-lang-az").getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByTestId("narrative-lang-ru").className).toContain(
      "7D55C7",
    );
  });
});

describe("NarrativeLanguagePicker — switch", () => {
  it("clicking a different language pushes ?lang=<new>", () => {
    render(<NarrativeLanguagePicker currentLanguage="en" />);
    fireEvent.click(screen.getByTestId("narrative-lang-ru"));
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0]).toBe(
      "/budgeting/board-deck?lang=ru",
    );
  });

  it("preserves existing query params (e.g. ?period=2025) when switching", () => {
    searchParamsState = "period=2025";
    render(<NarrativeLanguagePicker currentLanguage="en" />);
    fireEvent.click(screen.getByTestId("narrative-lang-az"));
    const url = pushMock.mock.calls[0][0];
    expect(url).toContain("period=2025");
    expect(url).toContain("lang=az");
  });

  it("drops ?regenerate= on language switch (cache-hit path expected)", () => {
    searchParamsState = "period=2025&regenerate=1";
    render(<NarrativeLanguagePicker currentLanguage="en" />);
    fireEvent.click(screen.getByTestId("narrative-lang-ru"));
    const url = pushMock.mock.calls[0][0];
    expect(url).toContain("period=2025");
    expect(url).toContain("lang=ru");
    expect(url).not.toContain("regenerate");
  });

  it("clicking the active language is a no-op", () => {
    render(<NarrativeLanguagePicker currentLanguage="ru" />);
    fireEvent.click(screen.getByTestId("narrative-lang-ru"));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("overrides an existing ?lang= rather than appending", () => {
    searchParamsState = "lang=ru&period=2025";
    render(<NarrativeLanguagePicker currentLanguage="ru" />);
    fireEvent.click(screen.getByTestId("narrative-lang-en"));
    const url = pushMock.mock.calls[0][0];
    // Single lang= param, value is en
    const matches = url.match(/lang=/g);
    expect(matches).toHaveLength(1);
    expect(url).toContain("lang=en");
  });
});
