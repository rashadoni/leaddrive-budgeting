#!/usr/bin/env node
/**
 * Translate docs/USER_GUIDE.ru.md → USER_GUIDE.en.md + USER_GUIDE.az.md
 * via Anthropic Claude with a translation system prompt that preserves
 * markdown structure, code blocks, file paths, image refs, table layout,
 * and English UI labels (button text, route names, etc.).
 *
 * One-shot script — run after substantive RU updates.
 *
 *   node scripts/translate-guide.mjs           # both EN + AZ
 *   node scripts/translate-guide.mjs en        # EN only
 *   node scripts/translate-guide.mjs az        # AZ only
 *
 * Cost: ~$0.15 per language at Sonnet 4 pricing (~12K in + ~12K out).
 */

import { config as dotenvConfig } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Explicit .env load — `import "dotenv/config"` was missing the file
// when invoked from project root in some shells.
dotenvConfig({ path: path.resolve(process.cwd(), ".env") });
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const MODEL = "claude-sonnet-4-5-20250929";
const SOURCE = "docs/USER_GUIDE.ru.md";

const TARGETS = {
  en: {
    file: "docs/USER_GUIDE.en.md",
    name: "English",
    note:
      "Use clear professional business English — finance / FP&A register, " +
      "not casual. American spelling. Preserve all technical accuracy.",
  },
  az: {
    file: "docs/USER_GUIDE.az.md",
    name: "Azerbaijani",
    note:
      "Use formal Azerbaijani (Azərbaycan dili) suitable for a corporate " +
      "finance/CFO audience. Preserve all technical accuracy. Use Latin " +
      "script (the modern standard).",
  },
};

const SYSTEM_PROMPT = `You are a professional translator specializing in enterprise software documentation. You translate Russian → {{target_name}} for a corporate finance "Risk Terminal" product targeted at CFOs and finance teams of multi-company holdings.

CRITICAL RULES (non-negotiable):

1. Preserve markdown structure exactly:
   - All headings (# ## ### ####) with the same level
   - All tables, with the same columns and structure (translate cell contents)
   - All code blocks (\`\`\`...\`\`\`) UNCHANGED — never translate code, file paths, function names, command examples
   - All inline code (\`like this\`) UNCHANGED
   - All blockquotes (> ...)
   - All bullet/numbered lists with the same structure
   - All checklist items \`- [ ] item\` syntax (translate the item text)

2. Preserve all of these UNCHANGED (do NOT translate):
   - File paths (e.g. \`docs/USER_GUIDE.md\`, \`src/features/...\`)
   - Image references \`![alt](path/to.png)\` — translate alt text only, keep path
   - URLs and route paths (e.g. \`/budgeting/terminal\`, \`http://localhost:3000\`)
   - Identifiers: company codes (AZSEKER, AZSEKER-EDEN, etc.), indicator codes (CUSTOMER_HHI, FP_INVENTORY_TURNS, etc.), risk tag names (\`subsidy_dependency\`, \`non_transparent_structure\`, \`data_absence\`)
   - English UI labels and button text that appear in the live app (e.g. "Risk Terminal", "Board Deck", "Companies Readiness", "Indicator Health", "Explain", "Discuss", "Benchmark", "Print to PDF", "Export PPTX") — keep them in English exactly as written, because the app's UI is English
   - Brand names: BudgetPro, Anthropic, Claude, Next.js, Prisma, PostgreSQL, Vercel, etc.
   - Numbers, percentages, dates

3. Translate these:
   - All Russian prose
   - Russian table cell content (except codes/UI labels above)
   - Russian heading text (except UI labels)
   - Image alt text in Russian
   - All checklist item descriptions

4. {{target_note}}

5. Output ONLY the translated markdown — no commentary, no "Here is the translation", no code-fence wrapping the whole document.

6. Maintain the exact same anchor structure: when a heading appears in the original, the translated heading should occupy the same position in document flow.`;

async function translate(target) {
  const meta = TARGETS[target];
  if (!meta) throw new Error(`Unknown target: ${target}`);

  console.log(`→ Translating to ${meta.name} (${target})...`);

  const sourceText = await readFile(SOURCE, "utf8");

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Default request timeout is 10 min, but AZ translation of the
    // ~12K-token guide can push 6+ min — bump to 15 min as headroom.
    timeout: 15 * 60 * 1000,
    maxRetries: 1,
  });

  const systemPrompt = SYSTEM_PROMPT.replace(
    "{{target_name}}",
    meta.name,
  ).replace("{{target_note}}", meta.note);

  const t0 = Date.now();

  // Use streaming for long outputs (AZ translation can take 6+ min and
  // hits server-side timeout in non-streaming mode). Stream events
  // include incremental text deltas; we accumulate them.
  let translated = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = null;

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 16_000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Translate the following Russian markdown document to ${meta.name}. Follow all the rules in the system prompt strictly.\n\n--- BEGIN SOURCE ---\n\n${sourceText}\n\n--- END SOURCE ---`,
      },
    ],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      translated += event.delta.text;
    } else if (event.type === "message_delta") {
      if (event.usage) outputTokens = event.usage.output_tokens;
      if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
    } else if (event.type === "message_start") {
      inputTokens = event.message.usage?.input_tokens ?? 0;
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  translated = translated.trim();

  await writeFile(meta.file, translated + "\n", "utf8");
  console.log(
    `  ✓ ${meta.file}  ${translated.length} chars · ${inputTokens} in / ${outputTokens} out tokens · ${elapsed}s`,
  );
  if (stopReason && stopReason !== "end_turn") {
    console.warn(`  ⚠ stop_reason="${stopReason}" — output may be truncated`);
  }
}

async function main() {
  const arg = process.argv[2]?.toLowerCase();
  const targets = arg ? [arg] : ["en", "az"];

  for (const t of targets) {
    await translate(t);
  }
}

main().catch((err) => {
  console.error("✗", err.message);
  if (err.response) console.error(err.response);
  process.exit(1);
});
