import { NextResponse } from "next/server"
import { prismaAdmin } from "@/lib/db/prisma-admin"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await prismaAdmin.$queryRawUnsafe("SELECT 1")
    return NextResponse.json(
      {
        status: "ok",
        service: "budgetpro",
        revision: process.env.APP_REVISION ?? "unknown",
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return NextResponse.json(
      { status: "error", service: "budgetpro" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
}
