// @vitest-environment node
import { encode, getToken } from "@auth/core/jwt"
import { describe, expect, it } from "vitest"
import { sessionCookieName } from "./auth/session-cookie"

/**
 * Регрессия 2026-08-24 — «Unauthorized» на КАЖДОМ /api/* в проде.
 *
 * `/api/authcheck` (его дёргает nginx через auth_request) вызывал
 * `getToken({ req, secret })` без `cookieName`. При отсутствии `secureCookie`
 * getToken подставляет неprefixed `authjs.session-token`. После переезда прода
 * на https Auth.js выдаёт `__Secure-authjs.session-token` — имена перестали
 * совпадать, токен не находился никогда, authcheck отвечал 401, и nginx рубил
 * все запросы к API, не пуская их в приложение.
 *
 * Почему это не поймали раньше: тесты в api-auth.test.ts мокают `getToken`
 * целиком и проверяют лишь то, КАКОЕ имя вычислено, а не что токен реально
 * расшифровывается. Здесь шифрование и расшифровка настоящие.
 *
 * Маршрут не импортируем намеренно: он тянет next-auth → next/server, который
 * не резолвится в vitest. Проверяем ровно ту связку, которую он использует —
 * sessionCookieName() + getToken из @auth/core/jwt (его next-auth реэкспортит).
 */
const SECRET = "test-secret-value-at-least-32-chars-long"

function requestWith(cookie: string) {
  return { headers: new Headers({ cookie }) }
}

async function tokenFor(name: string): Promise<string> {
  return encode({ token: { sub: "user-1", authVersion: 0 }, secret: SECRET, salt: name })
}

describe("session cookie decode contract", () => {
  it.each([
    ["secure cookie (https prod)", "__Secure-authjs.session-token"],
    ["plain cookie (http dev)", "authjs.session-token"],
  ])("decodes a real token from the %s", async (_label, name) => {
    const cookie = `${name}=${await tokenFor(name)}`
    const cookieName = sessionCookieName(cookie)
    expect(cookieName).toBe(name)

    const token = await getToken({
      req: requestWith(cookie),
      secret: SECRET,
      cookieName: cookieName!,
      secureCookie: cookieName!.startsWith("__Secure-"),
    })
    expect(token?.sub).toBe("user-1")
  })

  it("fails exactly like production when the cookie name is left to the default", async () => {
    const name = "__Secure-authjs.session-token"
    const token = await getToken({
      req: requestWith(`${name}=${await tokenFor(name)}`),
      secret: SECRET,
    })
    expect(token).toBeNull()
  })

  it("ignores a stale plain cookie when the secure one is present", async () => {
    const name = "__Secure-authjs.session-token"
    const cookie = `authjs.session-token=stale; ${name}=${await tokenFor(name)}`
    const cookieName = sessionCookieName(cookie)
    expect(cookieName).toBe(name)

    const token = await getToken({
      req: requestWith(cookie),
      secret: SECRET,
      cookieName: cookieName!,
      secureCookie: true,
    })
    expect(token?.sub).toBe("user-1")
  })

  it("returns null for a request without any session cookie", () => {
    expect(sessionCookieName("other=1")).toBeNull()
  })
})
