import { describe, it, expect } from "vitest"
import {
  parseCommand,
  panelForCommand,
  FUNCTION_CODES,
  type ParsedCommand,
} from "./command-parser"

describe("parseCommand — empty / missing GO", () => {
  it("rejects empty input", () => {
    expect(parseCommand("")).toMatchObject({
      ok: false,
      error: { code: "empty" },
    })
  })

  it("rejects whitespace-only input", () => {
    expect(parseCommand("   \t  ")).toMatchObject({
      ok: false,
      error: { code: "empty" },
    })
  })

  it("rejects command without GO terminator", () => {
    expect(parseCommand("AAC CO")).toMatchObject({
      ok: false,
      error: { code: "missing_go" },
    })
  })

  it("rejects bare GO with no function", () => {
    expect(parseCommand("GO")).toMatchObject({
      ok: false,
      error: { code: "missing_go" },
    })
  })
})

describe("parseCommand — HOLD (forbidden target)", () => {
  it("accepts `HOLD GO`", () => {
    expect(parseCommand("HOLD GO")).toEqual({
      ok: true,
      command: { kind: "hold" },
    })
  })

  it("rejects `AAC HOLD GO` (target on forbidden-target verb)", () => {
    expect(parseCommand("AAC HOLD GO")).toMatchObject({
      ok: false,
      error: { code: "unexpected_target" },
    })
  })

  it("uppercases lowercase input", () => {
    expect(parseCommand("hold go")).toEqual({
      ok: true,
      command: { kind: "hold" },
    })
  })
})

describe("parseCommand — CO / IND / SEC / SCN (required target)", () => {
  it("accepts `AAC CO GO`", () => {
    expect(parseCommand("AAC CO GO")).toEqual({
      ok: true,
      command: { kind: "co", companyCode: "AAC" },
    })
  })

  it("accepts hyphenated company codes (`ATL-DBZ CO GO`)", () => {
    expect(parseCommand("ATL-DBZ CO GO")).toEqual({
      ok: true,
      command: { kind: "co", companyCode: "ATL-DBZ" },
    })
  })

  it("rejects `CO GO` (missing target)", () => {
    expect(parseCommand("CO GO")).toMatchObject({
      ok: false,
      error: { code: "missing_target" },
    })
  })

  it("accepts `IND_OPEX_RATIO IND GO`", () => {
    expect(parseCommand("IND_OPEX_RATIO IND GO")).toEqual({
      ok: true,
      command: { kind: "ind", indicatorCode: "IND_OPEX_RATIO" },
    })
  })

  it("accepts `HOSPITALITY SEC GO`", () => {
    expect(parseCommand("HOSPITALITY SEC GO")).toEqual({
      ok: true,
      command: { kind: "sec", sector: "HOSPITALITY" },
    })
  })

  it("accepts `BASE SCN GO`", () => {
    expect(parseCommand("BASE SCN GO")).toEqual({
      ok: true,
      command: { kind: "scn", scenarioCode: "BASE" },
    })
  })
})

describe("parseCommand — GRP (optional target)", () => {
  it("accepts `GRP GO` without target", () => {
    expect(parseCommand("GRP GO")).toEqual({
      ok: true,
      command: { kind: "grp", subgroupCode: null },
    })
  })

  it("accepts `AZMADE GRP GO` with target", () => {
    expect(parseCommand("AZMADE GRP GO")).toEqual({
      ok: true,
      command: { kind: "grp", subgroupCode: "AZMADE" },
    })
  })
})

describe("parseCommand — CMP (exactly two targets)", () => {
  it("accepts comma syntax `AAC,LLS CMP GO`", () => {
    expect(parseCommand("AAC,LLS CMP GO")).toEqual({
      ok: true,
      command: { kind: "cmp", left: "AAC", right: "LLS" },
    })
  })

  it("accepts two-token syntax `AAC LLS CMP GO`", () => {
    expect(parseCommand("AAC LLS CMP GO")).toEqual({
      ok: true,
      command: { kind: "cmp", left: "AAC", right: "LLS" },
    })
  })

  it("rejects single target `AAC CMP GO`", () => {
    expect(parseCommand("AAC CMP GO")).toMatchObject({
      ok: false,
      error: { code: "cmp_requires_two_targets" },
    })
  })

  it("rejects three targets `AAC,LLS,SPARK CMP GO`", () => {
    expect(parseCommand("AAC,LLS,SPARK CMP GO")).toMatchObject({
      ok: false,
      error: { code: "cmp_requires_two_targets" },
    })
  })

  it("rejects no targets `CMP GO`", () => {
    expect(parseCommand("CMP GO")).toMatchObject({
      // missing_target fires before cmp_requires_two_targets — both are
      // legitimate; we just want a deterministic error code.
      ok: false,
      error: { code: "missing_target" },
    })
  })
})

describe("parseCommand — ALT / BRF (forbidden target)", () => {
  it("accepts `ALT GO`", () => {
    expect(parseCommand("ALT GO")).toEqual({
      ok: true,
      command: { kind: "alt" },
    })
  })

  it("rejects `AAC ALT GO`", () => {
    expect(parseCommand("AAC ALT GO")).toMatchObject({
      ok: false,
      error: { code: "unexpected_target" },
    })
  })

  it("accepts `BRF GO`", () => {
    expect(parseCommand("BRF GO")).toEqual({
      ok: true,
      command: { kind: "brf" },
    })
  })
})

describe("parseCommand — unknown function", () => {
  it("rejects bogus verb", () => {
    expect(parseCommand("AAC ZZZ GO")).toMatchObject({
      ok: false,
      error: { code: "unknown_function" },
    })
  })

  it("rejects HEAT (deprecated verb)", () => {
    expect(parseCommand("HEAT GO")).toMatchObject({
      ok: false,
      error: { code: "unknown_function" },
    })
  })
})

describe("parseCommand — too many tokens", () => {
  it("rejects `AAC EXTRA CO GO` (extra target on non-CMP verb)", () => {
    expect(parseCommand("AAC EXTRA CO GO")).toMatchObject({
      ok: false,
      error: { code: "too_many_tokens" },
    })
  })
})

describe("AUD verb (Phase 7.F audit log overlay)", () => {
  it("`AUD GO` parses to `{kind: aud}`", () => {
    expect(parseCommand("AUD GO")).toEqual({
      ok: true,
      command: { kind: "aud" },
    })
  })

  it("`AAC AUD GO` rejects (target forbidden — global overlay)", () => {
    expect(parseCommand("AAC AUD GO")).toMatchObject({
      ok: false,
      error: { code: "unexpected_target" },
    })
  })

  it("AUD lower-case input is accepted (case-insensitive tokenizer)", () => {
    expect(parseCommand("aud go")).toEqual({
      ok: true,
      command: { kind: "aud" },
    })
  })
})

describe("INT verb (Phase 7.G D.4 IntelFeedPanel)", () => {
  it("`INT GO` parses to `{kind: int}`", () => {
    expect(parseCommand("INT GO")).toEqual({
      ok: true,
      command: { kind: "int" },
    })
  })

  it("`AAC INT GO` rejects (target forbidden — org-scoped global feed)", () => {
    expect(parseCommand("AAC INT GO")).toMatchObject({
      ok: false,
      error: { code: "unexpected_target" },
    })
  })
})

describe("BREACH verb (Phase 7.G Turn CI E.2d UI BreachForecastPanel)", () => {
  it("`BREACH GO` parses to `{kind: breach}`", () => {
    expect(parseCommand("BREACH GO")).toEqual({
      ok: true,
      command: { kind: "breach" },
    })
  })

  it("lowercase + mixed case parses (case-insensitive)", () => {
    expect(parseCommand("breach go")).toEqual({
      ok: true,
      command: { kind: "breach" },
    })
  })

  it("`AAC BREACH GO` rejects (target forbidden — org-scoped global panel)", () => {
    expect(parseCommand("AAC BREACH GO")).toMatchObject({
      ok: false,
      error: { code: "unexpected_target" },
    })
  })
})

describe("panelForCommand routing", () => {
  it.each([
    [{ kind: "hold" } as ParsedCommand, 2],
    [{ kind: "grp", subgroupCode: null } as ParsedCommand, 2],
    [{ kind: "sec", sector: "HOSPITALITY" } as ParsedCommand, 2],
    [{ kind: "cmp", left: "AAC", right: "LLS" } as ParsedCommand, 2],
    [{ kind: "co", companyCode: "AAC" } as ParsedCommand, 1],
    [{ kind: "ind", indicatorCode: "IND_OPEX_RATIO" } as ParsedCommand, 3],
    [{ kind: "scn", scenarioCode: "BASE" } as ParsedCommand, 4],
    [{ kind: "alt" } as ParsedCommand, 4],
    [{ kind: "brf" } as ParsedCommand, 4],
  ])("routes %s to panel %i", (cmd, expected) => {
    expect(panelForCommand(cmd)).toBe(expected)
  })

  it("`aud` returns null (modal overlay, not a panel)", () => {
    expect(panelForCommand({ kind: "aud" })).toBeNull()
  })
})

describe("FUNCTION_CODES catalog", () => {
  // Phase 7.I added 4 agro/sugar pop-out verbs: AGRO, WX, PRICE, KPI.
  it("exports exactly 22 reserved function codes (18 base + 4 Phase 7.I agro pop-outs)", () => {
    expect(FUNCTION_CODES).toHaveLength(22)
  })

  it("each panel-targeting function code has a panel route", () => {
    const sample: Record<string, ParsedCommand> = {
      HOLD: { kind: "hold" },
      GRP: { kind: "grp", subgroupCode: null },
      CO: { kind: "co", companyCode: "X" },
      IND: { kind: "ind", indicatorCode: "X" },
      SEC: { kind: "sec", sector: "X" },
      CMP: { kind: "cmp", left: "A", right: "B" },
      ALT: { kind: "alt" },
      SCN: { kind: "scn", scenarioCode: "X" },
      BRF: { kind: "brf" },
      AUD: { kind: "aud" },
      ACT: { kind: "act" },
      CMT: { kind: "cmt" },
      CHT: { kind: "cht" },
      SUB: { kind: "sub" },
      INT: { kind: "int" },
      BREACH: { kind: "breach" },
      HELP: { kind: "help" },
      PEER: { kind: "peer", codes: ["A", "B"] },
      // Phase 7.I — sector-aware widget pop-outs. All four are
      // overlay/pop-out modals — do not steal panel focus.
      AGRO: { kind: "agro" },
      WX: { kind: "wx" },
      PRICE: { kind: "price" },
      KPI: { kind: "kpi" },
    }
    const OVERLAY_MODALS = new Set([
      "AUD", "ACT", "CMT", "CHT", "SUB", "INT", "BREACH", "HELP", "PEER",
      "AGRO", "WX", "PRICE", "KPI",
    ])
    for (const code of FUNCTION_CODES) {
      const route = panelForCommand(sample[code])
      // Overlay modals intentionally return null (do not steal panel focus);
      // every other code routes to one of the 4 panels.
      if (OVERLAY_MODALS.has(code)) {
        expect(route).toBeNull()
      } else {
        expect([1, 2, 3, 4]).toContain(route)
      }
    }
  })
})
