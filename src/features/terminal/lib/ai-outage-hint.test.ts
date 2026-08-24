import { describe, expect, it } from "vitest"
import { aiOutageHintKey, isAiOutageCode } from "./ai-outage-hint"

/**
 * 2026-08-24: в терминале AI-панель показывала «AI временно недоступен», хотя
 * сервер уже знал точную причину (ai_credits — кончились средства на счёте
 * Anthropic). Владелец потратил время на разбор того, что приложение могло
 * сказать сразу. Нейтральный текст оставлен всем, точная причина — админу.
 */
describe("aiOutageHintKey", () => {
  it.each(["ai_credits", "ai_rate_limit", "ai_unavailable", "ai_bad_response"])(
    "returns the %s hint for an admin",
    (code) => {
      expect(aiOutageHintKey(code, true)).toBe(`aiOutageAdmin.${code}`)
    },
  )

  it("stays silent for non-admins — the provider's billing state is not their business", () => {
    expect(aiOutageHintKey("ai_credits", false)).toBeNull()
  })

  it("stays silent for codes that are not provider outages", () => {
    expect(aiOutageHintKey("STATUS_NOT_EXPLAINABLE", true)).toBeNull()
    expect(aiOutageHintKey(null, true)).toBeNull()
    expect(aiOutageHintKey(undefined, true)).toBeNull()
  })

  it("does not accept near-miss codes", () => {
    expect(isAiOutageCode("ai_credits ")).toBe(false)
    expect(isAiOutageCode("credits")).toBe(false)
  })
})
