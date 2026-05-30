import { describe, it, expect, vi } from 'vitest'
import { buildCrisisBriefPrompt, runCrisisBrief, type CrisisBriefInput } from './scenario-narrative'

const input: CrisisBriefInput = {
  scenarioCode: 'INPUT_COST_30',
  scenarioNameEn: 'Input cost +30%',
  language: 'ru',
  holdingBaselineScore: 45,
  holdingScenarioScore: 31,
  worstHit: [
    {
      companyCode: 'CPC',
      companyName: 'CPC',
      baselineScore: 49,
      scenarioScore: 28,
      topDeltas: [{ code: 'IND_EBITDA_MARGIN', baselineValue: 4.55, scenarioValue: -7.1 }],
    },
  ],
  changed: 7,
  worsened: 6,
  improved: 1,
  assumptionNote: null,
}

describe('buildCrisisBriefPrompt', () => {
  it('includes the real swing numbers and forbids invention', () => {
    const p = buildCrisisBriefPrompt(input)
    expect(p).toContain('45')
    expect(p).toContain('31')
    expect(p).toContain('CPC')
    expect(p).toContain('IND_EBITDA_MARGIN')
  })
  it('surfaces an assumption note when present (FX scenario)', () => {
    const p = buildCrisisBriefPrompt({ ...input, assumptionNote: 'Assumes 30% imported-input share' })
    expect(p).toContain('30% imported-input share')
  })
})

describe('runCrisisBrief', () => {
  it('returns narrative + mitigations from the injected client', async () => {
    const fakeClient = {
      messages: {
        create: vi.fn(async () => ({
          stop_reason: 'end_turn',
          model: 'claude-sonnet-4-5-20250929',
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                narrative: '⚠ Рост входной стоимости обрушивает композит с 45 до 31.',
                mitigations: ['Хеджировать сырьё', 'Пересмотреть контракты', 'Поднять цены на 8%'],
                confidence: 0.7,
              }),
            },
          ],
        })),
      },
    } as never
    const out = await runCrisisBrief(input, { client: fakeClient })
    expect(out.narrative).toContain('45')
    expect(out.mitigations).toHaveLength(3)
    expect(out.modelName).toBe('claude-sonnet-4-5-20250929')
    expect(out.confidence).toBe(0.7)
  })

  it('throws on max_tokens truncation', async () => {
    const fakeClient = { messages: { create: vi.fn(async () => ({ stop_reason: 'max_tokens', content: [] })) } } as never
    await expect(runCrisisBrief(input, { client: fakeClient })).rejects.toThrow(/max_tokens/)
  })
})
