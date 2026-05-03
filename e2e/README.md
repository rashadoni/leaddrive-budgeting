# E2E (Playwright) — pre-prod smoke harness

Phase 7.G Turn D deliverable. Locks the customer-facing flows that
vitest can't (real browser + real auth + real DB).

## Quick start

```bash
# One-time: install Chromium browser binary
npm run test:e2e:install

# Run all smokes (headless)
npm run test:e2e

# Interactive UI (debug mode)
npm run test:e2e:ui

# Watch tests run in a real browser
npm run test:e2e:headed
```

## Pre-conditions

- Dev server running on `http://localhost:3000` (LaunchAgent on Mac OR
  `npm run dev` OR `docker compose up`)
- Postgres running with at least one operational company seeded under
  the admin's org
- Admin user seeded matching `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`
  env vars (defaults: `admin@budgetpro.com` / `admin123`)

## Run against staging / prod

```bash
E2E_BASE_URL=https://staging.budget.fo.az \
E2E_ADMIN_EMAIL=smoke-test@fo.az \
E2E_ADMIN_PASSWORD=$STAGING_SMOKE_PWD \
npm run test:e2e
```

## Layout

```
e2e/
├── README.md                          # this file
├── fixtures/
│   └── auth.ts                        # loginAs() helper + credentials
├── smoke/                             # critical-path smoke tests
│   └── login-and-terminal.spec.ts     # Turn D.1 — first smoke
└── (future Turn D.2/D.3 dirs:)
    ├── onboarding/                    # wizard analyze + apply E2E
    └── recompute/                     # recompute pipeline + SSE event
```

## Convention vs vitest

- **vitest** (`*.test.ts`, `*.test.tsx`): unit + component tests
  against happy-dom; mocks Prisma + auth; runs in milliseconds.
  1677 cases as of 2026-05-03.
- **Playwright** (`*.spec.ts` under `e2e/`): real Chromium + real DB
  + real auth; runs in seconds-to-minutes per smoke.

The two worlds DO NOT overlap — `playwright.config.ts:testMatch:
'**/*.spec.ts'` + vitest's default `*.test.ts` pattern keep them
strictly separated.

## CI integration (future)

When CI lands (post-Phase-7.G), add a workflow step:

```yaml
- name: E2E smoke
  run: |
    npm run test:e2e:install
    npm run test:e2e
  env:
    E2E_BASE_URL: ${{ secrets.STAGING_URL }}
    E2E_ADMIN_EMAIL: ${{ secrets.STAGING_SMOKE_EMAIL }}
    E2E_ADMIN_PASSWORD: ${{ secrets.STAGING_SMOKE_PWD }}
```

## Cross-references

- Pre-prod gate: `docs/DEPLOYMENT_READINESS.md` §5 (extension on top
  of `scripts/pre-demo-check.sh`)
- Roadmap context: `docs/ROADMAP.md` §7.G Verification + polish
- Auth flow under test: `src/app/(auth)/login/page.tsx` +
  `src/lib/auth.ts`
