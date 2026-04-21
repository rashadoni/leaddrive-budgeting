import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return NextResponse.json({
    narrative: "AI narrative analysis is not available in the demo version. Connect your Anthropic API key to enable AI-powered budget analysis.",
    generated: false,
  })
}
