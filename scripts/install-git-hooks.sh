#!/usr/bin/env bash
#
# Install project git hooks. Run once after cloning, or whenever hooks change.
#
# Installs:
#   pre-commit — secret scanner (scripts/pre-commit-secret-scan.sh)

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || {
  echo "Error: not inside a git repository. Run 'git init' first." >&2
  exit 1
})

hooks_dir="$repo_root/.git/hooks"
mkdir -p "$hooks_dir"

# pre-commit: delegate to the versioned script
cat > "$hooks_dir/pre-commit" <<'EOF'
#!/usr/bin/env bash
repo_root=$(git rev-parse --show-toplevel)
exec bash "$repo_root/scripts/pre-commit-secret-scan.sh"
EOF
chmod +x "$hooks_dir/pre-commit"
chmod +x "$repo_root/scripts/pre-commit-secret-scan.sh"

echo "✓ Installed pre-commit secret scanner"
echo ""
echo "Test it by staging a file that contains an AWS-style fake key (see README or run:"
echo "    printf 'const k=\"AKIA%s\"' I0123456789012345 > tmp-secret.ts && git add tmp-secret.ts && git commit -m test"
echo ")"
echo ""
