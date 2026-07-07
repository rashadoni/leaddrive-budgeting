import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(async () => ({ orgId: 'org1', userId: 'u1' })),
  isAuthError: () => false,
}))
const findFirst = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { scenario: { findFirst: (...a: unknown[]) => findFirst(...a) } } }))
// Stage 3 RLS — the scenario read runs inside withOrgScope; hand a tx that
// routes to the same mocked delegate.
vi.mock('@/lib/db/with-org-scope', () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ scenario: { findFirst: (...a: unknown[]) => findFirst(...a) } }),
}))
const runCrisisBrief = vi.fn()
vi.mock('@/lib/risk/scenario-narrative', () => ({ runCrisisBrief: (...a: unknown[]) => runCrisisBrief(...a) }))
let keyPresent = true
vi.mock('@/lib/ai/client', () => ({ hasAnthropicKey: () => keyPresent }))

import { POST } from './route'

const req = (body: unknown) => new Request('http://x/api/scenarios/s1/narrative', { method: 'POST', body: JSON.stringify(body) }) as never
const ctx = { params: Promise.resolve({ id: 's1' }) } as never

describe('POST /api/scenarios/[id]/narrative', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    keyPresent = true
    findFirst.mockResolvedValue({ code: 'AZN_DEVAL_20', nameEn: 'AZN -20%' })
  })

  it('runs the narrative from the posted summary', async () => {
    runCrisisBrief.mockResolvedValue({ narrative: '⚠ 61→58', mitigations: ['hedge'], confidence: 0.7, modelName: 's', promptVersion: 'v1' })
    const res = await POST(req({ language: 'ru', holdingBaselineScore: 61, holdingScenarioScore: 58, worstHit: [], changed: 5, worsened: 4, improved: 0, assumptionNote: null }), ctx)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.narrative).toContain('61→58')
    expect(body.mitigations).toEqual(['hedge'])
    expect(runCrisisBrief).toHaveBeenCalledTimes(1)
  })

  it('no Anthropic key → 200 with narrativeError, no LLM call', async () => {
    keyPresent = false
    const res = await POST(req({ language: 'ru' }), ctx)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.narrative).toBeNull()
    expect(body.narrativeError).toBeTruthy()
    expect(runCrisisBrief).not.toHaveBeenCalled()
  })

  it('LLM error → 200 graceful narrativeError (never breaks the brief)', async () => {
    runCrisisBrief.mockRejectedValue(new Error('LLM down'))
    const res = await POST(req({ language: 'ru' }), ctx)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.narrative).toBeNull()
    // Sanitized — narrativeError is a stable code, never the raw provider text.
    expect(body.narrativeError).toBe('ai_unavailable')
    expect(body.narrativeError).not.toContain('LLM down')
  })

  it('404 when the scenario is not found', async () => {
    findFirst.mockResolvedValue(null)
    const res = await POST(req({ language: 'ru' }), ctx)
    expect(res.status).toBe(404)
  })
})
