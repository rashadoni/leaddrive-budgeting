import { describe, expect, it } from "vitest"

import azMessages from "../../../../messages/az.json"
import enMessages from "../../../../messages/en.json"
import ruMessages from "../../../../messages/ru.json"

type TerminalMessages = {
  terminal: {
    hotkeys: { whatif: string }
    relatedFunctions: { whatif: string }
  }
}

const locales = {
  az: azMessages,
  en: enMessages,
  ru: ruMessages,
} satisfies Record<string, TerminalMessages>

describe("terminal What-if label i18n", () => {
  it.each(Object.entries(locales))(
    "uses the product label consistently in %s",
    (_locale, messages) => {
      expect(messages.terminal.hotkeys.whatif).toBe("What-if")
      expect(messages.terminal.relatedFunctions.whatif).toBe("What-if")
    },
  )
})
