// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { focusTerminalSearch } from "./focus-terminal-search";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("focusTerminalSearch", () => {
  it.each([1, 2])("routes panel %i to its local search listener", (panelId) => {
    const listener = vi.fn();
    window.addEventListener("terminal:focus-search", listener);

    focusTerminalSearch(panelId);

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ panelId });
    window.removeEventListener("terminal:focus-search", listener);
  });

  it.each([3, 4])("falls back from panel %i to the global command bar", (panelId) => {
    const input = document.createElement("input");
    input.setAttribute("data-cmd-bar", "true");
    document.body.append(input);

    focusTerminalSearch(panelId);

    expect(document.activeElement).toBe(input);
  });
});
