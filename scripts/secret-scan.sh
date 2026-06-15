#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

FAILED=0

secret_patterns=(
  '-----BEGIN RSA PRIVATE KEY'
  '-----BEGIN EC PRIVATE KEY'
  '-----BEGIN DSA PRIVATE KEY'
  '-----BEGIN OPENSSH PRIVATE KEY'
  'PRIVATE KEY-----'
  ' POSTGRES_PASSWORD=.'
  ' TAMI_SECRET_KEY=.'
  ' TAMI_JWK_K=.'
  'DATABASE_URL="*postgres://[^"<]*@' 
)

env_like_files=(
  '.env'
  '.env.production'
  '.env.local'
  '.env.staging'
  '.env.bak'
)

echo "=========================================="
echo " Secret Hygiene Scan"
echo "=========================================="
echo ""

# 1. Check tracked env-like files
echo "--- 1. Tracked env-like files ---"
tracked_envs=$(git ls-files -- '.env' '.env.production' '.env.local' '.env.bak' '.env.bak-*' '.env.*.local' 'id_rsa' 'id_ed25519' '*.pem' '*.key' '*.p12' '*.pfx' 2>/dev/null || true)

if [ -n "$tracked_envs" ]; then
  echo -e "${RED}FAIL: Tracked secret files found:${NC}"
  echo "$tracked_envs" | while IFS= read -r f; do
    echo -e "  ${RED}$f${NC}"
  done
  FAILED=1
else
  echo -e "${GREEN}OK: No env/key files are tracked by git${NC}"
fi
echo ""

# 2. Check staged diff for secrets
echo "--- 2. Staged diff check ---"
staged_diff=$(git diff --cached --diff-filter=ACMR --name-only 2>/dev/null || true)

if [ -n "$staged_diff" ]; then
  for pattern in "${secret_patterns[@]}"; do
    matches=$(git diff --cached -S "$pattern" --name-only 2>/dev/null || true)
    if [ -n "$matches" ]; then
      echo -e "${RED}FAIL: Staged files contain pattern '$pattern':${NC}"
      echo "$matches" | while IFS= read -r f; do
        echo -e "  ${RED}$f${NC}"
      done
      FAILED=1
    fi
  done

  staged_env=$(echo "$staged_diff" | grep -E '^\.env$|^\.env\.production$|^\.env\.local$|^\.env\.staging$|^\.env\.bak|^id_rsa$|^id_ed25519$|\.pem$|\.key$|\.p12$|\.pfx$' || true)
  if [ -n "$staged_env" ]; then
    echo -e "${RED}FAIL: Staged secret files detected:${NC}"
    echo "$staged_env" | while IFS= read -r f; do
      echo -e "  ${RED}$f${NC}"
    done
    FAILED=1
  fi

  if [ "$FAILED" -eq 0 ]; then
    echo -e "${GREEN}OK: No secrets in staged diff${NC}"
  fi
else
  echo -e "${GREEN}OK: No staged changes to scan${NC}"
fi
echo ""

# 3. Check git grep for secrets in tracked files
echo "--- 3. Tracked file content scan ---"
for pattern in "${secret_patterns[@]}"; do
  matches=$(git grep -l -- "$pattern" -- ':!*.example' ':!*.md' ':!*.ts' ':!*.tsx' ':!*.json' ':!*.lock' ':!*.sql' ':!docs/*' ':!SECURITY.md' 2>/dev/null || true)
  # Only flag non-example, non-doc env files
  if [ -n "$matches" ]; then
    filtered=$(echo "$matches" | grep -vE '\.example$|\.md$|\.ts$|\.tsx$|\.json$|\.lock$|\.sql$|docs/|SECURITY\.md' || true)
    if [ -n "$filtered" ]; then
      echo -e "${YELLOW}WARN: Pattern '$pattern' found in:${NC}"
      echo "$filtered" | while IFS= read -r f; do
        echo -e "  ${YELLOW}$f${NC}"
      done
    fi
  fi
done
echo -e "${GREEN}OK: Tracked file scan complete${NC}"
echo ""

# 4. Check git ignore status for env files
echo "--- 4. Gitignore verification ---"
all_ok=true
for f in .env .env.production .env.local .env.staging; do
  if [ -f "$f" ]; then
    if git check-ignore -q "$f" 2>/dev/null; then
      echo -e "${GREEN}OK: $f is gitignored${NC}"
    else
      echo -e "${RED}FAIL: $f exists but is NOT gitignored${NC}"
      FAILED=1
      all_ok=false
    fi
  else
    echo -e "${GREEN}OK: $f does not exist (no issue)${NC}"
  fi
done

for f in .env.example; do
  if [ -f "$f" ]; then
    if git check-ignore -q "$f" 2>/dev/null; then
      echo -e "${RED}FAIL: $f should NOT be gitignored${NC}"
      FAILED=1
      all_ok=false
    else
      echo -e "${GREEN}OK: $f is tracked (not ignored)${NC}"
    fi
  fi
done

bak_files=$(find . -maxdepth 1 -name '.env.bak-*' -o -name '*.env.bak' -o -name '*.env.backup' 2>/dev/null || true)
if [ -n "$bak_files" ]; then
  echo -e "${YELLOW}WARN: Backup env files found in repo root (should be moved out):${NC}"
  echo "$bak_files" | while IFS= read -r f; do
    echo -e "  ${YELLOW}$f${NC}"
  done
fi
echo ""

# 5. Check .env.example has no real secrets
echo "--- 5. .env.example placeholder check ---"
if [ -f ".env.example" ]; then
  real_values=$(grep -cE '(sk_live|pk_live|AKIA[A-Z0-9]{12,})' .env.example 2>/dev/null || true)
  placeholder_urls=$(grep -cE '(your-project-id|<project-ref>|<password>|<secret>|<key>|<replace)' .env.example 2>/dev/null || true)
  real_values=${real_values:-0}
  placeholder_urls=${placeholder_urls:-0}
  if [ "$real_values" -gt 0 ]; then
    echo -e "${RED}FAIL: .env.example may contain real secret values ($real_values suspicious lines)${NC}"
    FAILED=1
  elif [ "$placeholder_urls" -gt 0 ]; then
    echo -e "${GREEN}OK: .env.example contains placeholder URLs with template values ($placeholder_urls template lines)${NC}"
  else
    echo -e "${GREEN}OK: .env.example appears to contain placeholders only${NC}"
  fi
else
  echo -e "${YELLOW}WARN: .env.example not found${NC}"
fi
echo ""

# Result
echo "=========================================="
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}PASSED: Secret hygiene scan clean${NC}"
else
  echo -e "${RED}FAILED: Secret hygiene issues detected (see above)${NC}"
fi
echo "=========================================="

exit $FAILED