// rls-scan-ignore: AI-narration route — a long-lived SSE stream with an
// LLM tool-use loop (runTool fires DB reads AFTER the handler returns, over
// minutes). A single interactive withOrgScope tx is architecturally
// impossible here (5s tx timeout, and the tx would have to span the whole
// stream). It is READ-ONLY and scoped by explicit organizationId/planId, so
// it uses the BYPASSRLS `prismaAdmin` client (route + its collectSectionContext
// / runTool libs) — app-layer org scoping preserved. Survives the Stage-3
// env-flip without a giant transaction.
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import type Anthropic from "@anthropic-ai/sdk"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { AI_MODEL, getAnthropicClient, hasAnthropicKey } from "@/lib/ai/client"
import { buildKickoffUserMessage, buildSystemPrompt } from "@/lib/ai/prompts"
import { collectSectionContext } from "@/lib/ai/section-context"
import type { Section } from "@/lib/ai/section-meta"
import { AI_TOOLS, isCustomTool, runTool, type ToolName } from "@/lib/ai/tools"
import { aiErrorBody } from "@/lib/ai/ai-error"
import { getLogger } from "@/lib/log"

const log = getLogger("api:ai-analytics")

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
  // Phase 7.G — optional company scope. When set, BudgetLine-backed
  // sections (pnl-report / pl / workspace pieces) filter to this
  // company so SPARK doesn't see AZMADE's roll-up. Sections backed by
  // plan-wide tables (balance-sheet / cogs / cash-flow / assumptions /
  // forecast) attach a scope-note to the data blob instead so the LLM
  // qualifies its narrative. Null / absent = "all consolidated".
  companyId: z.string().min(1).nullable().optional(),
  language: z.enum(["en", "ru", "az"]).default("en"),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(5000),
      }),
    )
    .max(20),
})

// Hard cap on tool-use iterations so a badly-behaved model can't loop forever.
// Each iteration is one streamed assistant turn; most flows resolve in 1-2.
const MAX_TOOL_ITERATIONS = 5

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
  const { section, planId, language, messages } = parsed.data
  const companyId = parsed.data.companyId ?? null

  // Confirm plan ownership — section-context.ts re-verifies but this gives a
  // clean 404 before we load a large context blob or hit the LLM.
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: auth.orgId, deletedAt: null },
    select: { id: true },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  // Cross-tenant guard + resolve company name for the scope note when
  // the caller supplied a companyId. 404 the request on cross-tenant
  // id rather than silently dropping the filter (would mask a bug).
  let companyName: string | null = null
  if (companyId) {
    const co = await prisma.company.findFirst({
      where: { id: companyId, organizationId: auth.orgId },
      select: { id: true, code: true, name: true },
    })
    if (!co) return NextResponse.json({ error: "Company not found" }, { status: 404 })
    companyName = `${co.code} · ${co.name}`
  }

  let sectionData: unknown
  try {
    sectionData = await collectSectionContext(
      section as Section,
      auth.orgId,
      planId,
      companyId,
      companyName,
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to collect section data"
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const systemPrompt = buildSystemPrompt(section as Section, sectionData, language)
  const initialMessages: Anthropic.Messages.MessageParam[] = messages.length > 0
    ? messages
    : [{ role: "user", content: buildKickoffUserMessage(section as Section, language) }]

  const client = getAnthropicClient()

  // Stream responses as SSE. Events emitted per line:
  //   { type: "text", text }
  //   { type: "tool_use",    id, name, input }
  //   { type: "tool_result", id, name, ok, error? }
  //   { type: "done" }
  //   { type: "error", error }
  //
  // The tool-use loop runs up to MAX_TOOL_ITERATIONS — each iteration streams
  // one assistant turn, then if it ended with stop_reason="tool_use" we
  // execute any custom tools locally and feed tool_results back as a new user
  // turn. Anthropic's native `web_search` is a server-side tool and is
  // handled transparently inside a single iteration; our loop only fires for
  // the custom drill-down tools declared in `AI_TOOLS`.
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const conversation: Anthropic.Messages.MessageParam[] = [...initialMessages]

      try {
        for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
          const streamResp = client.messages.stream({
            model: AI_MODEL,
            // Finance analysis on Russian / Azerbaijani uses ~2-3x more
            // tokens per word than English, and a detailed answer with
            // section headings + bullets + recommendations hits the old
            // 2048 cap mid-sentence. 8K gives plenty of headroom while
            // staying well under Sonnet 4.5's per-turn ceiling.
            max_tokens: 8192,
            system: [
              {
                type: "text",
                text: systemPrompt,
                // Prompt caching: section data is reused across turns in the same
                // conversation, so cache it to cut token spend on follow-ups.
                cache_control: { type: "ephemeral" },
              },
            ],
            messages: conversation,
            tools: [
              // Anthropic's native web search — server-side, resolved inside the
              // same assistant turn so we don't have to touch it from here.
              { type: "web_search_20250305", name: "web_search", max_uses: 3 } as unknown as Anthropic.Messages.Tool,
              ...AI_TOOLS,
            ],
          })

          for await (const event of streamResp) {
            if (event.type === "content_block_delta") {
              const delta = event.delta
              if (delta.type === "text_delta" && delta.text) {
                send({ type: "text", text: delta.text })
              }
            } else if (event.type === "content_block_start") {
              const block = event.content_block
              if (block.type === "tool_use" || block.type === "server_tool_use") {
                send({
                  type: "tool_use",
                  id: block.id,
                  name: block.name ?? "tool",
                  input: block.input ?? {},
                })
              }
            }
            // message_stop intentionally ignored — we emit "done" once after
            // the loop exits so the UI doesn't see a premature stop between
            // tool-use iterations.
          }

          const final = await streamResp.finalMessage()

          if (final.stop_reason === "max_tokens") {
            // Answer was cut off at the output-token limit. Surface a
            // structured notice so the UI can explain the truncation
            // instead of silently rendering a half-sentence.
            send({ type: "truncated", reason: "max_tokens" })
          }

          if (final.stop_reason !== "tool_use") break

          // Collect any custom tool_use blocks the model asked us to run. We
          // skip server-side blocks (web_search) since Anthropic already
          // handled them inside this turn.
          const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
          for (const block of final.content) {
            if (block.type !== "tool_use") continue
            if (!isCustomTool(block.name)) continue
            try {
              const result = await runTool(block.name as ToolName, block.input, {
                orgId: auth.orgId,
                planId,
              })
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result),
              })
              send({ type: "tool_result", id: block.id, name: block.name, ok: true })
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : "Tool call failed"
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({ error: message }),
                is_error: true,
              })
              send({ type: "tool_result", id: block.id, name: block.name, ok: false, error: message })
            }
          }

          // No custom tools actually ran — either only server-side tools were
          // used (Anthropic already handled them) or the model asked for a
          // tool we don't implement. Nothing to feed back, so stop.
          if (toolResults.length === 0) break

          conversation.push({ role: "assistant", content: final.content })
          conversation.push({ role: "user", content: toolResults })
        }

        send({ type: "done" })
        controller.close()
      } catch (err: unknown) {
        // Sanitized — stream only a stable code, never the raw provider
        // message (can embed billing text). Raw goes to the server log.
        log.error("ai-analytics stream failed", {
          err: err instanceof Error ? err.message : String(err),
        })
        send({ type: "error", error: aiErrorBody(err).code })
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
