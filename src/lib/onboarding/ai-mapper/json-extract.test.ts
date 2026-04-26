import { describe, it, expect } from 'vitest';
import { extractJsonFromText } from './json-extract';

describe('extractJsonFromText', () => {
  it('returns plain JSON unchanged', () => {
    const input = '{"a": 1, "b": "hello"}';
    expect(extractJsonFromText(input)).toBe(input);
  });

  it('strips ```json fences', () => {
    const input = '```json\n{"a": 1}\n```';
    expect(extractJsonFromText(input)).toBe('{"a": 1}');
  });

  it('strips bare ``` fences', () => {
    const input = '```\n{"a": 1}\n```';
    expect(extractJsonFromText(input)).toBe('{"a": 1}');
  });

  it('extracts JSON when LLM adds an intro line', () => {
    const input = 'Sure, here is the proposal:\n{"summary": "ok", "value": 42}';
    const result = extractJsonFromText(input);
    expect(JSON.parse(result)).toEqual({ summary: 'ok', value: 42 });
  });

  it('extracts JSON when LLM adds an outro line', () => {
    const input = '{"a": 1}\n\nLet me know if you need clarification.';
    const result = extractJsonFromText(input);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('extracts JSON wrapped in both intro AND outro', () => {
    const input =
      'Here is the JSON you requested:\n\n{"k": "v", "n": 7}\n\nDoes this work?';
    const result = extractJsonFromText(input);
    expect(JSON.parse(result)).toEqual({ k: 'v', n: 7 });
  });

  it('handles nested objects (does not split at inner braces)', () => {
    const input = '{"outer": {"inner": {"deep": 1}}, "x": [1, 2]}';
    expect(JSON.parse(extractJsonFromText(input))).toEqual({
      outer: { inner: { deep: 1 } },
      x: [1, 2],
    });
  });

  it('picks the largest valid JSON when prose contains a fake brace before real JSON', () => {
    // Architect round-2 finding: greedy `{[\s\S]*}` would swallow `{fake}`
    // and the real JSON into one invalid blob. New algorithm tries longest-
    // first; the fake brace alone (`{fake}`) isn't valid JSON, but the real
    // `{"answer": 1}` is, so that wins.
    const input = 'Random thought: {fake} but actually {"answer": 1, "valid": true}';
    const result = extractJsonFromText(input);
    expect(JSON.parse(result)).toEqual({ answer: 1, valid: true });
  });

  it('picks the LARGEST valid JSON when multiple valid blobs exist', () => {
    // {"a":1} and {"a":1,"b":2} are both valid; longer wins.
    const input = 'first {"a":1} then {"a":1,"b":2}';
    const result = extractJsonFromText(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('returns the stripped text when no valid JSON can be extracted', () => {
    const input = 'just some text without json';
    expect(extractJsonFromText(input)).toBe('just some text without json');
  });

  it('returns the stripped text when only opening brace exists (unparseable)', () => {
    const input = 'truncated: {"a": 1';
    // No `}` → no candidates → returns stripped text. Caller's JSON.parse
    // surfaces the error with this text in the diagnostic.
    expect(extractJsonFromText(input)).toBe('truncated: {"a": 1');
  });

  it('handles JSON with embedded { in string values', () => {
    // The string value `"prefix {brace} suffix"` must not break extraction.
    const input = 'Here: {"text": "prefix {brace} suffix", "n": 1}';
    const result = extractJsonFromText(input);
    expect(JSON.parse(result)).toEqual({ text: 'prefix {brace} suffix', n: 1 });
  });

  it('falls back gracefully when the JSON exceeds MAX_CANDIDATES brace pairs', () => {
    // Generate a degenerate input with many braces. The extractor caps
    // candidate enumeration; since no valid JSON forms, returns stripped.
    const input = '{'.repeat(50) + '}'.repeat(50);
    const result = extractJsonFromText(input);
    // Whatever it returns, it shouldn't blow up. The string is valid input
    // (returns either stripped or one of the candidates).
    expect(typeof result).toBe('string');
  });

  it('handles realistic LLM truncation gracefully', () => {
    // Truncated JSON with no closing brace → caller's JSON.parse fails
    // with a useful message containing the stripped text.
    const input = '```json\n{"summary": "this got cut off mid-';
    const result = extractJsonFromText(input);
    // No closing }, returns the stripped string.
    expect(result).toContain('summary');
  });
});
