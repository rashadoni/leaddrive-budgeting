#!/usr/bin/env bash
# Phase 0.7 (Turn XXXVI) — regression guard for `.githooks/pre-commit-secrets.sh`.
# 12 scenarios cover each pattern in the catalog + skip-path behavior +
# clean-pass case. Uses the scanner's `--scan-files` test mode so each
# case is a self-contained file fixture (no git repo spin-up needed).
#
# Run: bash .githooks/tests/pre-commit-secrets.test.sh
# Expected: all 12 tests pass, exit 0.

set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/pre-commit-secrets.sh"
SCRATCH="${TMPDIR:-/tmp}/pre-commit-secrets-test-$$"
mkdir -p "$SCRATCH"

pass_count=0
fail_count=0

cleanup() {
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

report() {
  local name="$1" ok="$2"
  if [ "$ok" = "1" ]; then
    echo "  ✓ $name"
    pass_count=$((pass_count + 1))
  else
    echo "  ✗ $name" >&2
    fail_count=$((fail_count + 1))
  fi
}

# Helper: run the scanner against a single fixture file. Returns the exit
# code via stdout (0=clean, 1=offenders found).
run_scanner() {
  local fixture="$1"
  if bash "$HOOK" --scan-files "$fixture" >/dev/null 2>&1; then
    echo 0
  else
    echo 1
  fi
}

# Helper: same but capture stderr too, for label-detection cases.
run_scanner_capture() {
  local fixture="$1"
  bash "$HOOK" --scan-files "$fixture" 2>&1 || true
}

echo "── pre-commit-secrets.sh regression tests ──"

# ─────────────────────────────────────────────────────────────────────────
# 1: clean file → exit 0
clean="$SCRATCH/clean.ts"
cat > "$clean" <<'EOF'
const greeting = "hello world";
const path = "/api/foo/bar";
const x = 42;
EOF
out=$(run_scanner "$clean")
report "clean file passes" "$([ "$out" = "0" ] && echo 1 || echo 0)"

# ─────────────────────────────────────────────────────────────────────────
# 2: AWS access key → flagged
aws="$SCRATCH/aws.ts"
cat > "$aws" <<'EOF'
const key = "AKIAIOSFODNN7EXAMPLE";
EOF
captured=$(run_scanner_capture "$aws")
if echo "$captured" | grep -q "aws_access_key_id"; then
  report "AWS access key id flagged" 1
else
  report "AWS access key id flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 3: Google API key → flagged
google="$SCRATCH/google.ts"
cat > "$google" <<'EOF'
const apiKey = "AIzaSyC1lp_nXGYxr7t8H9k2L3M4N5O6P7Q8R9S";
EOF
captured=$(run_scanner_capture "$google")
if echo "$captured" | grep -q "google_api_key"; then
  report "Google API key flagged" 1
else
  report "Google API key flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 4: Anthropic API key → flagged
anthropic="$SCRATCH/anthropic.ts"
cat > "$anthropic" <<'EOF'
const ANTHROPIC_API_KEY = "sk-ant-api03-aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6";
EOF
captured=$(run_scanner_capture "$anthropic")
if echo "$captured" | grep -q "anthropic_api_key"; then
  report "Anthropic API key flagged" 1
else
  report "Anthropic API key flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 5: GitHub PAT → flagged
github="$SCRATCH/github.ts"
cat > "$github" <<'EOF'
const TOKEN = "ghp_aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2";
EOF
captured=$(run_scanner_capture "$github")
if echo "$captured" | grep -q "github_pat"; then
  report "GitHub PAT flagged" 1
else
  report "GitHub PAT flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 6: Slack token → flagged
slack="$SCRATCH/slack.ts"
cat > "$slack" <<'EOF'
const SLACK_TOKEN = "xoxb-1234567890-abcdefghijklmnop";
EOF
captured=$(run_scanner_capture "$slack")
if echo "$captured" | grep -q "slack_token"; then
  report "Slack token flagged" 1
else
  report "Slack token flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 7: Stripe live key → flagged
stripe="$SCRATCH/stripe.ts"
cat > "$stripe" <<'EOF'
const STRIPE = "sk_live_aB1cD2eF3gH4iJ5kL6mN7oP8qR9";
EOF
captured=$(run_scanner_capture "$stripe")
if echo "$captured" | grep -q "stripe_key"; then
  report "Stripe live key flagged" 1
else
  report "Stripe live key flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 8: Postgres URL with non-localhost password → flagged
pg_remote="$SCRATCH/pg-remote.env"
cat > "$pg_remote" <<'EOF'
DATABASE_URL=postgres://prod_user:hunter2@db.example.com:5432/prod
EOF
captured=$(run_scanner_capture "$pg_remote")
if echo "$captured" | grep -q "postgres_with_password"; then
  report "Postgres URL with non-localhost password flagged" 1
else
  report "Postgres URL with non-localhost password flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 9: Postgres URL with localhost → NOT flagged (legit dev pattern)
pg_local="$SCRATCH/pg-local.env"
cat > "$pg_local" <<'EOF'
DATABASE_URL=postgresql://dev:devpass@localhost:5432/budgetpro
EOF
out=$(run_scanner "$pg_local")
report "Postgres URL with localhost password NOT flagged (legit dev)" \
  "$([ "$out" = "0" ] && echo 1 || echo 0)"

# ─────────────────────────────────────────────────────────────────────────
# 10: skip lockfile (would otherwise match if present)
mkdir -p "$SCRATCH/lock"
lockfile="$SCRATCH/lock/package-lock.json"
cat > "$lockfile" <<'EOF'
{ "AKIAIOSFODNN7EXAMPLE": "this is a hash, not a key" }
EOF
out=$(run_scanner "$lockfile")
report "package-lock.json skipped" \
  "$([ "$out" = "0" ] && echo 1 || echo 0)"

# ─────────────────────────────────────────────────────────────────────────
# 11: skip node_modules
mkdir -p "$SCRATCH/node_modules/foo"
nmfile="$SCRATCH/node_modules/foo/index.js"
cat > "$nmfile" <<'EOF'
const k = "AKIAIOSFODNN7EXAMPLE";
EOF
out=$(run_scanner "$nmfile")
report "node_modules path skipped" \
  "$([ "$out" = "0" ] && echo 1 || echo 0)"

# ─────────────────────────────────────────────────────────────────────────
# 12: multi-pattern file → all offenders reported
multi="$SCRATCH/multi.ts"
cat > "$multi" <<'EOF'
const aws = "AKIAIOSFODNN7EXAMPLE";
const google = "AIzaSyC1lp_nXGYxr7t8H9k2L3M4N5O6P7Q8R9S";
EOF
captured=$(run_scanner_capture "$multi")
if echo "$captured" | grep -q "aws_access_key_id" \
  && echo "$captured" | grep -q "google_api_key"; then
  report "multi-pattern file: both offenders reported" 1
else
  report "multi-pattern file: both offenders reported (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 13: private key block → flagged
priv="$SCRATCH/priv.pem"
cat > "$priv" <<'EOF'
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAxn3...
-----END RSA PRIVATE KEY-----
EOF
captured=$(run_scanner_capture "$priv")
if echo "$captured" | grep -q "private_key_block"; then
  report "private key block flagged" 1
else
  report "private key block flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 14: bcrypt hash → flagged
bcrypt="$SCRATCH/bcrypt.ts"
cat > "$bcrypt" <<'EOF'
const hash = "$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ12345";
EOF
captured=$(run_scanner_capture "$bcrypt")
if echo "$captured" | grep -q "bcrypt_hash"; then
  report "bcrypt hash flagged" 1
else
  report "bcrypt hash flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 15: hardcoded password assignment → flagged
hp="$SCRATCH/hardcoded.ts"
cat > "$hp" <<'EOF'
const password = "Hunter2!secret";
EOF
captured=$(run_scanner_capture "$hp")
if echo "$captured" | grep -q "hardcoded_password"; then
  report "hardcoded password assignment flagged" 1
else
  report "hardcoded password assignment flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 16: Stripe test key → flagged (was previously only live)
stripe_test="$SCRATCH/stripe-test.ts"
cat > "$stripe_test" <<'EOF'
const STRIPE_TEST = "pk_test_aB1cD2eF3gH4iJ5kL6mN7oP8";
EOF
captured=$(run_scanner_capture "$stripe_test")
if echo "$captured" | grep -q "stripe_key"; then
  report "Stripe test key flagged" 1
else
  report "Stripe test key flagged (got: $captured)" 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 17: test-file path → SKIPPED (Turn-XXXVI architect suggestion #1).
# Test files conventionally carry fake credentials for assertion. A
# contributor staging a test file with `password = "weak"` shouldn't be
# blocked; pattern catalog targets prod-shape leaks.
testpath="$SCRATCH/foo.test.ts"
cat > "$testpath" <<'EOF'
const fakePassword = "Hunter2!secret";
const fakeAws = "AKIAIOSFODNN7EXAMPLE";
EOF
out=$(run_scanner "$testpath")
report "*.test.ts SKIPPED (test fixture allow-list)" \
  "$([ "$out" = "0" ] && echo 1 || echo 0)"

# ─────────────────────────────────────────────────────────────────────────
# 18: e2e/fixtures path → SKIPPED
mkdir -p "$SCRATCH/e2e/fixtures"
fixpath="$SCRATCH/e2e/fixtures/auth-stub.ts"
cat > "$fixpath" <<'EOF'
const adminPassword = "FixtureOnly123!";
EOF
out=$(run_scanner "$fixpath")
report "e2e/fixtures path SKIPPED" \
  "$([ "$out" = "0" ] && echo 1 || echo 0)"

echo ""
if [ "$fail_count" -eq 0 ]; then
  echo "All $pass_count tests passed."
  exit 0
else
  echo "$fail_count of $((pass_count + fail_count)) tests FAILED." >&2
  exit 1
fi
