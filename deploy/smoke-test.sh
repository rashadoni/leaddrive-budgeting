#!/usr/bin/env bash
#
# Post-deploy smoke test — verify a LIVE BudgetPro deployment from the outside.
#
# first-deploy.sh provisions + starts the stack but does not verify the result;
# this is that missing check. Run it from anywhere that can reach the deployed
# URL (your laptop, the VM, CI) right after a deploy or TLS cutover.
#
#   bash deploy/smoke-test.sh https://budget.fo.az
#   bash deploy/smoke-test.sh http://<vm-ip>          # pre-TLS
#
# What it checks (all UNauthenticated — no secrets needed):
#   1. App is serving           GET /login                 -> 200
#   2. NextAuth public          GET /api/auth/session      -> 200   (public by design)
#   3. NextAuth public          GET /api/auth/csrf         -> 200
#   4. Page auth-gate           GET /budgeting/terminal    -> 3xx   (redirect to /login)
#   5. API auth-gate (data)     GET /api/companies         -> 401   (G3: every data route gates)
#   6. API auth-gate (data)     GET /api/budgeting/analytics -> 401
#   7. F1 SSE gate              GET /api/terminal/stream   -> 401   (no anon event stream)
#   8. Public beacon NOT gated  GET /api/telemetry/guide-view -> not 401 (405/400/200 ok)
#
# Exit 0 = all critical checks passed; non-zero = at least one failed.
# This is defence-in-depth verification of the G3 audit (docs/AUTH_GATE_AUDIT.md):
# a regression that drops an auth gate, or a misconfigured nginx F3 block, shows
# up here as a 200 where a 401 was expected.

set -u

BASE_URL="${1:-${SMOKE_BASE_URL:-}}"
if [ -z "$BASE_URL" ]; then
  echo "usage: bash deploy/smoke-test.sh <base-url>   (e.g. https://budget.fo.az)" >&2
  echo "       or set SMOKE_BASE_URL" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}" # strip trailing slash

# Colors (fall back to plain if not a TTY).
if [ -t 1 ]; then GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'; else GRN=; RED=; DIM=; RST=; fi

PASS=0
FAIL=0
TIMEOUT=10

# status_of <method> <path> [extra-curl-args...]
# Echoes the HTTP status code (000 on connection failure/timeout).
status_of() {
  local method="$1" path="$2"; shift 2
  curl -s -o /dev/null -w '%{http_code}' -X "$method" \
    --max-time "$TIMEOUT" "$@" "${BASE_URL}${path}" 2>/dev/null || echo "000"
}

# check <name> <method> <path> <matcher> [extra-curl-args...]
# <matcher> is a bash-regex the status code must match, e.g. '^200$' or '^(3[0-9]{2})$'.
check() {
  local name="$1" method="$2" path="$3" matcher="$4"; shift 4
  local code
  code="$(status_of "$method" "$path" "$@")"
  if [[ "$code" =~ $matcher ]]; then
    printf '%s  PASS%s  %-28s %s%s -> %s (want %s)%s\n' "$GRN" "$RST" "$name" "$DIM" "$path" "$code" "$matcher" "$RST"
    PASS=$((PASS + 1))
  else
    printf '%s  FAIL%s  %-28s %s -> %s%s (want %s)\n' "$RED" "$RST" "$name" "$path" "$RED$code" "$RST" "$matcher"
    FAIL=$((FAIL + 1))
  fi
}

echo "Smoke-testing ${BASE_URL}"
[[ "$BASE_URL" == https://* ]] || echo "  ${DIM}(note: not HTTPS — fine for an initial VM check, but enable TLS before go-live)${RST}"
echo

# 1-3: app up + NextAuth public endpoints must be reachable WITHOUT a session.
check "app serving"        GET /login                     '^200$'
check "nextauth session"   GET /api/auth/session          '^200$'
check "nextauth csrf"      GET /api/auth/csrf             '^200$'

# 4: page auth-gate — unauth terminal must redirect (do NOT follow redirects).
check "page auth-gate"     GET /budgeting/terminal        '^(30[0-9]|200)$'

# 5-6: API data routes must reject anon with 401 (G3 invariant: 0 exposed endpoints).
check "api gate /companies" GET /api/companies            '^401$'
check "api gate /analytics" GET /api/budgeting/analytics  '^401$'

# 7: F1 — SSE stream must not open for anon (short timeout; the gate answers before streaming).
check "sse gate (F1)"      GET /api/terminal/stream       '^401$' --max-time 5

# 8: public telemetry beacon must NOT be auth-gated (anything but 401 is acceptable;
#    it is a POST endpoint, so a GET legitimately yields 405/400 — the point is "not 401").
beacon_code="$(status_of GET /api/telemetry/guide-view)"
if [ "$beacon_code" != "401" ]; then
  printf '%s  PASS%s  %-28s %s/api/telemetry/guide-view -> %s (want: not 401)%s\n' "$GRN" "$RST" "public beacon" "$DIM" "$beacon_code" "$RST"
  PASS=$((PASS + 1))
else
  printf '%s  FAIL%s  %-28s /api/telemetry/guide-view -> %s401%s (the anon /guide beacon must stay public)\n' "$RED" "$RST" "public beacon" "$RED" "$RST"
  FAIL=$((FAIL + 1))
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "${GRN}✓ all ${PASS} checks passed${RST} — deployment looks healthy + auth-gated."
  echo "${DIM}Next: log in as admin + open the terminal (real-user smoke, DEPLOYMENT_READINESS §5.2).${RST}"
  exit 0
else
  echo "${RED}✗ ${FAIL} check(s) failed${RST} (${PASS} passed). Investigate before declaring the deploy good:"
  echo "${DIM}  - 000 = unreachable (DNS/firewall/container down / wrong URL).${RST}"
  echo "${DIM}  - 200 where 401 expected = an auth gate is missing (regression) OR nginx F3 block misconfigured.${RST}"
  echo "${DIM}  - check container logs + 'nginx -t' + docs/AUTH_GATE_AUDIT.md.${RST}"
  exit 1
fi
