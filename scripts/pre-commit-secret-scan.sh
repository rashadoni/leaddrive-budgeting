#!/usr/bin/env bash
#
# Pre-commit secret scanner — detects common credential patterns in staged files.
# Exits non-zero on match so the commit is aborted.
#
# Upgrade path: once the team is ready, replace this with `gitleaks protect --staged`
# or `detect-secrets-hook`. This script is intentionally minimal and dependency-free
# so it works out of the box on any developer machine.
#
# Install: run `bash scripts/install-git-hooks.sh` or symlink into .git/hooks/pre-commit.

set -euo pipefail

# Patterns — extend as needed. Each pattern is `name|regex`.
# Regex uses POSIX extended (for grep -E compat).
PATTERNS=(
  'OpenAI API key|sk-[A-Za-z0-9]{20,}'
  'Anthropic API key|sk-ant-[A-Za-z0-9_-]{20,}'
  'AWS access key|AKIA[0-9A-Z]{16}'
  'Google API key|AIza[0-9A-Za-z_-]{35}'
  'GitHub token|gh[pousr]_[A-Za-z0-9]{36,}'
  'Stripe key|(sk|pk|rk)_(test|live)_[A-Za-z0-9]{24,}'
  'Slack token|xox[baprs]-[A-Za-z0-9-]{10,}'
  'Private key block|-----BEGIN (RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----'
  'Bcrypt hash|\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}'
  # Explicit password assignment with realistic length (catches hardcoded credentials)
  'Hardcoded password assignment|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd][[:space:]]*[=:][[:space:]]*["'"'"'][A-Za-z0-9!@#$%^&*()_+=-]{6,}["'"'"']'
)

# Files to skip: lockfiles, binary assets, the scanner itself, docs listing patterns
SKIP_REGEX='(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.(png|jpg|jpeg|gif|ico|svg|pdf|zip|woff2?|ttf|eot)$|scripts/pre-commit-secret-scan\.sh)'

staged=$(git diff --cached --name-only --diff-filter=ACMR || true)
if [ -z "$staged" ]; then
  exit 0
fi

violations=0
while IFS= read -r file; do
  # Skip files that no longer exist (renamed/removed)
  [ -f "$file" ] || continue
  # Skip binaries / vendored files
  if printf '%s' "$file" | grep -Eq "$SKIP_REGEX"; then
    continue
  fi
  # Skip files bigger than 1MB (likely generated)
  size=$(wc -c < "$file" 2>/dev/null || echo 0)
  if [ "$size" -gt 1048576 ]; then
    continue
  fi
  for entry in "${PATTERNS[@]}"; do
    name=${entry%%|*}
    pat=${entry#*|}
    if match=$(grep -nE "$pat" "$file" 2>/dev/null | head -3); then
      if [ -n "$match" ]; then
        echo ""
        echo "✖ [$name] detected in $file:"
        echo "$match" | sed 's/^/    /'
        violations=$((violations + 1))
      fi
    fi
  done
done <<< "$staged"

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "─────────────────────────────────────────────────"
  echo "Commit aborted: $violations secret-like pattern(s) found in staged files."
  echo ""
  echo "If this is a false positive, you can bypass with:"
  echo "    git commit --no-verify"
  echo "But please double-check — leaked credentials cannot be un-leaked."
  echo "─────────────────────────────────────────────────"
  exit 1
fi

exit 0
