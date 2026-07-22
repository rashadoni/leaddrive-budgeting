// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { organizationId: 'org-1' } } }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (key === 'oddsNoEvidence') return `No Cash Flow entries for ${vars?.year}`;
    if (key === 'cashFlowPlanFactNoEvidence') {
      return `No forecast or actual evidence for ${vars?.year}`;
    }
    if (key === 'cashFlowPlanFactIncompleteEvidence') {
      return `Only ${vars?.complete} of ${vars?.total} months are complete for ${vars?.year}`;
    }
    return key;
  },
}));

import { BudgetODDSReport } from './budget-odds-report';
import { BudgetPlanFactDashboard } from './budget-plan-fact-dashboard';

function renderWithQueryClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

describe('Cash Flow downstream views preserve absent ≠ zero', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders an honest CFS empty state when the ledger has no source rows', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        data: {
          year: 2026,
          entryCount: 0,
          sections: [],
          grandInflow: 0,
          grandOutflow: 0,
          grandNet: 0,
        },
      }),
    } as Response);

    renderWithQueryClient(<BudgetODDSReport year={2026} />);

    expect(
      (await screen.findByTestId('cash-flow-odds-empty')).textContent,
    ).toContain('No Cash Flow entries for 2026');
    expect(screen.queryByTestId('cash-flow-odds-report')).toBeNull();
    expect(document.body.textContent).not.toContain('0 AZN');
  });

  it('renders an honest plan/fact empty state when all three input populations are absent', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        data: {
          year: 2026,
          evidenceCounts: {
            salesForecasts: 0,
            expenseForecasts: 0,
            budgetActuals: 0,
          },
          evidenceCoverage: { completeMonths: 0, totalMonths: 12 },
          monthly: [],
          totals: {
            revenuePlan: 0,
            revenueFact: 0,
            revenueVariance: 0,
            revenueVariancePct: 0,
            expensePlan: 0,
            expenseFact: 0,
            expenseVariance: 0,
            expenseVariancePct: 0,
            netPlan: 0,
            netFact: 0,
          },
        },
      }),
    } as Response);

    renderWithQueryClient(<BudgetPlanFactDashboard year={2026} />);

    expect(
      (await screen.findByTestId('cash-flow-plan-fact-empty')).textContent,
    ).toContain('No forecast or actual evidence for 2026');
    expect(screen.queryByTestId('cash-flow-plan-fact-report')).toBeNull();
    expect(document.body.textContent).not.toContain('0 AZN');
  });

  it('fails closed when only part of the annual plan/fact evidence is present', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        data: {
          year: 2026,
          evidenceCounts: {
            salesForecasts: 1,
            expenseForecasts: 0,
            budgetActuals: 1,
          },
          evidenceCoverage: { completeMonths: 0, totalMonths: 12 },
          monthly: [],
          totals: {
            revenuePlan: 100,
            revenueFact: 100,
            revenueVariance: 0,
            revenueVariancePct: 0,
            expensePlan: 0,
            expenseFact: 0,
            expenseVariance: 0,
            expenseVariancePct: 0,
            netPlan: 100,
            netFact: 100,
          },
        },
      }),
    } as Response);

    renderWithQueryClient(<BudgetPlanFactDashboard year={2026} />);

    expect(
      (await screen.findByTestId('cash-flow-plan-fact-incomplete')).textContent,
    ).toContain('Only 0 of 12 months are complete for 2026');
    expect(screen.queryByTestId('cash-flow-plan-fact-report')).toBeNull();
  });
});
