// @vitest-environment happy-dom
/**
 * Phase 1 "Crisis Brief" — store-side tests for the scenarioBrief slice.
 * Locks: setScenarioBrief stores; clearScenarioBrief clears; clearScenarioDelta
 * (the revert gesture) ALSO clears the brief.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { getTerminalSnapshot, useTerminalStore, type ScenarioBriefState } from './terminalStore'

function useActions() {
  return useTerminalStore((s) => ({
    setScenarioDelta: s.setScenarioDelta,
    clearScenarioDelta: s.clearScenarioDelta,
    setScenarioBrief: s.setScenarioBrief,
    clearScenarioBrief: s.clearScenarioBrief,
    clearState: s.clearState,
  }))
}

const SAMPLE: ScenarioBriefState = {
  scenarioCode: 'INPUT_COST_30',
  holdingBaselineScore: 61,
  holdingScenarioScore: 58,
  financialHoldingBaselineScore: 64,
  financialHoldingScenarioScore: 41,
  byCompany: [{ companyId: 'c1', companyCode: 'AZSEKER-CPC', baselineScore: 64, scenarioScore: 61 }],
  narrative: '⚠ ...',
  mitigations: ['hedge'],
  cascadeOrder: ['c1:FP_GROSS_MARGIN'],
}

beforeEach(() => {
  const { result } = renderHook(() => useActions())
  act(() => result.current.clearState())
})

describe('terminalStore scenarioBrief', () => {
  it('setScenarioBrief stores; clearScenarioBrief clears', () => {
    const { result } = renderHook(() => useActions())
    act(() => result.current.setScenarioBrief(SAMPLE))
    expect(getTerminalSnapshot().scenarioBrief?.holdingScenarioScore).toBe(58)
    act(() => result.current.clearScenarioBrief())
    expect(getTerminalSnapshot().scenarioBrief).toBeNull()
  })

  it('clearScenarioDelta (revert) also clears the brief', () => {
    const { result } = renderHook(() => useActions())
    act(() => {
      result.current.setScenarioDelta(new Map([['c1:FP_GROSS_MARGIN', 'red']]), 'INPUT_COST_30')
      result.current.setScenarioBrief(SAMPLE)
    })
    expect(getTerminalSnapshot().scenarioBrief).not.toBeNull()
    act(() => result.current.clearScenarioDelta())
    expect(getTerminalSnapshot().scenarioBrief).toBeNull()
    expect(getTerminalSnapshot().scenarioDelta).toBeNull()
  })

  it('clearState resets the brief', () => {
    const { result } = renderHook(() => useActions())
    act(() => result.current.setScenarioBrief(SAMPLE))
    act(() => result.current.clearState())
    expect(getTerminalSnapshot().scenarioBrief).toBeNull()
  })
})
