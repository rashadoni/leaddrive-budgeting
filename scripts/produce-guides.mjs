#!/usr/bin/env node
/**
 * scripts/produce-guides.mjs
 * =====================================================================
 * One-shot producer for the product guide videos: for each language it records
 * short screen tours of every navigable section (Playwright chromium
 * `recordVideo`, 1280×720) and muxes a synchronized voiceover on top with
 * ffmpeg.
 *
 * VOICE ENGINES — configurable via env. DEFAULT: AZ → Google Gemini native TTS;
 * EN & RU → Microsoft Azure Speech. (Gemini's preview TTS is capped at ~100
 * requests/day, so we spend it only on Azerbaijani; Azure is fast and uncapped
 * for the rest.) `tts()` looks up `ENGINE[lang]` and calls the matching engine.
 * Overrides:
 *   TTS_ENGINE=gemini   force ALL languages onto one engine (or =azure).
 *   ENGINE_AZ=azure / ENGINE_RU=gemini / ENGINE_EN=gemini  per-language override.
 * There is NO local TTS and NO local fallback — AGENTS.md forbids it, so an
 * exhausted engine skips the section rather than degrading to a local voice.
 * NOTE: Gemini's preview model is heavily rate-limited (~1–2 req / ~60s), so
 * routing English through Gemini too makes the English pass slow (Azure is fast).
 *
 * SCENARIOS: BudgetPro drives everything from the hand-authored
 * `video/scenarios/overrides.mjs` (one rich entry per section). The generic
 * `video/scenarios/browser-guided.json` is OPTIONAL and simply starts empty when
 * absent. Auth uses the Credentials provider — set RECORDER_EMAIL /
 * RECORDER_PASSWORD (or the fallback HELP_VIDEO_EMAIL / HELP_VIDEO_PASSWORD).
 *
 * OUTPUT is what the app actually serves (src/app/api/help-videos/[file]):
 *   video/player/{slug}.{lang}.VOICE.mp4   + poster {slug}.{lang}.poster.jpg
 *
 * USAGE
 *   node scripts/produce-guides.mjs <BASE_URL> [langs] [section ...]
 *     BASE_URL   e.g. http://127.0.0.1:3000 (default HELP_VIDEO_BASE_URL)
 *     langs      "en" or "az,ru" (default "az,en,ru")
 *     section…   optional scenario keys to limit the run (default: all)
 *
 * FLAGS (env)
 *   FORCE=1    re-record/overwrite existing valid videos (else resume = skip)
 *   CLEAN=1    delete the target {slug}.{lang}.VOICE.mp4/.poster.jpg first
 *              (implied by FORCE)
 *   RESEED=1   reseed demo data before each language via scripts/demo-fill.mjs
 *   DEMO_API   API/base URL passed to demo-fill (default = BASE_URL)
 *   DEMO_CMD   override reseed command (default: node scripts/demo-fill.mjs)
 *
 * PREREQS: ffmpeg + ffprobe in PATH, playwright chromium installed, a running
 * app stand, and keys in .env — GEMINI_API_KEY (primary voice) plus
 * AZURE_SPEECH_KEY / AZURE_SPEECH_REGION (English). Gemini's preview TTS model
 * is heavily rate-limited (~1–2 requests per ~60s window); a full single-
 * language pass therefore takes ~1.5–2h. A billed key raises the quota.
 * =====================================================================
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, request } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const scenarioPath = resolve(repoRoot, "video/scenarios/browser-guided.json");
const navItemsPath = resolve(repoRoot, "src/lib/nav-items.ts");
const tourDefinitionsPath = resolve(repoRoot, "src/lib/tour-definitions.ts");
const outDir = resolve(repoRoot, "video/player");
const tmpRoot = resolve(repoRoot, "video/.tmp-guides");
const audioRoot = resolve(tmpRoot, "audio");

loadProjectEnv();

// ── CLI + flags ────────────────────────────────────────────────────────────
const positionals = process.argv.slice(2).filter((v) => !v.startsWith("-"));
const baseUrl = (positionals[0] || process.env.HELP_VIDEO_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const langs = (positionals[1] || process.env.GUIDE_LANGS || "az,en,ru")
  .split(",").map((v) => v.trim()).filter(Boolean);
const requestedSections = positionals.slice(2);

const FORCE = envFlag("FORCE");
const CLEAN = envFlag("CLEAN") || FORCE;
const RESEED = envFlag("RESEED");
const DEMO_API = process.env.DEMO_API || baseUrl;
const DEMO_CMD = process.env.DEMO_CMD || "node scripts/demo-fill.mjs";

// Prod safety: when the target is NOT a local host, default to READ-ONLY so the
// recorder never clicks create/delete/send buttons on a live app (it moves the
// cursor to the target and hovers instead). Override with ALLOW_MUTATIONS=1 only
// against a throwaway/demo tenant. READONLY=1 forces it on for any target.
const isRemoteTarget = !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(baseUrl);
// READONLY also trips on NODE_ENV=production, so running ON the prod server via a
// localhost URL is still safe. ALLOW_MUTATIONS=1 opts out (throwaway tenant only).
const READONLY = envFlag("READONLY")
  || ((isRemoteTarget || process.env.NODE_ENV === "production") && !envFlag("ALLOW_MUTATIONS"));

// Voice-per-language routing. Default is Gemini for EVERY language (user
// decision: all narration via Gemini). Set TTS_ENGINE to force ALL languages to
// one engine regardless (e.g. TTS_ENGINE=gemini — the "only Gemini" switch), or
// override a single language with ENGINE_AZ / ENGINE_RU / ENGINE_EN (e.g.
// ENGINE_EN=azure to put English back on Azure).
const forcedEngine = process.env.TTS_ENGINE || null;
const ENGINE = {
  az: forcedEngine || process.env.ENGINE_AZ || "gemini", // Gemini's scarce quota only for AZ
  ru: forcedEngine || process.env.ENGINE_RU || "azure",  // EN/RU → Azure (fast, no daily cap)
  en: forcedEngine || process.env.ENGINE_EN || "azure",
};

// Timing knobs. LEAD: the voice starts first, the cursor/action fires LEAD ms
// later so narration never trails the motion. TAIL: hold after the voice ends.
const LEAD_MS = Number(process.env.GUIDE_LEAD_MS || 650);
const TAIL_MS = Number(process.env.GUIDE_TAIL_MS || 700);
const END_PAD_MS = Number(process.env.GUIDE_END_PAD_MS || 1200);
const PREROLL_SETTLE_MS = Number(process.env.GUIDE_PREROLL_MS || 900);

// Viewport == video size (1:1) so there is no scaling: the poster screenshot
// matches the recorded frame exactly, cursor coords need no remapping, and the
// aspect ratio can't distort or letterbox.
const videoSize = { width: 1280, height: 720 };
const viewport = { ...videoSize };

// CSS injected at document-start on EVERY page (so it also covers the clean
// poster, taken before the cursor). Hides the floating help widget AND the
// product-tour overlay (`z-[10000]` is used ONLY by the tour renderer, verified)
// — the tour auto-starts ~800ms after mount and the localStorage pre-seed alone
// loses that hydration race, so CSS is the reliable kill. Also carries the
// cursor + click-pulse styles. Defined here (top of module) so it is initialized
// before the top-level run loop calls installInitScripts (avoids a TDZ error).
const GUIDE_CSS = [
  "[data-help-video-widget],aside[class*='fixed'][class*='bottom-'],[class*='fixed'][class*='bottom-'][class*='right-']{display:none!important}",
  '[class~="z-[10000]"],.z-\\[10000\\]{display:none!important}', // product-tour overlay (spotlight + card)
  "#ld-pilot-cursor{position:fixed;z-index:2147483647;width:28px;height:28px;left:0;top:0;pointer-events:none;transform:translate(-100px,-100px);transition:transform .12s linear;filter:drop-shadow(0 10px 14px rgba(15,23,42,.25));}",
  "#ld-pilot-cursor:before{content:'';position:absolute;left:7px;top:1px;width:0;height:0;border-right:18px solid transparent;border-bottom:25px solid #fff;transform:rotate(-24deg);}",
  "#ld-pilot-cursor:after{content:'';position:absolute;left:8px;top:3px;width:0;height:0;border-right:13px solid transparent;border-bottom:19px solid #111827;transform:rotate(-24deg);}",
  ".ld-pilot-pulse{position:fixed;z-index:2147483645;width:64px;height:64px;border:4px solid #FF4D00;border-radius:999px;pointer-events:none;transform:translate(-50%,-50%) scale(.3);opacity:.75;animation:ldPilotPulse .5s ease-out forwards;}",
  "@keyframes ldPilotPulse{to{transform:translate(-50%,-50%) scale(1.25);opacity:0;}}",
].join("\n");

// Gemini native TTS config. Supports MULTIPLE keys (rotation / daily-quota
// failover): when one key hits its ~100/day cap, the recorder switches to the
// next. Provide extras as GEMINI_API_KEY2, GEMINI_API_KEY3, … (or …_2, …_3), or
// comma-separate several inside any one of those vars. Order = priority.
const geminiKeys = (() => {
  const raw = [];
  for (const base of ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENAI_API_KEY"]) {
    for (const suffix of ["", "2", "3", "4", "5", "6", "7", "8", "9", "_2", "_3", "_4", "_5"]) {
      const v = process.env[`${base}${suffix}`];
      if (v) raw.push(v);
    }
  }
  const keys = [];
  for (const v of raw) for (const k of String(v).split(",").map((s) => s.trim()).filter(Boolean)) if (!keys.includes(k)) keys.push(k);
  return keys;
})();
const geminiKey = geminiKeys[0] || ""; // back-compat: preflight check + single refs
let gKeyIdx = 0;                        // which key is in use right now
const gExhausted = new Set();           // key indices that hit their DAILY quota
const geminiModel = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const geminiVoice = process.env.GEMINI_TTS_VOICE || "Kore";
const geminiMaxRetries = Number(process.env.GEMINI_MAX_RETRIES || 10);
const geminiWindowMs = Number(process.env.GEMINI_WINDOW_MS || 60000);

// Azure Speech config (English only, per ENGINE map).
const azureKey = firstEnv("AZURE_SPEECH_KEY", "SPEECH_KEY", "AZURE_AI_SPEECH_KEY");
const azureRegion = firstEnv("AZURE_SPEECH_REGION", "SPEECH_REGION", "AZURE_AI_SPEECH_REGION");
const azureEndpoint = firstEnv("AZURE_SPEECH_ENDPOINT", "SPEECH_ENDPOINT").replace(/\/$/, "");
const azureFormat = process.env.AZURE_SPEECH_OUTPUT_FORMAT || "audio-24khz-160kbitrate-mono-mp3";
const azureVoices = {
  az: process.env.AZURE_SPEECH_VOICE_AZ || "az-AZ-BabekNeural",
  en: process.env.AZURE_SPEECH_VOICE_EN || "en-US-JennyNeural",
  ru: process.env.AZURE_SPEECH_VOICE_RU || "ru-RU-DmitryNeural",
};
const azureLangs = { az: "az-AZ", en: "en-US", ru: "ru-RU" };

// BudgetPro ships only the hand-authored overrides.mjs; the generic
// browser-guided.json is optional here (load it if present, else start empty).
const scenarios = existsSync(scenarioPath) ? JSON.parse(readFileSync(scenarioPath, "utf8")) : {};

// Hand-authored, per-section rich scenarios live in an OPTIONAL JS module
// (`video/scenarios/overrides.mjs`) whose entries have `scenes:[{ voice{lang},
// do:async(page,lang,h)=>{} }]` — the cursor really drives the section's real
// buttons/tabs/features. An override wins over the generic JSON for that slug.
const overridesPath = resolve(repoRoot, "video/scenarios/overrides.mjs");
let overrides = {};
if (existsSync(overridesPath)) {
  try { overrides = (await import(pathToFileURL(overridesPath).href)).default || {}; }
  catch (e) { console.warn(`  ⚠ overrides load failed: ${e.message}`); }
}
const getScenario = (slug) => overrides[slug] || scenarios[slug];
const unitsOf = (scenario) => scenario.scenes || scenario.steps || [];

// ── Section selection + coverage check against the live nav ─────────────────
// Known slugs = the generic browser-guided set PLUS any hand-authored override
// (e.g. "deal-detail") that has no nav entry of its own.
const allSlugs = [...new Set([...Object.keys(scenarios), ...Object.keys(overrides)])];
for (const slug of requestedSections) {
  if (!scenarios[slug] && !overrides[slug]) {
    throw new Error(`Unknown section "${slug}". Known: ${allSlugs.slice(0, 8).join(", ")}…`);
  }
}
const sections = requestedSections.length ? requestedSections : allSlugs;
reportNavCoverage();

mkdirSync(outDir, { recursive: true });
mkdirSync(audioRoot, { recursive: true });

// ── Preflight: fail loud if an engine we need has no credentials ────────────
const neededEngines = new Set(langs.map((l) => ENGINE[l]));
if (neededEngines.has("gemini") && !geminiKey) {
  throw new Error("GEMINI_API_KEY is required for Gemini voices (az/ru). Set it in .env — do not commit it.");
}
if (neededEngines.has("azure") && !azureKey) {
  throw new Error("AZURE_SPEECH_KEY is required for the English (azure) voice. Set it in .env.");
}
if (neededEngines.has("azure") && !azureRegion && !azureEndpoint) {
  throw new Error("AZURE_SPEECH_REGION or AZURE_SPEECH_ENDPOINT is required for the English voice.");
}

console.log(`▶ base=${baseUrl}  langs=${langs.join(",")}  sections=${sections.length}  FORCE=${FORCE} RESEED=${RESEED}`);
console.log(`▶ engines: ${langs.map((l) => `${l}→${ENGINE[l]}`).join("  ")}${neededEngines.has("gemini") ? `  (Gemini keys: ${geminiKeys.length}${geminiKeys.length > 1 ? " — rotating on daily quota" : ""})` : ""}`);
console.log(`▶ target=${isRemoteTarget ? "REMOTE" : "local"}  READONLY=${READONLY}${READONLY ? " (clicks→hover, no mutations)" : ""}`);
if (isRemoteTarget && !READONLY) console.warn("  ⚠ MUTATIONS ENABLED against a remote target — only do this on a throwaway/demo tenant.");

const summary = [];
const quotaState = { exhausted: false }; // set when the daily Gemini quota is hit
for (const lang of langs) {
  await produceLanguage(lang);
  if (quotaState.exhausted) break; // quota is project-wide → stop remaining languages
}

console.log("\n════════ SUMMARY ════════");
for (const row of summary) console.log(row);
if (quotaState.exhausted) {
  console.log("\n⛔ Stopped: daily Gemini TTS quota reached. Videos generated so far are saved.");
  console.log("   Re-run the SAME command (WITHOUT FORCE) after the quota resets (~midnight Pacific /");
  console.log("   ~11:00 Baku) to resume — already-done sections are skipped, so it picks up where it left off.");
}
const failed = summary.filter((r) => r.includes("FAIL")).length;
if (failed) {
  console.error(`\n${failed} section(s) failed — see log above.`);
  process.exit(1);
}

// ═════════════════════════════════════════════════════════════════════════
// Per-language pipeline
// ═════════════════════════════════════════════════════════════════════════
async function produceLanguage(lang) {
  console.log(`\n╔══ LANGUAGE: ${lang} (voice: ${ENGINE[lang]}) ══════════════════`);

  // 1) Reseed demo data in this language so on-screen lists/titles match the
  //    voiceover language. Log-but-don't-crash: a failed reseed must not abort
  //    the recording of a whole language.
  if (RESEED && isRemoteTarget && !envFlag("CONFIRM_PROD")) {
    console.warn("  ⚠ RESEED skipped: target is remote/prod. Reseeding writes to the DB — set CONFIRM_PROD=1 to allow (demo tenant only).");
  } else if (RESEED) {
    try {
      console.log(`  ↻ reseeding demo data (DEMO_LANG=${lang}) …`);
      const [cmd, ...cmdArgs] = DEMO_CMD.split(" ");
      const res = spawnSync(cmd, [...cmdArgs, DEMO_API], {
        cwd: repoRoot,
        stdio: "inherit",
        env: { ...process.env, DEMO_RESET: "1", DEMO_LANG: lang },
      });
      if (res.status !== 0) console.warn(`  ⚠ reseed exited ${res.status} — continuing with existing data.`);
    } catch (error) {
      console.warn(`  ⚠ reseed failed (${error.message}) — continuing with existing data.`);
    }
  }

  // 2) Pre-generate ALL scene audio for this language (no browser open, so the
  //    session can't idle-expire while Gemini's rate-limit window ticks). Each
  //    scene mp3's measured duration drives how long we hold it on screen.
  console.log(`  ♪ generating scene audio for ${sections.length} section(s) …`);
  const audioBySection = {};
  for (const slug of sections) {
    if (isValidRender(videoOut(slug, lang), posterOut(slug, lang)) && !FORCE) {
      continue; // resume: no audio needed for a section we will skip
    }
    try {
      audioBySection[slug] = await ensureSceneAudio(slug, lang);
    } catch (error) {
      if (error.code === "GEMINI_DAILY_QUOTA") {
        console.warn(`\n  ⛔ ${error.message}. Stopping audio generation; will record what's ready.`);
        quotaState.exhausted = true;
        break; // record whatever already has audio, then stop
      }
      console.error(`  ✖ audio ${slug}.${lang}: ${error.message}`);
      summary.push(`FAIL  ${slug}.${lang}  (audio: ${error.message})`);
    }
  }

  // 3) One login per language (single "role"), then record every section.
  const api = await request.newContext({ baseURL: baseUrl });
  const userId = await loginWithRetry(api);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport,
    deviceScaleFactor: 1,
    recordVideo: { dir: tmpRoot, size: videoSize },
  });
  await context.addCookies([{ name: "NEXT_LOCALE", value: lang, url: baseUrl }]);
  await installInitScripts(context, lang, userId);

  try {
    for (const slug of sections) {
      const out = videoOut(slug, lang);
      const poster = posterOut(slug, lang);
      if (isValidRender(out, poster) && !FORCE) {
        console.log(`  ⏭ ${slug}.${lang} already rendered — skip (FORCE=1 to redo)`);
        summary.push(`SKIP  ${slug}.${lang}`);
        continue;
      }
      const audio = audioBySection[slug];
      if (!audio) {
        // No audio: if the daily quota stopped us early, this section is simply
        // deferred to a later run — not a failure. Otherwise it's a real gap.
        if (!quotaState.exhausted) summary.push(`FAIL  ${slug}.${lang}  (no audio)`);
        continue;
      }
      if (CLEAN) { rmSync(out, { force: true }); rmSync(poster, { force: true }); }
      try {
        await recordSection(context, slug, lang, audio, out, poster);
        summary.push(`OK    ${slug}.${lang}`);
        console.log(`  ✔ ${slug}.${lang} → ${rel(out)}`);
      } catch (error) {
        summary.push(`FAIL  ${slug}.${lang}  (${error.message})`);
        console.error(`  ✖ ${slug}.${lang}: ${error.message}`);
      }
    }
  } finally {
    await context.close();
    await browser.close();
    await api.dispose();
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Recording a single section  →  one webm (per page) + clean poster + mux
// ═════════════════════════════════════════════════════════════════════════
async function recordSection(context, slug, lang, audio, out, poster) {
  const scenario = getScenario(slug);
  const units = unitsOf(scenario);
  const isDo = Boolean(scenario.scenes);
  const page = await context.newPage();
  const readonlyMutationViolations = [];
  if (READONLY) {
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
        readonlyMutationViolations.push(`${request.method()} ${request.url()}`);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
  }
  const assertReadonlyNoMutations = () => {
    if (readonlyMutationViolations.length > 0) {
      throw new Error(
        `READONLY blocked mutating request(s): ${readonlyMutationViolations.join(", ")}`,
      );
    }
  };
  // recordVideo for this page starts ~now; anchor scene offsets to this instant.
  const t0 = Date.now();
  let posterSaved = false;
  const offsets = []; // video-ms at which each scene's voice should start

  try {
    let currentRoute = null;

    const gotoRoute = async (route) => {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.locator("h1").first().waitFor({ state: "visible", timeout: 20000 })
        .catch(() => page.locator("main, body").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {}));
      await applyGuideStyles(page); // hide tour/widget + style cursor BEFORE the poster
      await page.waitForTimeout(PREROLL_SETTLE_MS);
      await dismissTours(page); // click the tour's skip so it completes and won't re-open
      await collapseSidebar(page); // focus the guide on its content, not the left menu
      currentRoute = route;
    };

    await gotoRoute(units[0]?.route || scenario.route);

    // CLEAN poster: capture BEFORE injecting the cursor overlay so the still is
    // a pristine screenshot of the landing view.
    await page.screenshot({ path: poster, type: "jpeg", quality: 90 }).catch(() => {});
    posterSaved = true;

    await injectCursor(page);
    const helpers = makeHelpers(page); // cursor move/click/hover/fill for `do` scenes

    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      const durMs = audio[i]?.durationMs ?? 6000;

      if (unit.route && unit.route !== currentRoute) {
        await gotoRoute(unit.route);
        await injectCursor(page); // navigation blew away the overlay
      }

      offsets[i] = Date.now() - t0;           // when scene i's voice begins
      await sleep(LEAD_MS);                    // voice leads, cursor follows
      try {
        if (isDo) await unit.do?.(page, lang, helpers);
        else await performAction(page, unit);
      } catch (e) {
        if (isDo) throw e;
        log(`      · scene ${i + 1} action skipped: ${e.message}`);
      }

      assertReadonlyNoMutations();

      // Hold the scene for exactly its narration length (+ tail).
      const targetEnd = offsets[i] + durMs + TAIL_MS;
      const remain = targetEnd - (Date.now() - t0);
      if (remain > 0) await sleep(remain);
      assertReadonlyNoMutations();
    }

    await sleep(END_PAD_MS); // ensure the video always outlasts the last voice
    assertReadonlyNoMutations();
  } finally {
    await page.close(); // finalizes this page's webm
  }

  const webm = await page.video().path();
  muxSection(webm, audio, offsets, out);
  rmSync(webm, { force: true });

  if (!posterSaved || !existsSync(poster)) {
    // Extremely defensive: derive a poster from the first video frame.
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", out,
      "-vf", "select=eq(n\\,0)", "-vframes", "1", poster], { stdio: "inherit" });
  }
  if (!isValidRender(out, poster)) throw new Error("post-render verification failed");
}

async function performAction(page, step) {
  if (step.preclick && !READONLY) {
    const pre = await firstLocator(page, step.preclick);
    await pre?.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  const target = await firstLocator(page, step.target);
  await target?.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const pointer = await firstLocator(page, step.pointerTarget || step.target);
  const box = await pointer?.boundingBox().catch(() => null);
  const x = box ? box.x + box.width / 2 : viewport.width / 2;
  const y = box ? box.y + Math.min(box.height / 2, 40) : viewport.height / 2;

  await page.mouse.move(x, y, { steps: 18 }); // real move → DOM cursor overlay follows
  await page.waitForTimeout(250);

  // In READONLY mode we never fire mutating interactions: the cursor still
  // travels to the target and pulses, but no click/typing occurs — safe on prod.
  if (READONLY && (step.action === "click" || step.action === "fill")) {
    await pointer?.hover({ timeout: 6000 }).catch(() => {});
    await pulse(page, x, y);
    return;
  }

  switch (step.action) {
    case "click":
      await page.mouse.click(x, y).catch(() => {});
      await pulse(page, x, y);
      break;
    case "fill": {
      const field = await firstLocator(page, step.fillTarget || step.target);
      if (field && step.value) {
        await field.click({ timeout: 6000 }).catch(() => {});
        await field.selectText().catch(() => {});           // replace, don't append
        await field.pressSequentially(localized(step.value, step.__lang), { delay: 24, timeout: 20000 }).catch(() => {});
      }
      break;
    }
    case "hover":
      await pointer?.hover({ timeout: 6000 }).catch(() => {}); // let tooltips appear
      break;
    default: // "scroll" / undefined → gentle reveal scroll
      await page.mouse.wheel(0, 240).catch(() => {});
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ffmpeg mux: overlay per-scene narration onto the recorded webm
// ═════════════════════════════════════════════════════════════════════════
function muxSection(webm, audio, offsetsMs, out) {
  // Trim the dead "page still loading" head: recording starts at page creation,
  // but scene 0's narration only begins at offsets[0] — which can be ~20s on
  // live pages (map, feeds) where networkidle settles slowly, leaving a silent
  // intro. Seek the video past it and shift every scene's audio down by the same
  // amount, keeping a short lead before the first voice.
  const LEAD_IN_MS = 400;
  const defined = offsetsMs.filter((o) => typeof o === "number" && o >= 0);
  const headTrimMs = defined.length ? Math.max(0, Math.round(Math.min(...defined) - LEAD_IN_MS)) : 0;
  const inputs = ["-y", "-hide_banner", "-loglevel", "error"];
  if (headTrimMs > 0) inputs.push("-ss", (headTrimMs / 1000).toFixed(3));
  inputs.push("-i", webm);
  const filters = [];
  const mixLabels = [];
  let n = 0;
  let audioEndMs = 0; // when the last scene's narration ends, in video-ms
  for (let i = 0; i < audio.length; i += 1) {
    if (!audio[i]?.path || !existsSync(audio[i].path)) continue;
    inputs.push("-i", audio[i].path);
    n += 1;
    const off = Math.max(0, Math.round((offsetsMs[i] ?? 0) - headTrimMs));
    filters.push(`[${n}:a]adelay=${off}|${off}[a${n}]`);
    mixLabels.push(`[a${n}]`);
    audioEndMs = Math.max(audioEndMs, off + (audio[i].durationMs || 0));
  }
  if (!n) throw new Error("no scene audio to mux");

  // Playwright's webm duration can be SHORTER than wall-clock for static pages,
  // which used to truncate the final narration. Pad the video by cloning its
  // last frame past the last voice, then cut the output exactly at the voice end
  // (+ a short tail) — so every scene's narration plays fully, with no dead air.
  const outSec = ((audioEndMs + 900) / 1000).toFixed(2);
  filters.unshift(`[0:v]scale=${videoSize.width}:${videoSize.height},format=yuv420p,tpad=stop_mode=clone:stop_duration=${outSec}[v]`);
  filters.push(`${mixLabels.join("")}amix=inputs=${n}:normalize=0:dropout_transition=0[aout]`);

  execFileSync("ffmpeg", [
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    "-t", outSec, // output length = last narration end (+tail); video is padded to reach it
    out,
  ], { stdio: "inherit" });
}

// ═════════════════════════════════════════════════════════════════════════
// TTS layer  —  ENGINE[lang] dispatch; NO local fallback
// ═════════════════════════════════════════════════════════════════════════
async function ensureSceneAudio(slug, lang) {
  const scenario = getScenario(slug);
  const units = unitsOf(scenario);
  const dir = resolve(audioRoot, `${slug}.${lang}`);
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (let i = 0; i < units.length; i += 1) {
    const text = scenario.scenes
      ? (localized(units[i].voice, lang) || localized(units[i].heading, lang))
      : sceneText(scenario, units[i], lang);
    const mp3 = resolve(dir, `scene-${String(i + 1).padStart(2, "0")}.mp3`);
    if (!existsSync(mp3) || FORCE) {
      await tts(text, lang, mp3);
    }
    if (!scenario.scenes) units[i].__lang = lang; // for the declarative "fill" action
    out.push({ path: mp3, durationMs: Math.round(ffprobeDuration(mp3) * 1000) });
  }
  return out;
}

async function tts(text, lang, outMp3) {
  const engine = ENGINE[lang];
  if (engine === "gemini") return geminiTTS(text, outMp3);
  if (engine === "azure") return azureTTS(text, lang, outMp3);
  throw new Error(`No TTS engine mapped for lang "${lang}" (ENGINE=${JSON.stringify(ENGINE)})`);
}

// Gemini native TTS → base64 L16 PCM 24k mono → mp3. Honors the fixed ~60s
// preview-model window on 429 (short back-offs are useless — the window is
// fixed), retrying up to geminiMaxRetries.
async function geminiTTS(text, outMp3) {
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice } } },
    },
  };
  const nKeys = Math.max(1, geminiKeys.length);
  const throwIfAllExhausted = () => {
    if (gExhausted.size >= nKeys) {
      const err = new Error(`daily TTS quota reached on all ${nKeys} Gemini key(s)`);
      err.code = "GEMINI_DAILY_QUOTA";
      throw err;
    }
  };
  const rotate = () => { let g = 0; do { gKeyIdx = (gKeyIdx + 1) % nKeys; } while (gExhausted.has(gKeyIdx) && g++ < nKeys); };
  const maxAttempts = geminiMaxRetries * nKeys;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAllExhausted();
    while (gExhausted.has(gKeyIdx)) gKeyIdx = (gKeyIdx + 1) % nKeys;
    const keyNo = gKeyIdx + 1;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKeys[gKeyIdx]}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000), // never hang forever on a stalled connection
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));

    if (res.status === 429) {
      const b = (await res.text?.().catch(() => "")) || "";
      const retrySec = parseRetrySeconds(res, b);
      // Daily quota (RPD) on THIS key → mark it exhausted and FAIL OVER to the
      // next key. Only when EVERY key is daily-exhausted do we stop the run
      // gracefully (already-generated audio + videos are kept; re-run resumes).
      if (retrySec != null && retrySec > 120) {
        gExhausted.add(gKeyIdx);
        console.log(`      ⏳ Gemini key #${keyNo} daily quota reached${nKeys > 1 ? ` — failing over (${gExhausted.size}/${nKeys} keys exhausted)` : ""}`);
        throwIfAllExhausted();
        rotate();
        continue;
      }
      // Per-minute (RPM) throttle → if another key exists, switch; else wait.
      if (nKeys > 1) { rotate(); await sleep(600); continue; }
      const wait = Math.min(retrySec != null ? retrySec * 1000 : geminiWindowMs, geminiWindowMs) + 500;
      console.log(`      ⏳ Gemini 429 (rate/min) — waiting ${Math.round(wait / 1000)}s (attempt ${attempt}/${maxAttempts})`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text?.().catch(() => "")) || "";
      // Retry transient 5xx a couple of times; otherwise fail (no local fallback).
      if (res.status >= 500 && attempt < maxAttempts) { await sleep(3000); continue; }
      throw new Error(`Gemini TTS ${res.status} (key #${keyNo}): ${String(detail).slice(0, 300)}`);
    }

    const json = await res.json();
    const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const b64 = part?.inlineData?.data;
    if (!b64) throw new Error(`Gemini TTS returned no audio: ${JSON.stringify(json).slice(0, 300)}`);
    const pcm = resolve(dirname(outMp3), `${basename(outMp3)}.pcm`);
    writeFileSync(pcm, Buffer.from(b64, "base64"));
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
      "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm,
      "-codec:a", "libmp3lame", "-q:a", "3", outMp3], { stdio: "inherit" });
    rmSync(pcm, { force: true });
    await sleep(1000); // gentle spacing between successful calls
    return;
  }
  throw new Error(`Gemini TTS exhausted ${maxAttempts} attempts across ${nKeys} key(s)`);
}

// Azure Speech (English only) → mp3.
async function azureTTS(text, lang, outMp3) {
  const voice = azureVoices[lang] || azureVoices.en;
  const xmlLang = azureLangs[lang] || "en-US";
  const url = azureEndpoint
    ? `${azureEndpoint}/tts/cognitiveservices/v1`
    : `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = [
    `<speak version="1.0" xml:lang="${xmlLang}" xmlns="http://www.w3.org/2001/10/synthesis">`,
    `  <voice name="${voice}"><prosody rate="-4%">${escapeXml(text)}</prosody></voice>`,
    "</speak>",
  ].join("\n");
  const delays = [0, 2000, 6000, 12000];
  let lastErr;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await sleep(delays[attempt]);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": azureFormat,
        "User-Agent": "leaddrive-produce-guides",
      },
      body: ssml,
      signal: AbortSignal.timeout(45000), // never hang forever on a stalled connection
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (res.ok) {
      writeFileSync(outMp3, Buffer.from(await res.arrayBuffer()));
      return;
    }
    lastErr = new Error(`Azure Speech ${res.status}: ${String(await res.text?.().catch(() => "")).slice(0, 200)}`);
    console.warn(`      ⚠ ${lastErr.message} (retry ${attempt + 1}/${delays.length})`);
  }
  throw lastErr; // never falls back to local TTS
}

function sceneText(scenario, step, lang) {
  // Each scene is voiced by its own narration line; the scenario `goal` is
  // generic boilerplate shared by every section, so it is intentionally not
  // spoken (it would repeat identically across all 139 videos).
  return localized(step.voice, lang)
    || localized(step.caption, lang)
    || localized(step.heading, lang)
    || localized(scenario.title, lang)
    || "";
}

// ═════════════════════════════════════════════════════════════════════════
// Browser plumbing (login, locale, cursor overlay, hidden widget)
// ═════════════════════════════════════════════════════════════════════════
// Log in and confirm a session; retry a few times so a transient /auth 429
// (login throttler) or cold-start doesn't abort a whole language.
async function loginWithRetry(api, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    if (i) await sleep(2000 * i);
    try {
      const csrf = await (await api.get("/api/auth/csrf")).json();
      // BudgetPro uses a next-auth Credentials provider keyed on email+password
      // only (no organization slug). Prefer RECORDER_* vars; fall back to the
      // reference's HELP_VIDEO_* names so either set works.
      await api.post("/api/auth/callback/credentials", {
        form: {
          csrfToken: csrf.csrfToken,
          email: process.env.RECORDER_EMAIL || process.env.HELP_VIDEO_EMAIL || "",
          password: process.env.RECORDER_PASSWORD || process.env.HELP_VIDEO_PASSWORD || "",
          redirect: "false",
          json: "true",
        },
        maxRedirects: 0,
      });
      const session = await (await api.get("/api/auth/session")).json().catch(() => ({}));
      const userId = session?.user?.id || session?.userId;
      if (userId) return userId;
      lastErr = new Error("login succeeded but no session user");
    } catch (error) {
      lastErr = error;
    }
    console.warn(`  ⚠ login attempt ${i + 1}/${attempts} failed: ${lastErr.message}`);
  }
  throw new Error(`login failed after ${attempts} attempts: ${lastErr?.message}`);
}

async function installInitScripts(context, lang, userId) {
  const completedTours = readTourIds();
  await context.addInitScript(({ lang, userId, completedTours }) => {
    try {
      // Keep the document locale in step with the UI language so CSS
      // text-transform:uppercase can't miscast under a hard-coded <html lang>.
      document.documentElement.lang = lang;
      // Belt: mark every tour completed so it never auto-starts. (The hide CSS
      // in applyGuideStyles is the reliable kill; this just reduces churn.)
      localStorage.setItem("leaddrive_tours_anonymous", JSON.stringify(completedTours));
      localStorage.setItem(`leaddrive_tours_${userId}`, JSON.stringify(completedTours));
      sessionStorage.setItem("ld_hide_help_widget", "1");
    } catch {}
  }, { lang, userId, completedTours });
}

// Inject the hide/cursor CSS via addStyleTag (into <head>, AFTER load) — a
// document-start <style> gets stripped by React hydration, but a post-load
// <head> style persists. Called right after each navigation, before the poster.
async function applyGuideStyles(page) {
  await page.addStyleTag({ content: GUIDE_CSS }).catch(() => {});
}

// Actively dismiss the auto-started product tour. The tour (tour-step.tsx)
// renders the popover CARD as its own fixed element (inline z-index 10002),
// SEPARATE from the full-screen backdrop — so we target the small fixed node
// with z-index >= 10000 that CONTAINS a button and click its first button (the
// × → onSkip), which marks the tour complete and unmounts both card + backdrop.
// Retries a few times in case the card animates in late. Client-only (no server
// mutation), safe under READONLY.
// Collapse the left navigation sidebar so each guide video focuses on the
// section's content rather than the (identical, distracting) menu. The sidebar's
// collapsed flag is React state reset to expanded on every full page.goto, so
// this runs after each navigation; a fresh page is always expanded, so the
// single toggle click is idempotent. Best-effort — a miss just leaves it open.
async function collapseSidebar(page) {
  await page.locator("button:has(svg.lucide-chevron-left)").first()
    .click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function dismissTours(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clicked = await page.evaluate(() => {
      const card = [...document.querySelectorAll("div,section,aside")].find((el) => {
        const cs = getComputedStyle(el);
        return cs.position === "fixed"
          && parseInt(cs.zIndex || "0", 10) >= 10000
          && el.offsetWidth > 0 && el.offsetWidth < window.innerWidth * 0.9
          && el.querySelector("button");
      });
      if (!card) return false;
      card.querySelector("button").click(); // header × → onSkip → tour completes
      return true;
    }).catch(() => false);
    if (!clicked) return;
    await page.waitForTimeout(350);
  }
}

async function injectCursor(page) {
  // The hide/cursor CSS is already present via the init script; here we only
  // (re)create the cursor element + its mousemove follower after navigation.
  await page.evaluate(() => {
    if (!document.getElementById("ld-pilot-cursor")) {
      const cursor = document.createElement("div");
      cursor.id = "ld-pilot-cursor";
      document.body.appendChild(cursor);
      window.addEventListener("mousemove", (e) => {
        cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }, { passive: true });
    }
  }).catch(() => {});
}

async function pulse(page, x, y) {
  await page.evaluate(({ x, y }) => {
    const el = document.createElement("div");
    el.className = "ld-pilot-pulse";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 560);
  }, { x, y }).catch(() => {});
}

// ═════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════
// Cursor-driven helpers passed to hand-authored `do` scenes: they move the
// VISIBLE cursor to a real element, then hover / click / type — so the recording
// shows the cursor purposefully using the section's real controls (not wandering).
function makeHelpers(page) {
  const point = async (sel) => {
    const loc = await firstLocator(page, sel);
    await loc?.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    const box = await loc?.boundingBox().catch(() => null);
    const x = box ? box.x + box.width / 2 : viewport.width / 2;
    const y = box ? box.y + Math.min(box.height / 2, 40) : viewport.height / 2;
    await page.mouse.move(x, y, { steps: 18 });
    return { loc, x, y };
  };
  return {
    firstLocator: (sel) => firstLocator(page, sel),
    sleep,
    async moveTo(sel) { await point(sel); await page.waitForTimeout(200); },
    async hover(sel) { const { loc } = await point(sel); await loc?.hover({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(300); },
    async click(sel) {
      const { loc, x, y } = await point(sel);
      await page.waitForTimeout(250);
      if (READONLY) {
        await loc?.hover({ timeout: 6000 }).catch(() => {});
        await pulse(page, x, y);
        await page.waitForTimeout(400);
        return;
      }
      await (loc?.click({ timeout: 8000 }).catch(() => page.mouse.click(x, y).catch(() => {})));
      await pulse(page, x, y);
      await page.waitForTimeout(400);
    },
    // Explicitly reviewed READONLY-safe interaction. Scenarios may use this
    // only for local view toggles or GET-only controls, and scenario tests pin
    // the exact selector constants. Mutating controls must never be passed.
    async safeClick(sel) {
      if (typeof sel !== "string") {
        throw new Error("safeClick requires one exact selector string");
      }
      const loc = page.locator(sel);
      const count = await loc.count();
      if (count !== 1) {
        throw new Error(`safeClick expected exactly one ${sel}, found ${count}`);
      }
      if (!(await loc.isVisible())) {
        throw new Error(`safeClick target is not visible: ${sel}`);
      }
      await loc.scrollIntoViewIfNeeded({ timeout: 8000 });
      const box = await loc.boundingBox();
      if (!box) throw new Error(`safeClick has no bounding box: ${sel}`);
      const x = box.x + box.width / 2;
      const y = box.y + Math.min(box.height / 2, 40);
      await page.mouse.move(x, y, { steps: 18 });
      await page.waitForTimeout(250);
      await loc.click({ timeout: 8000 });
      await pulse(page, x, y);
      await page.waitForTimeout(400);
    },
    async fill(sel, text) {
      const { loc, x, y } = await point(sel);
      if (READONLY) {
        await loc?.hover({ timeout: 6000 }).catch(() => {});
        await pulse(page, x, y);
        await page.waitForTimeout(400);
        return;
      }
      await loc?.click({ timeout: 6000 }).catch(() => {});
      await loc?.selectText().catch(() => {});
      await loc?.pressSequentially(String(text), { delay: 26, timeout: 20000 }).catch(() => {});
    },
  };
}

async function firstLocator(page, selectorOrList) {
  const list = Array.isArray(selectorOrList) ? selectorOrList : [selectorOrList];
  for (const sel of list.filter(Boolean)) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) return loc;
  }
  const main = page.locator("main").first();
  if (await main.count().catch(() => 0)) return main;
  return page.locator("body").first();
}

function videoOut(slug, lang) { return resolve(outDir, `${slug}.${lang}.VOICE.mp4`); }
function posterOut(slug, lang) { return resolve(outDir, `${slug}.${lang}.poster.jpg`); }

function isValidRender(mp4, poster) {
  if (!existsSync(mp4) || !existsSync(poster)) return false;
  try {
    const meta = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
      "-of", "json", mp4,
    ], { encoding: "utf8" }));
    const v = meta.streams?.find((s) => s.codec_type === "video");
    const hasAudio = meta.streams?.some((s) => s.codec_type === "audio");
    return Boolean(hasAudio) && v?.width === videoSize.width && v?.height === videoSize.height
      && Number(meta.format?.duration || 0) >= 6;
  } catch { return false; }
}

function ffprobeDuration(file) {
  return Number(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ], { encoding: "utf8" }).trim()) || 0;
}

function readTourIds() {
  try {
    const text = readFileSync(tourDefinitionsPath, "utf8");
    return [...text.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\{/gm)].map((m) => m[1]);
  } catch { return []; }
}

// Warn (don't fail) if the live nav has items with no matching scenario, so a
// newly-added section can't ship without a guide. Matches primarily on the
// kebab-cased tKey (the scenario keys track tKeys, not raw hrefs), with an
// href fallback — this is accurate enough to flag genuinely-missing sections
// without the false positives a naive href→slug map produces.
function reportNavCoverage() {
  let items = [];
  try {
    const src = readFileSync(navItemsPath, "utf8");
    items = [...src.matchAll(/href:\s*"([^"]+)"[^}]*?tKey:\s*"([^"]+)"/g)]
      .map((m) => ({ href: m[1], tKey: m[2] }));
  } catch { return; }
  const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const norm = (href) => href.replace(/^\//, "").replace(/\//g, "-");
  const keys = new Set(allSlugs);
  const matched = (it) => {
    const k = kebab(it.tKey);
    const b = norm(it.href);
    return keys.has(k) || keys.has(b)
      || keys.has(k.replace(/-nav$/, "")) || keys.has(b.replace(/-nav$/, ""))
      || allSlugs.some((s) => s === k || s === b
        || b.startsWith(`${s}-`) || k.startsWith(`${s}-`) || s.startsWith(`${b}-`));
  };
  const missing = items.filter((it) => !matched(it));
  console.log(`▶ coverage: ${allSlugs.length} scenarios vs ${items.length} nav items`);
  if (missing.length) {
    console.warn(`  ⚠ ${missing.length} nav route(s) with no scenario — add them to browser-guided.json:`);
    for (const m of missing) console.warn(`    ${m.href}  (tKey: ${m.tKey})`);
  }
}

function localized(value, lang) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[lang] || value.en || value.ru || value.az || "";
}

// Seconds until Gemini will accept another request: prefer the Retry-After
// header, else parse the 429 body ("Please retry in 17h51m03s" style).
function parseRetrySeconds(res, body) {
  const h = res.headers?.get?.("retry-after");
  if (h && Number.isFinite(Number(h))) return Number(h);
  const m = String(body || "").match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Math.round(Number(m[3] || 0));
}

function basename(p) { return p.split("/").pop(); }
function rel(p) { return p.replace(`${repoRoot}/`, ""); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(msg) { if (process.env.GUIDE_VERBOSE) console.log(msg); }
function envFlag(name) { return ["1", "true", "yes"].includes(String(process.env[name] || "").toLowerCase()); }

function escapeXml(v) {
  return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function firstEnv(...names) {
  for (const n of names) { if (process.env[n]) return process.env[n]; }
  return "";
}

function loadProjectEnv() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(repoRoot, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key] !== undefined) continue;
      let val = raw.trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}
