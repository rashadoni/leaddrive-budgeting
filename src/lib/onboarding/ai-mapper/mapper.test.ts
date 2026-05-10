/**
 * Integration tests for `runMapper` with a mocked Anthropic client.
 * Covers response-handling edge cases that ate production turns 1-2:
 *   - max_tokens truncation
 *   - malformed JSON
 *   - markdown fence stripping
 *   - prose around JSON
 *   - per-element shape validation (numeric role, out-of-range confidence,
 *     wrong severity enum)
 *   - happy path returns `MappingProposal` with usage
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MapperInput } from './types';

// vi.mock must be hoisted ABOVE imports that use the mocked module.
// Phase 7.G Turn LXXXXV — added hasAnthropicKey export so getLLMService()
// factory's pre-flight check passes through to AnthropicLLMService impl
// (which then uses the mocked getAnthropicClient below).
vi.mock('@/lib/ai/client', () => ({
  AI_MODEL: 'mock-model',
  getAnthropicClient: vi.fn(),
  hasAnthropicKey: vi.fn(() => true),
}));

import { runMapper } from './mapper';
import { getAnthropicClient } from '@/lib/ai/client';
import { resetLLMServiceForTests } from '@/lib/llm';

// Reset LLM factory singleton before each test so the mock is re-resolved.
beforeEach(() => {
  resetLLMServiceForTests();
});

const mockedGetClient = vi.mocked(getAnthropicClient);

function makeInput(): MapperInput {
  return {
    sourceFile: 'test.xlsx',
    sourceSheet: 'Sheet1',
    columns: [
      { index: 0, headerText: 'KOD', samples: ['601-04', '701-01'] },
      { index: 1, headerText: 'Label', samples: ['Revenue', 'COGS'] },
    ],
    sampleRows: [['KOD', 'Label'], ['601-04', 'Revenue']],
  };
}

/** Build a fake Anthropic response with the given text content. */
function fakeResponse(text: string, stopReason: 'end_turn' | 'max_tokens' = 'end_turn') {
  return {
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
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

describe('runMapper — happy path', () => {
  it('parses well-formed JSON response into MappingProposal', async () => {
    const responseJson = JSON.stringify({
      summary: 'A simple P&L',
      overallConfidence: 0.85,
      columns: [
        { sourceIndex: 0, role: 'code', confidence: 0.95, reasoning: 'KOD-shaped values' },
        { sourceIndex: 1, role: 'label', confidence: 0.9, reasoning: 'String labels' },
      ],
      anomalies: [],
    });
    installFakeClient(fakeResponse(responseJson));

    const result = await runMapper(makeInput());

    expect(result.summary).toBe('A simple P&L');
    expect(result.overallConfidence).toBe(0.85);
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].role).toBe('code');
    expect(result.anomalies).toEqual([]);
    expect(result.sourceFile).toBe('test.xlsx');
    expect(result.sourceSheet).toBe('Sheet1');
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('strips markdown fences before parsing', async () => {
    const responseJson = '```json\n' + JSON.stringify({
      summary: 'fenced',
      overallConfidence: 0.7,
      columns: [],
      anomalies: [],
    }) + '\n```';
    installFakeClient(fakeResponse(responseJson));

    const result = await runMapper(makeInput());
    expect(result.summary).toBe('fenced');
  });

  it('extracts JSON from prose around it', async () => {
    const responseJson = 'Sure, here is the analysis:\n\n' + JSON.stringify({
      summary: 'with prose',
      overallConfidence: 0.6,
      columns: [],
      anomalies: [],
    }) + '\n\nLet me know if you need clarification.';
    installFakeClient(fakeResponse(responseJson));

    const result = await runMapper(makeInput());
    expect(result.summary).toBe('with prose');
  });

  it('concatenates multiple text blocks (Anthropic streaming-style response)', async () => {
    const part1 = '{"summary": "split", "overallConfidence": 0.5, ';
    const part2 = '"columns": [], "anomalies": []}';
    mockedGetClient.mockReturnValue({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            { type: 'text', text: part1 },
            { type: 'text', text: part2 },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await runMapper(makeInput());
    expect(result.summary).toBe('split');
  });
});

describe('runMapper — error paths', () => {
  it('throws on max_tokens truncation', async () => {
    installFakeClient(fakeResponse('{"summary": "cut', 'max_tokens'));
    await expect(runMapper(makeInput())).rejects.toThrow(/truncated at max_tokens/);
  });

  it('throws on no text content blocks', async () => {
    mockedGetClient.mockReturnValue({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'tool_use', id: 'x', name: 'fake', input: {} }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await expect(runMapper(makeInput())).rejects.toThrow(/no text content/);
  });

  it('throws on invalid JSON', async () => {
    installFakeClient(fakeResponse('this is not JSON at all'));
    await expect(runMapper(makeInput())).rejects.toThrow(/invalid JSON/);
  });

  it('throws on missing required field', async () => {
    const responseJson = JSON.stringify({
      // summary missing
      overallConfidence: 0.5,
      columns: [],
      anomalies: [],
    });
    installFakeClient(fakeResponse(responseJson));
    await expect(runMapper(makeInput())).rejects.toThrow(/missing required field "summary"/);
  });

  it('throws on columns being non-array', async () => {
    const responseJson = JSON.stringify({
      summary: 'bad',
      overallConfidence: 0.5,
      columns: 'oops',
      anomalies: [],
    });
    installFakeClient(fakeResponse(responseJson));
    await expect(runMapper(makeInput())).rejects.toThrow(/"columns" is not an array/);
  });
});

describe('runMapper — per-element shape validation', () => {
  it('throws when columns[i].role is not a string', async () => {
    const responseJson = JSON.stringify({
      summary: 'bad',
      overallConfidence: 0.5,
      columns: [{ sourceIndex: 0, role: 123, confidence: 0.5, reasoning: 'x' }],
      anomalies: [],
    });
    installFakeClient(fakeResponse(responseJson));
    await expect(runMapper(makeInput())).rejects.toThrow(/columns\[0\]\.role must be string/);
  });

  it('throws when columns[i].confidence is out of [0,1] range', async () => {
    const responseJson = JSON.stringify({
      summary: 'bad',
      overallConfidence: 0.5,
      columns: [{ sourceIndex: 0, role: 'code', confidence: 1.5, reasoning: 'x' }],
      anomalies: [],
    });
    installFakeClient(fakeResponse(responseJson));
    await expect(runMapper(makeInput())).rejects.toThrow(/columns\[0\]\.confidence must be finite number in \[0,1\]/);
  });

  it('throws when columns[i].confidence is NaN/Infinity', async () => {
    // JSON.stringify converts NaN/Infinity to null, so simulate via the
    // mock returning a non-finite numeric directly. Using `1e400` which
    // serialises as `null` in standard JSON but to test the runtime
    // check, build the response object with Infinity bypassing JSON.
    const responseJson = '{"summary":"x","overallConfidence":0.5,"columns":[{"sourceIndex":0,"role":"code","confidence":1e9999,"reasoning":"x"}],"anomalies":[]}';
    installFakeClient(fakeResponse(responseJson));
    await expect(runMapper(makeInput())).rejects.toThrow(/finite number/);
  });

  it('throws when anomalies[i].severity is not a valid enum value', async () => {
    const responseJson = JSON.stringify({
      summary: 'bad',
      overallConfidence: 0.5,
      columns: [],
      anomalies: [{ row: 1, severity: 'urgent', category: 'other', description: 'x' }],
    });
    installFakeClient(fakeResponse(responseJson));
    await expect(runMapper(makeInput())).rejects.toThrow(/anomalies\[0\]\.severity must be 'critical'\|'warning'\|'info'/);
  });

  it('accepts anomalies with row=null (sheet-level anomaly)', async () => {
    const responseJson = JSON.stringify({
      summary: 'sheet-level issue',
      overallConfidence: 0.7,
      columns: [],
      anomalies: [
        { row: null, severity: 'warning', category: 'other', description: 'inconsistent currency' },
      ],
    });
    installFakeClient(fakeResponse(responseJson));
    const result = await runMapper(makeInput());
    expect(result.anomalies[0].row).toBeNull();
  });
});
