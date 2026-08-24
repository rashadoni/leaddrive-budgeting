/**
 * Имя сессионной куки Auth.js вычисляем ИЗ ЗАПРОСА.
 *
 * Под https Auth.js выдаёт `__Secure-authjs.session-token`, под http —
 * `authjs.session-token`. `getToken()` без явного `cookieName` подставляет
 * НЕprefixed имя, поэтому на https-проде он не находил куку никогда: так
 * /api/authcheck начал отвечать 401 на каждый запрос, а nginx (auth_request)
 * рубил из-за этого весь /api/*.
 *
 * Модуль намеренно не тянет next-auth: его импортируют и серверные хелперы,
 * и route-handler, и юнит-тест настоящего roundtrip'а.
 */
const SECURE_NAME = "__Secure-authjs.session-token"
const PLAIN_NAME = "authjs.session-token"

export function sessionCookieName(cookieHeader: string): string | null {
  const names = cookieHeader.split(";").map((part) => part.trim().split("=", 1)[0])
  // Чанкованные куки Auth.js получают суффикс `.0`, `.1`, … — их база та же.
  if (names.some((name) => name === SECURE_NAME || name.startsWith(`${SECURE_NAME}.`))) {
    return SECURE_NAME
  }
  if (names.some((name) => name === PLAIN_NAME || name.startsWith(`${PLAIN_NAME}.`))) {
    return PLAIN_NAME
  }
  return null
}

export function isSecureCookieName(cookieName: string): boolean {
  return cookieName.startsWith("__Secure-")
}
