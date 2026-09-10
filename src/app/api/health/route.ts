/**
 * GET /api/health — публичная проверка живости для деплоя и Cloud Run.
 *
 * Отвечает на два вопроса, и оба нужны именно во время выкатки:
 *
 *   1. Поднялось ли приложение и достаёт ли до базы. Без второго «200» значит
 *      только «процесс стартовал» — а приложение без базы бесполезно, и
 *      выкатывать его на трафик нельзя.
 *   2. КАКОЙ код отвечает. `revision` — это APP_REVISION, который деплой
 *      проставляет из SHA релиза. Без него «здоров» подтверждает лишь то, что
 *      что-то живо, а не то, что живо новое: старая ревизия отвечает 200
 *      ровно так же, и неудавшееся переключение трафика выглядит успехом.
 *
 * Публичный по необходимости: Cloud Run дёргает его без сессии, поэтому путь
 * добавлен в publicPaths в `src/proxy.ts`. Наружу уходит только «да/нет» и
 * SHA коммита — ни имён, ни счётчиков, ни строки подключения.
 */

import { NextResponse } from "next/server"
import { prismaAdmin } from "@/lib/db/prisma-admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const revision = process.env.APP_REVISION ?? "unknown"

  try {
    // Самый дешёвый вопрос, который всё же требует настоящего соединения.
    await prismaAdmin.$queryRaw`SELECT 1`
  } catch {
    // Причину наружу не выносим: строка ошибки Prisma умеет содержать хост и
    // имя пользователя. Для выкатки достаточно «база недоступна».
    return NextResponse.json(
      { ok: false, revision, db: "down" },
      { status: 503, headers: { "cache-control": "no-store" } },
    )
  }

  return NextResponse.json(
    { ok: true, revision, db: "up" },
    { status: 200, headers: { "cache-control": "no-store" } },
  )
}
