/**
 * Точная причина AI-сбоя — ТОЛЬКО администратору.
 *
 * Панели терминала намеренно показывают всем нейтральное «AI временно
 * недоступен»: сырую ошибку провайдера показывать нельзя (см. шапку
 * src/lib/ai/ai-error.ts — она содержит биллинговый текст вида «credit balance
 * is too low … Plans & Billing», и корпоративному пользователю его видеть не
 * нужно). Но администратору нейтральная фраза бесполезна: 2026-08-24 владелец
 * потратил время на разбор «почему AI не работает», хотя сервер уже знал ответ
 * — на счёте Anthropic кончились средства (код ai_credits в логах).
 *
 * Поэтому: текст для всех прежний, а админ дополнительно видит причину и
 * действие. Роль берётся из сессии там же, где её уже берут другие панели.
 */
export const AI_OUTAGE_CODES = [
  "ai_credits",
  "ai_rate_limit",
  "ai_unavailable",
  "ai_bad_response",
] as const

export type AiOutageCode = (typeof AI_OUTAGE_CODES)[number]

export function isAiOutageCode(code: string | null | undefined): code is AiOutageCode {
  return typeof code === "string" && (AI_OUTAGE_CODES as readonly string[]).includes(code)
}

/**
 * Ключ перевода с точной причиной, либо null — когда подсказку показывать не
 * нужно (не админ, или код не про сбой провайдера).
 */
export function aiOutageHintKey(
  code: string | null | undefined,
  isAdmin: boolean,
): `aiOutageAdmin.${AiOutageCode}` | null {
  if (!isAdmin || !isAiOutageCode(code)) return null
  return `aiOutageAdmin.${code}`
}
