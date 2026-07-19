/**
 * Focus the search surface for the current Expert panel.
 *
 * Panels 1 and 2 own local search inputs. Panels 3 and 4 do not, so the
 * documented slash shortcut falls back to the global command bar instead of
 * becoming a silent no-op.
 */
export function focusTerminalSearch(activePanelId: number): void {
  if (activePanelId === 1 || activePanelId === 2) {
    window.dispatchEvent(
      new CustomEvent("terminal:focus-search", {
        detail: { panelId: activePanelId },
      }),
    );
    return;
  }

  const commandBar = document.querySelector<HTMLElement>("[data-cmd-bar=\"true\"]");
  commandBar?.focus();
}
