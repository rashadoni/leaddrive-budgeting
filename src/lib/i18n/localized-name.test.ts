/**
 * 11.53 — an Azerbaijani page must not answer in Russian.
 *
 * The AI Import preview hardcoded `nameRu ?? nameEn`, so every indicator on
 * the flagship demo screen rendered in Russian regardless of the page
 * language. `nameAz` was already seeded and already on the wire.
 */
import { describe, it, expect } from "vitest"
import { localizedName } from "./localized-name"

const FULL = {
  nameEn: "Food Processing Gross Margin",
  nameAz: "Qida Emalı Ümumi Marja",
  nameRu: "Валовая маржа пищепрома",
}

describe("localizedName", () => {
  it("gives an Azerbaijani reader the Azerbaijani name", () => {
    // The regression: this used to return the Russian string.
    expect(localizedName("az", FULL)).toBe("Qida Emalı Ümumi Marja")
  })

  it("gives ru and en readers their own", () => {
    expect(localizedName("ru", FULL)).toBe("Валовая маржа пищепрома")
    expect(localizedName("en", FULL)).toBe("Food Processing Gross Margin")
  })

  it("falls back to ENGLISH when the translation is missing — never to the other language", () => {
    // Showing Russian to an Azerbaijani reader is the whole defect; English
    // is a gap, Russian is a wrong answer.
    const noAz = { ...FULL, nameAz: null }
    expect(localizedName("az", noAz)).toBe("Food Processing Gross Margin")
    const noRu = { ...FULL, nameRu: "" }
    expect(localizedName("ru", noRu)).toBe("Food Processing Gross Margin")
  })

  it("treats an unknown locale as English rather than guessing", () => {
    expect(localizedName("tr", FULL)).toBe("Food Processing Gross Margin")
  })

  it("never renders an empty label — falls back to the code", () => {
    // An empty chip is unreadable; the code at least identifies the row.
    expect(localizedName("az", { nameEn: null }, "FP_GROSS_MARGIN")).toBe(
      "FP_GROSS_MARGIN",
    )
    expect(localizedName("az", { nameEn: "   ", nameAz: "  " }, "X")).toBe("X")
  })
})
