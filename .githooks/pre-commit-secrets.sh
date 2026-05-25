#!/usr/bin/env bash
#
# Phase 0.7 (Turn XXXVI) — pre-commit secret scanner.
#
# Closes the long-pending ROADMAP §0.7 stretch: a secret-leak gate at
# commit time so accidental API keys / tokens never reach git history
# (where they're cached forever even after force-push or rewrite).
#
# Why a regex-based scanner instead of `gitleaks` / `detect-secrets`:
#   - No external binary install required (gitleaks needs Go binary;
#     detect-secrets needs Python venv). Plain bash + grep runs on every
#     dev machine without setup.
#   - Tightly-scoped pattern set is fast (~50ms typical, vs gitleaks
#     ~500ms+ on a fresh repo).
#   - Easy to extend: add a regex line + a fixture and you're done.
#
# Patterns covered (high-confidence "this is definitely a secret"):
#   1. AWS access key id    AKIA[0-9A-Z]{16}            (20-char prefix)
#   2. AWS secret key       40-char base64 next to "aws_secret_access_key"
#   3. Google API key       AIza[0-9A-Za-z_-]{35}       (39-char total)
#   4. Anthropic API key    sk-ant-[a-z0-9_-]{40,}      (variable length)
#   5. OpenAI API key       sk-[A-Za-z0-9]{40,}         (variable length;
#                                                        excluded inside
#                                                        sk-ant- prefix)
#   6. GitHub PAT           gh[pous]_[A-Za-z0-9]{36,}   (classic + fine-
#                                                        grained)
#   7. Slack tokens         xox[baprs]-[A-Za-z0-9-]{10,}
#   8. Stripe live key      sk_live_[A-Za-z0-9]{24,}
#   9. Postgres URL with    postgres(?:ql)?://USER:PASS@HOST  (literal
#      embedded password    creds only — env-var placeholders
#                            `${POSTGRES_USER}:${POSTGRES_PASSWORD}` are
#                            skipped, as are localhost/127.0.0.1 hosts
#
# What the scanner deliberately does NOT do:
#   - Entropy-based heuristics (huge false-positive rate on random hashes,
#     UUIDs, hex commits). Gitleaks tries this and pays for it.
#   - Detect generic "password = ..." assignments without a known prefix.
#     Catches some, misses many — not worth the noise.
#   - Scan binary files / lockfiles (skipped via grep -I + path filter).
#
# Activation: this hook is called from `.githooks/pre-commit`.
# Test gate:  `.githooks/tests/pre-commit-secrets.test.sh`.
#
# ─── BASH 3.2 COMPATIBILITY (do NOT re-introduce these) ─────────────────
# macOS ships bash 3.2 at /bin/bash and `#!/usr/bin/env bash` may resolve
# to it on dev machines without homebrew bash on PATH first. Forbidden
# bash-4+ idioms in this hook (each was caught + fixed during Turn XXXVI):
#   ✗ `mapfile -d '' arr < ...`     — not in 3.2; use `while read -r -d ''`
#   ✗ `declare -A assoc=(...)`      — not in 3.2; use flat string + `case`
#   ✗ `[[ "$x" =~ [[:char:]]+ ]]`   — POSIX-class inside `[[ =~ ]]` is
#                                      flaky under 3.2 — prefer grep -E
# Verify any future change to this file by running on /bin/bash:
#   /bin/bash .githooks/pre-commit-secrets.sh --scan-files /tmp/clean.txt
# ────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Test mode: when called with `--scan-files <path>...`, scan exactly the
# given paths instead of consulting `git diff --cached`. This lets the
# test gate at `.githooks/tests/pre-commit-secrets.test.sh` exercise the
# scanner against fixtures without spinning up a real git repo per case.
staged_files=()
if [ "${1:-}" = "--scan-files" ]; then
  shift
  for f in "$@"; do
    staged_files+=("$f")
  done
else
  # Files staged for commit (Added or Modified). Read NUL-delimited so paths
  # with spaces / unicode work. Avoids `mapfile -d ''` because macOS still
  # ships bash 3.2 at /bin/bash and the shebang `env bash` may pick it up
  # on dev machines without homebrew bash on PATH first.
  while IFS= read -r -d '' file; do
    staged_files+=("$file")
  done < <(git diff --cached --name-only --diff-filter=AM -z)
fi

if [ ${#staged_files[@]} -eq 0 ]; then
  exit 0
fi

# Skip patterns — files we never scan (binary, vendored, lockfiles, or
# the scanner's own test fixtures which intentionally contain fake API
# keys for assertion).
should_skip_path() {
  local path="$1"
  case "$path" in
    node_modules/*|*/node_modules/*) return 0 ;;
    .git/*|*/.git/*) return 0 ;;
    package-lock.json|*/package-lock.json) return 0 ;;
    pnpm-lock.yaml|*/pnpm-lock.yaml) return 0 ;;
    yarn.lock|*/yarn.lock) return 0 ;;
    *.lock|*/Cargo.lock) return 0 ;;
    # Snapshot/baseline images
    *-snapshots/*|*.snap) return 0 ;;
    # PRISMA generated client (regenerated on `prisma generate`)
    src/generated/*|*/generated/prisma/*) return 0 ;;
    # The scanner's own test gate contains intentional fixture-shaped
    # API keys to verify each pattern.
    .githooks/tests/pre-commit-secrets.test.sh) return 0 ;;
    # Test fixtures (by convention) carry fake / weak credentials for
    # assertion purposes — `hardcoded_password` is the most likely
    # false-positive source per architect Turn-XXXVI suggestion. We
    # exclude unit/spec/e2e test files broadly. Trade-off: real
    # production secrets in test files slip through, but the convention
    # is that real secrets never go in tests. If a contributor stages
    # a test file with intentional fake fixtures, the scanner stays
    # quiet.
    *.test.ts|*.test.tsx|*.test.js|*.test.jsx) return 0 ;;
    *.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx) return 0 ;;
    *.test.sh|*.test.py) return 0 ;;
    */__tests__/*|__tests__/*) return 0 ;;
    e2e/fixtures/*|*/e2e/fixtures/*) return 0 ;;
  esac
  return 1
}

# Patterns. Each line: "label|regex".
# `grep -E` extended-regex syntax. Use `\b` word boundaries where useful.
patterns=(
  "aws_access_key_id|\bAKIA[0-9A-Z]{16}\b"
  "google_api_key|\bAIza[0-9A-Za-z_-]{35}\b"
  "anthropic_api_key|\bsk-ant-[A-Za-z0-9_-]{40,}\b"
  "openai_api_key|\bsk-(?!ant-)(proj-)?[A-Za-z0-9_-]{40,}\b"
  "github_pat|\bgh[pousr]_[A-Za-z0-9]{36,}\b"
  "slack_token|\bxox[baprs]-[A-Za-z0-9-]{10,}\b"
  "stripe_key|\b(sk|pk|rk)_(test|live)_[A-Za-z0-9]{24,}\b"
  "private_key_block|-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"
  "bcrypt_hash|\\\$2[aby]\\\$[0-9]{2}\\\$[A-Za-z0-9./]{53}"
  "hardcoded_password|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd][[:space:]]*[=:][[:space:]]*[\"'][A-Za-z0-9!@#\$%^&*()_+=-]{6,}[\"']"
  "postgres_with_password|postgres(ql)?://(?![^:]*\\$\\{)[^:/]+:(?!\\$\\{)[^@\\s]+@(?!(localhost|127\\.0\\.0\\.1|::1))"
)

found_offenders=0
offender_lines=()
# Dedup tracker: a flat newline-delimited string of "path:lineno" keys
# already labeled. Avoids `declare -A` (associative arrays, bash 4+) so
# the hook works on the bash 3.2 that ships at /bin/bash on macOS.
# Pattern array order matters — earlier patterns (e.g. anthropic) take
# precedence over later overlapping ones (e.g. openai) on the same line,
# so a `sk-ant-...` token is labeled as Anthropic, not OpenAI.
flagged_keys=$'\n' # leading newline so grep -F line-anchored search works

for path in "${staged_files[@]}"; do
  [ -z "$path" ] && continue
  if should_skip_path "$path"; then
    continue
  fi

  # Skip binaries — `grep -I` excludes them but only when reading from a
  # file. Pre-check via file existence + null-byte heuristic.
  if [ ! -f "$path" ]; then
    continue
  fi
  if LC_ALL=C grep -Iq . "$path" 2>/dev/null; then
    : # text file, scan
  else
    continue
  fi

  # Run patterns. PCRE-flavor regex (negative lookahead) goes through
  # python; plain ERE goes through grep -E. Result is a stream of
  # `lineno:matched-line` pairs that we tag with the label.
  for entry in "${patterns[@]}"; do
    label="${entry%%|*}"
    regex="${entry#*|}"
    if [[ "$regex" == *"(?!"* ]]; then
      # PCRE-required (negative lookahead). Python3 ships on every
      # macOS dev + Linux CI; no extra install needed.
      matches=$(REGEX="$regex" PFILE="$path" python3 -c '
import os, re, sys
pat = re.compile(os.environ["REGEX"])
try:
    with open(os.environ["PFILE"], "r", errors="replace") as f:
        for i, line in enumerate(f, 1):
            if pat.search(line):
                print(f"{i}:{line.rstrip()}")
except Exception:
    pass
' 2>/dev/null) || true
    else
      # `--` end-of-options sentinel so patterns starting with `-` (e.g.
      # `-----BEGIN ...PRIVATE KEY-----`) aren't parsed as flags by
      # ugrep / strict POSIX grep.
      matches=$(grep -nE -- "$regex" "$path" 2>/dev/null) || true
    fi
    if [ -n "$matches" ]; then
      while IFS= read -r match_line; do
        # Extract leading "lineno:" so we can build a dedup key. The
        # newline-anchored grep prevents `:1` matching `:11` etc.
        lineno="${match_line%%:*}"
        key="$path:$lineno"
        case "$flagged_keys" in
          *$'\n'"$key"$'\n'*)
            # already flagged by an earlier (more-specific) pattern
            ;;
          *)
            flagged_keys="$flagged_keys$key"$'\n'
            offender_lines+=("[$label] $path:$match_line")
            found_offenders=1
            ;;
        esac
      done <<< "$matches"
    fi
  done
done

if [ "$found_offenders" -eq 1 ]; then
  echo ""
  echo "[pre-commit] ❌ secret scanner found ${#offender_lines[@]} potential leak(s):"
  echo ""
  for line in "${offender_lines[@]}"; do
    echo "  $line"
  done
  echo ""
  echo "  Fix:"
  echo "    1. If real secret → remove it; rotate the credential immediately."
  echo "    2. If false positive → wrap with a comment + ASK for an allowlist"
  echo "       extension (don't add yourself; this gate exists to catch what"
  echo "       human review misses)."
  echo "    3. Emergency bypass: \`git commit --no-verify\`."
  echo ""
  exit 1
fi

# All clean. Silent on success — pre-commit already prints scanner status.
exit 0
