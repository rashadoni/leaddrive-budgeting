// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { openAiCompatibleClient } from "./openai-compatible"

/**
 * Транспорт к локальной модели: важно не «что-то вернулось», а что словарь
 * OpenAI переведён в тот, на который смотрят потребители. Классификатор
 * листов проверяет `stop_reason === "max_tokens"`, чтобы отличить обрыв
 * посреди JSON от нормального ответа — если не перевести `finish_reason`,
 * обрезанный ответ проедет как валидный и разметка будет молча неполной.
 */
const PARAMS = {
  model: "qwen2.5:32b",
  max_tokens: 8192,
  system: "SYS",
  messages: [{ role: "user" as const, content: "USER" }],
}

function respond(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("openAiCompatibleClient", () => {
  it("переводит finish_reason=length в stop_reason=max_tokens", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        choices: [{ message: { content: "{\"partial\":" }, finish_reason: "length" }],
        usage: { prompt_tokens: 11, completion_tokens: 22 },
      }),
    )
    const res = await openAiCompatibleClient("http://box:11434/v1", "k").messages.create(PARAMS)
    expect(res.stop_reason).toBe("max_tokens")
    expect(res.usage).toEqual({ input_tokens: 11, output_tokens: 22 })
  })

  it("нормальный ответ отдаёт текстом в форме Anthropic", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        choices: [{ message: { content: '{"sheets":[]}' }, finish_reason: "stop" }],
      }),
    )
    const res = await openAiCompatibleClient("http://box:11434/v1", "k").messages.create(PARAMS)
    expect(res.stop_reason).toBe("end_turn")
    expect(res.content).toEqual([{ type: "text", text: '{"sheets":[]}' }])
  })

  it("шлёт system отдельным сообщением и просит JSON", async () => {
    const fetchMock = respond({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] })
    vi.stubGlobal("fetch", fetchMock)
    await openAiCompatibleClient("http://box:11434/v1/", "secret").messages.create(PARAMS)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://box:11434/v1/chat/completions") // хвостовой слэш не задваивается
    const sent = JSON.parse(String(init.body))
    expect(sent.messages[0]).toEqual({ role: "system", content: "SYS" })
    expect(sent.messages[1]).toEqual({ role: "user", content: "USER" })
    expect(sent.response_format).toEqual({ type: "json_object" })
    expect(sent.temperature).toBe(0)
  })

  it("на ошибку сервера бросает исключение, а не отдаёт пустой ответ", async () => {
    vi.stubGlobal("fetch", respond({ error: "model not found" }, false, 404))
    await expect(
      openAiCompatibleClient("http://box:11434/v1", "k").messages.create(PARAMS),
    ).rejects.toThrow(/404/)
  })

  it("пустой content не роняет адаптер — вернётся пустая строка", async () => {
    vi.stubGlobal("fetch", respond({ choices: [{ finish_reason: "stop" }] }))
    const res = await openAiCompatibleClient("http://box:11434/v1", "k").messages.create(PARAMS)
    expect(res.content).toEqual([{ type: "text", text: "" }])
  })
})
