import { describe, expect, it } from "vitest"
import {
  buildMapperUserMessage,
  MAPPER_PROMPT_VERSION,
  MAPPER_SYSTEM_PROMPT,
} from "./mapper-system"

describe("AI mapper FX-evidence prompt contract", () => {
  it("permits all evidence roles and forbids rate guessing", () => {
    expect(MAPPER_SYSTEM_PROMPT).toContain("sourceAmount:<Month>")
    expect(MAPPER_SYSTEM_PROMPT).toContain("role `currency`")
    expect(MAPPER_SYSTEM_PROMPT).toContain("role `exchangeRate`")
    expect(MAPPER_SYSTEM_PROMPT).toContain("NEVER `skip`")
    expect(MAPPER_SYSTEM_PROMPT).toContain("Never infer, fill, look up, average, or invent a rate")
    expect(MAPPER_SYSTEM_PROMPT).toContain("still map every observed currency/source/rate column")
    expect(MAPPER_SYSTEM_PROMPT).toContain("CRITICAL `currency_mix`")
  })

  it("advertises the evidence roles in the strict JSON shape and hashes the changed prompt", () => {
    const message = buildMapperUserMessage("sheet columns")
    expect(message).toContain("currency|exchangeRate|amount:Jan|sourceAmount:Jan")
    expect(message).toContain("amount/sourceAmount header explicitly identifies its ISO currency")
    expect(MAPPER_PROMPT_VERSION).toMatch(/^v[0-9a-f]{8}$/)
  })
})
