/**
 * Сравнение двух прогонов стенда: база (Sonnet) против кандидата.
 *
 * Считает то, что реально решает судьбу локальной модели:
 *   • совпадение типа листа — ошибка здесь означает неверный маршрут парсера;
 *   • совпадение юрлица — ошибка здесь означает деньги, записанные не той компании;
 *   • время на книгу — упирается ли кандидат в таймаут импорта (300с в nginx).
 *
 * Совпадение считается по имени листа, а не по позиции: предклассификация
 * может отдавать листы в другом порядке.
 *
 * Запуск: npx tsx scripts/llm-bakeoff/compare.ts base.json candidate.json
 */
import { readFileSync } from "fs"

type Sheet = { sheetName: string; dataType: string; entityCode: string | null; confidence: number }
type FileRun = { file: string; ms: number; error?: string; skippedLLM?: boolean; sheets?: Sheet[] }
type Run = { provider: string; model: string; results: FileRun[] }

/** Таймаут прокси перед импортом — выше него книга не доедет в проде. */
const NGINX_TIMEOUT_MS = 300_000

function load(path: string): Run {
  return JSON.parse(readFileSync(path, "utf-8")) as Run
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length)
}

function main() {
  const [basePath, candPath] = process.argv.slice(2)
  if (!basePath || !candPath) throw new Error("usage: compare.ts <base.json> <candidate.json>")

  const base = load(basePath)
  const cand = load(candPath)

  process.stdout.write(`База:      ${base.model}\nКандидат:  ${cand.model}\n\n`)

  let sheetsTotal = 0
  let typeMatch = 0
  let entityMatch = 0
  const mismatches: string[] = []
  const slowFiles: string[] = []

  for (const baseFile of base.results) {
    const candFile = cand.results.find((r) => r.file === baseFile.file)
    if (!candFile) {
      mismatches.push(`${baseFile.file}: кандидат не обработал книгу`)
      continue
    }
    if (candFile.error) {
      mismatches.push(`${baseFile.file}: кандидат упал — ${candFile.error}`)
      continue
    }
    if (candFile.ms > NGINX_TIMEOUT_MS) {
      slowFiles.push(`${baseFile.file} — ${(candFile.ms / 1000).toFixed(0)}с`)
    }
    for (const bs of baseFile.sheets ?? []) {
      const cs = (candFile.sheets ?? []).find((s) => s.sheetName === bs.sheetName)
      sheetsTotal += 1
      if (!cs) {
        mismatches.push(`${baseFile.file} / ${bs.sheetName}: кандидат лист не вернул`)
        continue
      }
      if (cs.dataType === bs.dataType) typeMatch += 1
      else {
        mismatches.push(
          `${pad(baseFile.file, 28)} ${pad(bs.sheetName, 22)} тип: ${bs.dataType} → ${cs.dataType}`,
        )
      }
      if ((cs.entityCode ?? null) === (bs.entityCode ?? null)) entityMatch += 1
      else {
        mismatches.push(
          `${pad(baseFile.file, 28)} ${pad(bs.sheetName, 22)} юрлицо: ${bs.entityCode ?? "—"} → ${cs.entityCode ?? "—"}`,
        )
      }
    }
  }

  const pct = (n: number) => (sheetsTotal ? ((n / sheetsTotal) * 100).toFixed(1) : "0.0")
  const totalMs = (run: Run) => run.results.reduce((sum, r) => sum + r.ms, 0)
  const maxMs = (run: Run) => run.results.reduce((max, r) => Math.max(max, r.ms), 0)

  process.stdout.write(`Листов сравнено:      ${sheetsTotal}\n`)
  process.stdout.write(`Совпал тип листа:     ${typeMatch} (${pct(typeMatch)}%)\n`)
  process.stdout.write(`Совпало юрлицо:       ${entityMatch} (${pct(entityMatch)}%)\n\n`)
  process.stdout.write(
    `Время: база ${(totalMs(base) / 1000).toFixed(0)}с всего / худшая книга ${(maxMs(base) / 1000).toFixed(0)}с\n`,
  )
  process.stdout.write(
    `       кандидат ${(totalMs(cand) / 1000).toFixed(0)}с всего / худшая книга ${(maxMs(cand) / 1000).toFixed(0)}с\n\n`,
  )

  if (slowFiles.length) {
    process.stdout.write(`⚠ Не уложились в таймаут импорта (${NGINX_TIMEOUT_MS / 1000}с):\n`)
    for (const f of slowFiles) process.stdout.write(`   ${f}\n`)
    process.stdout.write("\n")
  }

  if (mismatches.length === 0) {
    process.stdout.write("Расхождений нет.\n")
  } else {
    process.stdout.write(`Расхождения (${mismatches.length}):\n`)
    for (const m of mismatches) process.stdout.write(`   ${m}\n`)
  }
}

main()
