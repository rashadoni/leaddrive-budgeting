/**
 * Клиент к локальной модели по OpenAI-совместимому протоколу.
 *
 * Появился ради требования клиента не выпускать финансовые данные за периметр:
 * Ollama, llama.cpp (`--api-server`) и vLLM говорят одним диалектом, поэтому
 * один адаптер закрывает все три варианта self-hosted развёртывания.
 *
 * Форма возвращаемого объекта повторяет минимальный интерфейс клиента
 * Anthropic (`SheetClassifierAnthropicLike`) — потребители вроде классификатора
 * листов принимают его без единой правки, так что промпт и парсер остаются
 * теми же, что в проде. Это же делает сравнение моделей честным.
 */
import type { SheetClassifierAnthropicLike } from "@/lib/onboarding/ai-import/sheet-classifier"

/**
 * `response_format: json_object` просим всегда: у локальных моделей главная
 * беда — не смысловая ошибка, а сломанный JSON, и серверы чинят это
 * форсированным декодированием по схеме. Сервер, который параметр не знает,
 * просто его проигнорирует — падать на этом не нужно.
 */
export function openAiCompatibleClient(baseUrl: string, apiKey: string): SheetClassifierAnthropicLike {
  return {
    messages: {
      create: async (params) => {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: params.model,
            max_tokens: params.max_tokens,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: params.system },
              ...params.messages,
            ],
          }),
        })
        if (!res.ok) {
          throw new Error(`Локальная модель ответила ${res.status}: ${(await res.text()).slice(0, 300)}`)
        }
        const body = (await res.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        const choice = body.choices?.[0]
        return {
          // Классификатор проверяет "max_tokens" — приводим словарь OpenAI к нему.
          stop_reason: choice?.finish_reason === "length" ? "max_tokens" : "end_turn",
          content: [{ type: "text", text: choice?.message?.content ?? "" }],
          usage: {
            input_tokens: body.usage?.prompt_tokens ?? 0,
            output_tokens: body.usage?.completion_tokens ?? 0,
          },
        }
      },
    },
  }
}
