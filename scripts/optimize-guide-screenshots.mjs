#!/usr/bin/env node
/**
 * 2026-05-27 — Convert guide PNGs → WebP for ~3.5x size reduction.
 *
 * Source:   public/guide/screenshots/*.png  (~5.8 MB total, 14 files)
 * Target:   public/guide/screenshots/*.webp (~1.5 MB target)
 * Quality:  85 (lossy but visually indistinguishable for UI screenshots)
 *
 * Also updates docs/USER_GUIDE.<lang>.md image refs:
 *   ![alt](guide/screenshots/01-login.png) → ![alt](guide/screenshots/01-login.webp)
 *
 * Original PNGs are KEPT in public/ (browsers fall back via <picture>
 * if needed; also useful for PDF print where lossless is preferred).
 *
 * Idempotent — re-running overwrites .webp + re-rewrites .md refs
 * (which is no-op on already-rewritten files).
 */

import sharp from "sharp";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const SRC_DIR = "public/guide/screenshots";
const GUIDES = [
  "docs/USER_GUIDE.ru.md",
  "docs/USER_GUIDE.en.md",
  "docs/USER_GUIDE.az.md",
];

async function main() {
  const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith(".png"));
  console.log(`→ Converting ${files.length} PNG → WebP @ q=85`);

  let totalPngBytes = 0;
  let totalWebpBytes = 0;

  for (const filename of files) {
    const srcPath = path.join(SRC_DIR, filename);
    const dstPath = path.join(SRC_DIR, filename.replace(/\.png$/, ".webp"));

    const pngBytes = (await stat(srcPath)).size;
    await sharp(srcPath).webp({ quality: 85 }).toFile(dstPath);
    const webpBytes = (await stat(dstPath)).size;
    totalPngBytes += pngBytes;
    totalWebpBytes += webpBytes;
    const ratio = ((1 - webpBytes / pngBytes) * 100).toFixed(0);
    console.log(
      `  ✓ ${filename.padEnd(40)} ${(pngBytes / 1024).toFixed(0)}KB → ${(webpBytes / 1024).toFixed(0)}KB (${ratio}% smaller)`,
    );
  }

  const totalSaving = ((1 - totalWebpBytes / totalPngBytes) * 100).toFixed(0);
  console.log(
    `\n  Total: ${(totalPngBytes / 1024 / 1024).toFixed(2)} MB → ${(totalWebpBytes / 1024 / 1024).toFixed(2)} MB (${totalSaving}% smaller)`,
  );

  console.log("\n→ Updating markdown image refs");
  for (const guidePath of GUIDES) {
    try {
      const md = await readFile(guidePath, "utf8");
      const updated = md.replace(
        /(guide\/screenshots\/[\w-]+)\.png/g,
        "$1.webp",
      );
      if (updated === md) {
        console.log(`  • ${guidePath} — no changes`);
        continue;
      }
      await writeFile(guidePath, updated, "utf8");
      const count = (md.match(/guide\/screenshots\/[\w-]+\.png/g) ?? []).length;
      console.log(`  ✓ ${guidePath} — rewrote ${count} image refs`);
    } catch (e) {
      console.warn(`  ⚠ ${guidePath} — ${e.message}`);
    }
  }

  console.log("\n✓ Done. Re-run capture-guide-screenshots.mjs if base PNGs change.");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
