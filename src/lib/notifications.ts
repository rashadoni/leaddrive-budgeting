// Stub: notifications not used in standalone budgeting.
// Phase 8 D3(v) (2026-05-28) — `any` → `unknown` so the stub doesn't
// silently swallow type errors at call sites if anyone wires a real
// notification provider in here. Real implementations would replace
// these signatures with concrete option types.
export async function sendNotification(_opts: unknown) {}
export async function notifyBudgetApproval(_opts: unknown) {}
export async function createNotification(_opts: unknown) {}
