/**
 * Tests for `forecast-explainer.ts`.
 * Mocks the Anthropic client (vi.mock) — covers prompt structure +
 * response-handling edge cases (max_tokens, malformed JSON, shape
 * violations, language switching, array capping).
 *
 * Mirror of variance-explainer.test.ts pattern.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ForecastExplainerInput } from "./forecast-explainer";

vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "mock-model",
  getAnthropicClient: vi.fn(),
}));

import {
  buildForecastPrompt,
  runForecastExplainer,
  FORECAST_EXPLAINER_PROMPT_VERSION,
} from "./forecast-explainer";
import { getAnthropicClient } from "@/lib/ai/client";

const mockedGetClient = vi.mocked(getAnthropicClient);

function makeInput(
  overrides: Partial<ForecastExplainerInput> = {},
): ForecastExplainerInput {
  return {
    indicator: {
      code: "IND_NET_MARGIN",
      nameEn: "Net Margin",
      unit: "%",
      direction: "higher_better",
      hintTemplateEn:
        "Net margin {value}%. Above 8% healthy for industrial.",
    },
    current: { value: 12.5, status: "green", period: "2026" },
    forecast: {
      predicted: 9.5,
      confidence: "high",
      slope: -0.4,
      intercept: 14.5,
      r2: 0.82,
      contributingCount: 12,
      method: "linear-regression-v1",
    },
    series: [13, 12.6, 12.2, 11.8, 11.4, 11, 10.7, 10.3, 10, 9.8, 9.6, 9.5],
    company: {
      name: "AAC-MAIN",
      industry: "industrial",
      tags: [],
    },
    language: "en",
    ...overrides,
  };
}

function fakeResponse(
  text: string,
  stopReason: "end_turn" | "max_tokens" = "end_turn",
  model?: string,
) {
  const out: {
    content: { type: string; text: string }[];
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
    model?: string;
  } = {
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    usage: { input_tokens: 200, output_tokens: 80 },
  };
  if (model !== undefined) out.model = model;
  return out;
}

function installFakeClient(response: unknown) {
  mockedGetClient.mockReturnValue({
    messages: { create: vi.fn().mockResolvedValue(response) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

beforeEach(() => {
  mockedGetClient.mockReset();
});

describe("buildForecastPrompt — pure shape", () => {
  it("includes indicator code + name + current value + forecast", () => {
    const out = buildForecastPrompt(makeInput());
    expect(out).toContain("IND_NET_MARGIN");
    expect(out).toContain("Net Margin");
    expect(out).toContain("12.50"); // current
    expect(out).toContain("9.50"); // predicted
    expect(out).toContain("R²: 0.820");
  });

  it("includes hint template when present", () => {
    const out = buildForecastPrompt(makeInput());
    expect(out).toContain("Above 8% healthy");
  });

  it("renders trailing series compactly", () => {
    const out = buildForecastPrompt(
      makeInput({ series: [10, null, 12, null, 14] }),
    );
    expect(out).toContain("[10.00, —, 12.00, —, 14.00]");
  });

  it("includes company tags when present (admin / cost_centre / rollup_sourced)", () => {
    const out = buildForecastPrompt(
      makeInput({
        company: {
          name: "FO Holding",
          industry: null,
          tags: ["admin", "rollup_sourced"],
        },
      }),
    );
    expect(out).toContain("Tags: admin, rollup_sourced");
  });

  it("language switches between EN / RU / AZ in output instructions", () => {
    expect(buildForecastPrompt(makeInput({ language: "en" }))).toContain(
      "English",
    );
    expect(buildForecastPrompt(makeInput({ language: "ru" }))).toContain(
      "Russian",
    );
    expect(buildForecastPrompt(makeInput({ language: "az" }))).toContain(
      "Azerbaijani",
    );
  });

  it("renders confidence band + n/series.length", () => {
    const out = buildForecastPrompt(makeInput());
    expect(out).toContain("confidence band: high");
    expect(out).toContain("n=12 of 12 slots");
  });

  it("forecast slope rendered with 4 decimal precision", () => {
    const out = buildForecastPrompt(
      makeInput({
        forecast: {
          predicted: 1,
          confidence: "low",
          slope: 0.0125,
          intercept: 0,
          r2: 0.05,
          contributingCount: 3,
          method: "linear-regression-v1",
        },
      }),
    );
    expect(out).toContain("0.0125");
  });
});

describe("runForecastExplainer — happy path", () => {
  it("parses well-formed JSON and returns a typed ForecastExplainerOutput", async () => {
    const json = JSON.stringify({
      narrative:
        "Net margin trending from 13% to forecast 9.5% — a 3.5pp compression over 12 months driven by COGS inflation.",
      driverHypotheses: [
        "COGS inflation +18% YoY (likely raw material price-through)",
        "Revenue ramp slower than cost ramp (operating leverage compressed)",
      ],
      riskFactors: [
        "Iran sanctions tightening would push feedstock cost +20%",
        "AZN devaluation 15% would compress import margins further",
      ],
      confidence: 0.78,
    });
    installFakeClient(fakeResponse(json, "end_turn", "claude-sonnet-4-5-20250929"));
    const out = await runForecastExplainer(makeInput());
    expect(out.narrative).toContain("Net margin trending");
    expect(out.driverHypotheses).toHaveLength(2);
    expect(out.riskFactors).toHaveLength(2);
    expect(out.confidence).toBe(0.78);
    expect(out.modelName).toBe("claude-sonnet-4-5-20250929");
    expect(out.promptVersion).toBe(FORECAST_EXPLAINER_PROMPT_VERSION);
    expect(out.usage).toEqual({ inputTokens: 200, outputTokens: 80 });
  });

  it("strips markdown fences if the model wraps the JSON", async () => {
    const fenced = '```json\n{"narrative":"Trend.","driverHypotheses":[],"riskFactors":[],"confidence":0.5}\n```';
    installFakeClient(fakeResponse(fenced));
    const out = await runForecastExplainer(makeInput());
    expect(out.narrative).toBe("Trend.");
  });

  it("caps driverHypotheses + riskFactors at 3 even if model returns more", async () => {
    const json = JSON.stringify({
      narrative: "x",
      driverHypotheses: ["a", "b", "c", "d", "e"],
      riskFactors: ["1", "2", "3", "4"],
      confidence: 0.5,
    });
    installFakeClient(fakeResponse(json));
    const out = await runForecastExplainer(makeInput());
    expect(out.driverHypotheses).toHaveLength(3);
    expect(out.riskFactors).toHaveLength(3);
  });

  it("filters empty-string array entries after trim", async () => {
    const json = JSON.stringify({
      narrative: "x",
      driverHypotheses: ["valid", "  ", "also valid"],
      riskFactors: [""],
      confidence: 0.5,
    });
    installFakeClient(fakeResponse(json));
    const out = await runForecastExplainer(makeInput());
    expect(out.driverHypotheses).toEqual(["valid", "also valid"]);
    expect(out.riskFactors).toEqual([]);
  });

  it("falls back to AI_MODEL constant when SDK omits model field", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          narrative: "x",
          driverHypotheses: [],
          riskFactors: [],
          confidence: 0.5,
        }),
      ),
    );
    const out = await runForecastExplainer(makeInput());
    expect(out.modelName).toBe("mock-model");
  });
});

describe("runForecastExplainer — error paths", () => {
  it("throws explicit error when stop_reason=max_tokens", async () => {
    installFakeClient(fakeResponse('{"partial":', "max_tokens"));
    await expect(runForecastExplainer(makeInput())).rejects.toThrow(
      /truncated at max_tokens/,
    );
  });

  it("throws when response has no text content", async () => {
    installFakeClient({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 0 },
    });
    await expect(runForecastExplainer(makeInput())).rejects.toThrow(
      /no text content/,
    );
  });

  it("throws when JSON not findable in response", async () => {
    installFakeClient(fakeResponse("definitely no JSON here at all"));
    await expect(runForecastExplainer(makeInput())).rejects.toThrow(
      /did not contain valid JSON/,
    );
  });

  it("throws when narrative is missing", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          driverHypotheses: [],
          riskFactors: [],
          confidence: 0.5,
        }),
      ),
    );
    await expect(runForecastExplainer(makeInput())).rejects.toThrow(
      /missing or empty 'narrative'/,
    );
  });

  it("throws when driverHypotheses is not array of strings", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          narrative: "x",
          driverHypotheses: [1, 2, 3],
          riskFactors: [],
          confidence: 0.5,
        }),
      ),
    );
    await expect(runForecastExplainer(makeInput())).rejects.toThrow(
      /driverHypotheses.*string\[\]/,
    );
  });

  it("throws when confidence out of [0, 1]", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          narrative: "x",
          driverHypotheses: [],
          riskFactors: [],
          confidence: 1.5,
        }),
      ),
    );
    await expect(runForecastExplainer(makeInput())).rejects.toThrow(
      /confidence.*\[0, 1\]/,
    );
  });

  it("throws when confidence is non-numeric", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          narrative: "x",
          driverHypotheses: [],
          riskFactors: [],
          confidence: "high",
        }),
      ),
    );
    await expect(runForecastExplainer(makeInput())).rejects.toThrow(
      /confidence.*number in \[0, 1\]/,
    );
  });
});
