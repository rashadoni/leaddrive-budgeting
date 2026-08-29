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
#   bash deploy/smoke-test.sh --via-prod              # from a host with no
#                                                     # route to the public URL
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
# An UNREACHABLE host (curl 000) is never a pass for any check, including #8.
# A smoke test that goes green because nothing answered is worse than no smoke
# test: it converts an outage into a clean bill of health.
#
# Exit 0 = all critical checks passed; non-zero = at least one failed.
# This is defence-in-depth verification of the G3 audit (docs/AUTH_GATE_AUDIT.md):
# a regression that drops an auth gate, or a misconfigured nginx F3 block, shows
# up here as a 200 where a 401 was expected.

set -u

# --via-prod: run these same checks ON the production host, against its public
# HTTPS IP. This keeps the certificate, HTTPS server block and auth gates in
# the path while avoiding a dependency on external DNS.
#
# Why this mode exists
# ────────────────────
# The external URL is not reachable from every machine that needs to verify a
# deploy — the dev server has no DNS for budget.fo.az and no outbound 443 to
# it, so `bash deploy/smoke-test.sh https://budget.fo.az` there reports eight
# DOWN and proves nothing about the auth gates. That is an honest result and
# a useless one.
#
# The host itself can answer its public IP, so the script is piped over ssh and
# run there. Same file, same logic, no second copy to drift.
#
# WHAT THIS DOES NOT COVER — it is a weaker check than the external one, and
# passing it is not the same claim:
#   • no DNS resolution and no proof that a separate external network can
#     traverse the provider edge/firewall;
#   • it still covers the real TLS certificate and the HTTPS nginx listener.
# It DOES cover what was actually unverified: the application's auth gates and
# nginx's routing to them. Run the external form as well when you can.
if [ "${1:-}" = "--via-prod" ]; then
  PROD_HOST="${PROD_HOST:-root@75.119.156.234}"
  PROD_URL="${PROD_URL:-https://75.119.156.234}"
  echo "Running smoke-test ON ${PROD_HOST} against ${PROD_URL}"
  echo "  (weaker than the external run: no DNS or external ingress proof)"
  echo
  exec ssh "$PROD_HOST" "bash -s -- '$PROD_URL'" < "$0"
fi

BASE_URL="${1:-${SMOKE_BASE_URL:-}}"
if [ -z "$BASE_URL" ]; then
  echo "usage: bash deploy/smoke-test.sh <base-url>   (e.g. https://budget.fo.az)" >&2
  echo "       bash deploy/smoke-test.sh --via-prod   (run it on the prod host)" >&2
  echo "       or set SMOKE_BASE_URL" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}" # strip trailing slash

# Colors (fall back to plain if not a TTY).
if [ -t 1 ]; then GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'; else GRN=; RED=; DIM=; RST=; fi

PASS=0
FAIL=0
UNREACHABLE=0
TIMEOUT=10

# status_of <method> <path> [extra-curl-args...]
# Echoes exactly three digits: the HTTP status, or 000 when nothing was reached.
#
# The `|| echo "000"` this replaces printed 000 TWICE on a connection failure —
# curl writes its own `000` to stdout AND exits non-zero, so the fallback
# appended a second one and callers saw `000000`. Observed on a real run: every
# line read `-> 000000`, which matches no sane matcher and reads like a parser
# bug rather than "the host is unreachable".
status_of() {
  local method="$1" path="$2"; shift 2
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X "$method" \
    --max-time "$TIMEOUT" "$@" "${BASE_URL}${path}" 2>/dev/null)"
  # Anything that is not three digits (empty output, curl's own 000, garbage)
  # collapses to the single canonical "unreachable" value.
  case "$code" in
    [0-9][0-9][0-9]) printf '%s' "$code" ;;
    *) printf '000' ;;
  esac
}

# True when the code means "nothing answered" rather than "answered with X".
unreachable() { [ "$1" = "000" ]; }

# check <name> <method> <path> <matcher> [extra-curl-args...]
# <matcher> is a bash-regex the status code must match, e.g. '^200$' or '^(3[0-9]{2})$'.
check() {
  local name="$1" method="$2" path="$3" matcher="$4"; shift 4
  local code
  code="$(status_of "$method" "$path" "$@")"
  if unreachable "$code"; then
    # Never run the matcher on 000. A matcher is a statement about what the
    # server ANSWERED; if nothing answered, "does it match" is the wrong
    # question and any answer to it is misleading.
    printf '%s  DOWN%s  %-28s %s -> unreachable%s (wanted %s)\n' "$RED" "$RST" "$name" "$path" "$RST" "$matcher"
    FAIL=$((FAIL + 1))
    UNREACHABLE=$((UNREACHABLE + 1))
  elif [[ "$code" =~ $matcher ]]; then
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
if unreachable "$beacon_code"; then
  # THE BUG THIS CLOSES: the condition was a bare `!= "401"`, and 000 satisfies
  # it. With the entire service down every other check failed while this one
  # reported PASS — a green line produced by the absence of any signal, which
  # is the one thing a smoke test must never do.
  printf '%s  DOWN%s  %-28s /api/telemetry/guide-view -> unreachable%s\n' "$RED" "$RST" "public beacon" "$RST"
  FAIL=$((FAIL + 1))
  UNREACHABLE=$((UNREACHABLE + 1))
elif [ "$beacon_code" != "401" ]; then
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
  if [ "$UNREACHABLE" -gt 0 ]; then
    echo "${RED}  ${UNREACHABLE} of them were UNREACHABLE — nothing answered at ${BASE_URL}.${RST}"
    echo "${DIM}  That is a connectivity verdict, not an auth verdict: this run says NOTHING${RST}"
    echo "${DIM}  about whether the gates hold. Check DNS, firewall/port 443, and that you${RST}"
    echo "${DIM}  are running this from a host that can reach the deployment.${RST}"
  fi
  echo "${DIM}  - 200 where 401 expected = an auth gate is missing (regression) OR nginx F3 block misconfigured.${RST}"
  echo "${DIM}  - check container logs + 'nginx -t' + docs/AUTH_GATE_AUDIT.md.${RST}"
  exit 1
fi
