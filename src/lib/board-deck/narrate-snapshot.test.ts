/**
 * Phase 7.G Turn XLVI (Phase E.2) — narrator unit tests.
 *
 * Mocks the Anthropic client. Locks: prompt structure (top-N
 * composites + alerts grouped by severity), happy-path JSON validation,
 * malformed JSON / missing fields / max_tokens / no-text-block all
 * throw. Mirrors the variance-explainer.test.ts pattern.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "mock-model",
  getAnthropicClient: vi.fn(),
}));

import {
  buildNarrationPrompt,
  runNarration,
  isNarrationLanguage,
  NARRATION_PROMPT_VERSION,
  type NarrationInput,
} from "./narrate-snapshot";
import { getAnthropicClient } from "@/lib/ai/client";
import type { BoardSnapshot } from "./build-snapshot";

const mockedGetClient = vi.mocked(getAnthropicClient);

function makeSnapshot(
  overrides: Partial<BoardSnapshot> = {},
): BoardSnapshot {
  const ops = [
    {
      id: "co_1",
      code: "AAC",
      name: "AAC Industrial",
      industry: "industrial",
      level: 2,
      isActive: true,
      role: "operational",
      sortOrder: 1,
    },
    {
      id: "co_2",
      code: "HLTN",
      name: "Hilton Baku",
      industry: "hospitality",
      level: 2,
      isActive: true,
      role: "operational",
      sortOrder: 2,
    },
  ];
  const indicators = [
    {
      id: "ind_1",
      code: "IND_OPEX_RATIO",
      nameEn: "OpEx Ratio",
      direction: "lower_better",
      unit: "%",
      sortOrder: 1,
    },
  ];
  return {
    org: { name: "FO Holding", slug: "fo", settings: null },
    period: "2026",
    generatedAt: "2026-05-07T10:00:00.000Z",
    operational: ops,
    indicators,
    cells: [],
    compositeByCompany: new Map([
      [
        "co_1",
        { score: 42, band: "amber", contributingCount: 5, totalCount: 5 },
      ],
      [
        "co_2",
        { score: 78, band: "green", contributingCount: 5, totalCount: 5 },
      ],
    ]),
    countsByCompany: new Map(),
    matches: [],
    matchesBySeverity: {
      critical: [
        {
          ruleId: "company-mostly-red",
          ruleName: "Mostly red",
          severity: "critical",
          message: "AAC has 4 red indicators",
          affectedCompanyIds: ["co_1"],
        },
      ],
      warning: [],
      info: [],
    },
    idToCode: new Map([
      ["co_1", "AAC"],
      ["co_2", "HLTN"],
    ]),
    cellByKey: new Map(),
    totals: {
      operational: 2,
      indicators: 1,
      cells: 2,
      green: 4,
      amber: 1,
      red: 1,
    },
    ...overrides,
  } as BoardSnapshot;
}

function makeInput(
  overrides: Partial<NarrationInput> = {},
): NarrationInput {
  return {
    snapshot: makeSnapshot(),
    language: "en",
    ...overrides,
  };
}

interface FakeMessage {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

function fakeResponse(
  text: string,
  overrides: Partial<FakeMessage> = {},
): FakeMessage {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    model: "claude-sonnet-4-5-20250929",
    usage: { input_tokens: 1500, output_tokens: 700 },
    ...overrides,
  };
}

function installFakeClient(
  response: FakeMessage | (() => Promise<FakeMessage>),
) {
  const create =
    typeof response === "function"
      ? vi.fn(response)
      : vi.fn().mockResolvedValue(response);
  mockedGetClient.mockReturnValue({
    messages: { create },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return create;
}

beforeEach(() => {
  mockedGetClient.mockReset();
});

// ---------------------------------------------------------------------------
// isNarrationLanguage helper
// ---------------------------------------------------------------------------

describe("isNarrationLanguage", () => {
  it("accepts en/ru/az", () => {
    expect(isNarrationLanguage("en")).toBe(true);
    expect(isNarrationLanguage("ru")).toBe(true);
    expect(isNarrationLanguage("az")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isNarrationLanguage("EN")).toBe(false);
    expect(isNarrationLanguage("fr")).toBe(false);
    expect(isNarrationLanguage("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildNarrationPrompt — pure helper
// ---------------------------------------------------------------------------

describe("buildNarrationPrompt", () => {
  it("includes org name, period, and totals", () => {
    const prompt = buildNarrationPrompt(makeInput());
    expect(prompt).toContain("FO Holding");
    expect(prompt).toContain("Period: 2026");
    expect(prompt).toContain("Green / Amber / Red: 4 / 1 / 1");
  });

  it("orders composites worst-first (lowest score on top)", () => {
    const prompt = buildNarrationPrompt(makeInput());
    const aacIdx = prompt.indexOf("AAC");
    const hltnIdx = prompt.indexOf("HLTN");
    expect(aacIdx).toBeGreaterThan(-1);
    expect(hltnIdx).toBeGreaterThan(-1);
    // AAC (score 42) should appear BEFORE HLTN (score 78).
    expect(aacIdx).toBeLessThan(hltnIdx);
  });

  it("groups alerts by severity with counts", () => {
    const prompt = buildNarrationPrompt(makeInput());
    expect(prompt).toContain("CRITICAL (1 total)");
    expect(prompt).toContain("WARNING (0 total)");
    expect(prompt).toContain("INFO (0 total)");
    expect(prompt).toContain("AAC has 4 red indicators");
  });

  it("renders empty-alert sections as `(none)`", () => {
    const prompt = buildNarrationPrompt(
      makeInput({
        snapshot: makeSnapshot({
          matchesBySeverity: { critical: [], warning: [], info: [] },
        }),
      }),
    );
    expect(prompt).toMatch(/CRITICAL \(0 total\):\s*\(none\)/);
  });

  it("language label is included in output", () => {
    const promptEn = buildNarrationPrompt(makeInput({ language: "en" }));
    const promptRu = buildNarrationPrompt(makeInput({ language: "ru" }));
    const promptAz = buildNarrationPrompt(makeInput({ language: "az" }));
    expect(promptEn).toContain("English");
    expect(promptRu).toContain("Russian");
    expect(promptAz).toContain("Azerbaijani");
  });

  it("caps composite list at 12 entries", () => {
    // 20 sub-cos.
    const operational = Array.from({ length: 20 }, (_, i) => ({
      id: `co_${i}`,
      code: `CO${i}`,
      name: `Company ${i}`,
      industry: "industrial",
      level: 2,
      isActive: true,
      role: "operational" as const,
      sortOrder: i,
    }));
    const compositeByCompany = new Map(
      operational.map((c, i) => [
        c.id,
        {
          score: i,
          band: "red" as const,
          contributingCount: 5,
          totalCount: 5,
        },
      ]),
    );
    const prompt = buildNarrationPrompt(
      makeInput({
        snapshot: makeSnapshot({ operational, compositeByCompany }),
      }),
    );
    // CO0..CO11 should appear; CO12+ should not.
    expect(prompt).toContain("CO0 (industrial)");
    expect(prompt).toContain("CO11 (industrial)");
    expect(prompt).not.toContain("CO12 (industrial)");
  });
});

// ---------------------------------------------------------------------------
// runNarration — happy path
// ---------------------------------------------------------------------------

const VALID_RESPONSE = {
  headline: "Hospitality recovery offsets industrial drag this period.",
  paragraphs: [
    "Para 1 — drivers.",
    "Para 2 — concentration.",
    "Para 3 — board actions.",
  ],
};

describe("runNarration — happy path", () => {
  it("returns shaped output with usage + modelName + promptVersion", async () => {
    installFakeClient(fakeResponse(JSON.stringify(VALID_RESPONSE)));
    const out = await runNarration(makeInput());
    expect(out.headline).toBe(VALID_RESPONSE.headline);
    expect(out.paragraphs).toHaveLength(3);
    expect(out.paragraphs[0]).toBe("Para 1 — drivers.");
    expect(out.modelName).toBe("claude-sonnet-4-5-20250929");
    expect(out.usage).toEqual({ inputTokens: 1500, outputTokens: 700 });
    expect(out.promptVersion).toBe(NARRATION_PROMPT_VERSION);
  });

  it("strips markdown fences in the response", async () => {
    const wrapped = "```json\n" + JSON.stringify(VALID_RESPONSE) + "\n```";
    installFakeClient(fakeResponse(wrapped));
    const out = await runNarration(makeInput());
    expect(out.headline).toBe(VALID_RESPONSE.headline);
  });

  it("trims whitespace + caps headline at 200 chars when soft over", async () => {
    const longHeadline = "x".repeat(150); // > 120 soft cap, ≤ 240 hard cap
    installFakeClient(
      fakeResponse(
        JSON.stringify({ ...VALID_RESPONSE, headline: longHeadline }),
      ),
    );
    const out = await runNarration(makeInput());
    expect(out.headline.length).toBe(150);
  });

  it("passes language through to the prompt", async () => {
    const create = installFakeClient(
      fakeResponse(JSON.stringify(VALID_RESPONSE)),
    );
    await runNarration(makeInput({ language: "ru" }));
    const callArg = create.mock.calls[0][0];
    expect(callArg.messages[0].content).toContain("Russian");
  });

  it("respects opts.maxTokens override", async () => {
    const create = installFakeClient(
      fakeResponse(JSON.stringify(VALID_RESPONSE)),
    );
    await runNarration(makeInput(), { maxTokens: 1024 });
    const callArg = create.mock.calls[0][0];
    expect(callArg.max_tokens).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// runNarration — failure modes
// ---------------------------------------------------------------------------

describe("runNarration — failure modes", () => {
  it("throws on max_tokens stop_reason", async () => {
    installFakeClient(
      fakeResponse(JSON.stringify(VALID_RESPONSE), {
        stop_reason: "max_tokens",
      }),
    );
    await expect(runNarration(makeInput())).rejects.toThrow(/max_tokens/);
  });

  it("throws on empty content array", async () => {
    installFakeClient({
      content: [],
      stop_reason: "end_turn",
      model: "mock",
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    await expect(runNarration(makeInput())).rejects.toThrow(/no text content/);
  });

  it("throws on malformed JSON", async () => {
    installFakeClient(fakeResponse("this is not json"));
    await expect(runNarration(makeInput())).rejects.toThrow(/valid JSON/);
  });

  it("throws on missing 'headline'", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({ paragraphs: VALID_RESPONSE.paragraphs }),
      ),
    );
    await expect(runNarration(makeInput())).rejects.toThrow(/headline/);
  });

  it("throws when 'paragraphs' is not exactly three entries", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          headline: VALID_RESPONSE.headline,
          paragraphs: ["only one"],
        }),
      ),
    );
    await expect(runNarration(makeInput())).rejects.toThrow(
      /EXACTLY three/,
    );
  });

  it("throws when a paragraph is empty string", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          headline: VALID_RESPONSE.headline,
          paragraphs: ["a", "", "c"],
        }),
      ),
    );
    await expect(runNarration(makeInput())).rejects.toThrow(/non-empty/);
  });

  it("throws when headline exceeds 240 char hard cap", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          ...VALID_RESPONSE,
          headline: "x".repeat(300),
        }),
      ),
    );
    await expect(runNarration(makeInput())).rejects.toThrow(/too long/);
  });

  it("propagates SDK call errors", async () => {
    installFakeClient(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(runNarration(makeInput())).rejects.toThrow(/ECONNRESET/);
  });
});
