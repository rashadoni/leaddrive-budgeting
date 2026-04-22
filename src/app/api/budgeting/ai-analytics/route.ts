import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { AI_MODEL, getAnthropicClient, hasAnthropicKey } from "@/lib/ai/client"
import { buildKickoffUserMessage, buildSystemPrompt } from "@/lib/ai/prompts"
import { collectSectionContext, type Section } from "@/lib/ai/section-context"

export const maxDuration = 120
export const runtime = "nodejs"

const requestSchema = z.object({
  section: z.enum([
    "pnl-report",
    "pl",
    "balance-sheet",
    "cogs",
    "cash-flow",
    "assumptions",
    "workspace",
    "forecast",
  ]),
  planId: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(5000),
      }),
    )
    .max(20),
})

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  if (!hasAnthropicKey()) {
    return NextResponse.json(
      { error: "AI analytics is not configured on this server (ANTHROPIC_API_KEY missing)." },
      { status: 503 },
    )
  }

  let body
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 })
  }
  const { section, planId, messages } = parsed.data

  // Confirm plan ownership — section-context.ts re-verifies but this gives a
  // clean 404 before we load a large context blob or hit the LLM.
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: auth.orgId, deletedAt: null },
    select: { id: true },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  let sectionData: unknown
  try {
    sectionData = await collectSectionContext(section as Section, auth.orgId, planId)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to collect section data" }, { status: 500 })
  }

  const systemPrompt = buildSystemPrompt(section as Section, sectionData)
  const apiMessages = messages.length > 0
    ? messages
    : [{ role: "user" as const, content: buildKickoffUserMessage(section as Section) }]

  const client = getAnthropicClient()

  // Stream the response as SSE so the UI can render tokens as they arrive.
  // Each event is a JSON line: { type: "text" | "tool_use" | "done" | "error", ... }
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      try {
        const streamResp = client.messages.stream({
          model: AI_MODEL,
          max_tokens: 2048,
          system: [
            {
              type: "text",
              text: systemPrompt,
              // Prompt caching: section data is reused across turns in the same
              // conversation, so cache it to cut token spend on follow-ups.
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: apiMessages,
          tools: [
            // Anthropic's native web search tool — no custom handler needed;
            // results flow back through the stream as tool_use / tool_result.
            { type: "web_search_20250305", name: "web_search", max_uses: 3 } as any,
          ],
        })

        for await (const event of streamResp) {
          if (event.type === "content_block_delta") {
            const delta = (event as any).delta
            if (delta?.type === "text_delta" && delta.text) {
              send({ type: "text", text: delta.text })
            }
          } else if (event.type === "content_block_start") {
            const block = (event as any).content_block
            if (block?.type === "tool_use" && block.name === "web_search") {
              send({ type: "tool_use", name: "web_search", input: block.input })
            } else if (block?.type === "server_tool_use") {
              send({ type: "tool_use", name: block.name ?? "tool", input: block.input })
            }
          } else if (event.type === "message_stop") {
            send({ type: "done" })
          }
        }
        controller.close()
      } catch (err: any) {
        send({ type: "error", error: err?.message ?? "AI request failed" })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
