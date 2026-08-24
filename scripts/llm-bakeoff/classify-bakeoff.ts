/**
 * Замерочный стенд: тот же классификатор листов, разные модели.
 *
 * Зачем: клиент не хочет выпускать данные из периметра и рассматривает
 * локальную LLM. Вопрос «какого размера модели хватит» без замера не имеет
 * честного ответа — качество упирается не в число параметров, а в дисциплину
 * следования двадцати правилам промпта и в понимание азербайджанских
 * заголовков. Стенд прогоняет РЕАЛЬНЫЕ книги через нынешний Sonnet и через
 * любую локальную модель по OpenAI-совместимому адресу и даёт две цифры:
 * расхождение классификаций и время на книгу.
 *
 * Ключевое: используется ПРОДОВЫЙ код — extractWorkbookMeta + classifySheets,
 * тот же системный промпт, тот же парсер, та же предклассификация без LLM.
 * Меняется только транспорт, поэтому сравнение честное.
 *
 * Запуск:
 *   # база (как сегодня в проде)
 *   npx tsx scripts/llm-bakeoff/classify-bakeoff.ts \
 *     --files "data/budget azersheker" --provider anthropic --out /tmp/base.json
 *
 *   # кандидат на локальной машине (Ollama / llama.cpp / vLLM)
 *   npx tsx scripts/llm-bakeoff/classify-bakeoff.ts \
 *     --files "data/budget azersheker" --provider openai \
 *     --base-url http://192.168.1.50:11434/v1 --model qwen2.5:32b-instruct-q4_K_M \
 *     --out /tmp/qwen32.json
 *
 * Затем: npx tsx scripts/llm-bakeoff/compare.ts /tmp/base.json /tmp/qwen32.json
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "fs"
import { join } from "path"
import * as XLSX from "xlsx"
import { extractWorkbookMeta } from "@/lib/onboarding/ai-import/sheet-meta-extractor"
import {
  classifySheets,
  type SheetClassifierAnthropicLike,
} from "@/lib/onboarding/ai-import/sheet-classifier"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { openAiCompatibleClient } from "@/lib/llm/openai-compatible"

type Args = {
  files: string
  provider: "anthropic" | "openai"
  model: string
  baseUrl?: string
  apiKey?: string
  out: string
  knownEntityCodes: string[]
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const provider = (get("provider") ?? "anthropic") as Args["provider"]
  const files = get("files")
  if (!files) throw new Error("--files <каталог или .xlsx> обязателен")
  return {
    files,
    provider,
    model: get("model") ?? AI_MODEL,
    baseUrl: get("base-url"),
    apiKey: get("api-key") ?? process.env.LOCAL_LLM_API_KEY ?? "not-needed",
    out: get("out") ?? `/tmp/bakeoff-${provider}.json`,
    knownEntityCodes: (get("entities") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  }
}

function collectWorkbooks(target: string): string[] {
  const st = statSync(target)
  if (st.isFile()) return [target]
  return readdirSync(target)
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"))
    .map((f) => join(target, f))
    .sort()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const client =
    args.provider === "anthropic"
      ? (getAnthropicClient() as unknown as SheetClassifierAnthropicLike)
      : openAiCompatibleClient(
          args.baseUrl ?? (() => { throw new Error("--base-url обязателен для --provider openai") })(),
          args.apiKey!,
        )

  const workbooks = collectWorkbooks(args.files)
  if (workbooks.length === 0) throw new Error(`Не найдено .xlsx в ${args.files}`)
  process.stdout.write(`Книг: ${workbooks.length}, модель: ${args.model}\n\n`)

  const results: Array<Record<string, unknown>> = []
  for (const path of workbooks) {
    const label = path.split("/").pop()!
    const started = Date.now()
    try {
      const workbook = XLSX.read(readFileSync(path), { type: "buffer" })
      const metas = extractWorkbookMeta(workbook, XLSX)
      const classified = await classifySheets(
        { sheetMetas: metas, knownEntityCodes: args.knownEntityCodes },
        client,
        args.model,
      )
      const ms = Date.now() - started
      results.push({
        file: label,
        ms,
        skippedLLM: classified.skippedLLM,
        usage: classified.usage,
        sheets: classified.classifications.map((c) => ({
          sheetName: c.sheetName,
          dataType: c.dataType,
          entityCode: c.entityCode ?? null,
          confidence: c.confidence,
        })),
      })
      process.stdout.write(
        `  ✓ ${label} — листов ${classified.classifications.length}, ${(ms / 1000).toFixed(1)}с\n`,
      )
    } catch (err) {
      const ms = Date.now() - started
      results.push({ file: label, ms, error: err instanceof Error ? err.message : String(err) })
      process.stdout.write(`  ✗ ${label} — ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  writeFileSync(
    args.out,
    JSON.stringify({ provider: args.provider, model: args.model, results }, null, 2),
  )
  process.stdout.write(`\nЗаписано: ${args.out}\n`)
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
  process.exitCode = 1
})
