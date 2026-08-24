#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# validate-no-workspace-protocol.sh
# ─────────────────────────────────────────────────────────────
# Packs every publishable package and verifies the packed
# package.json contains NO workspace: protocol references.
#
# Usage:
#   ./tooling/scripts/validate-no-workspace-protocol.sh          # pack + check
#   ./tooling/scripts/validate-no-workspace-protocol.sh --quick   # check source only (no pack)
#
# Exit codes:
#   0 = clean
#   1 = workspace: references found
# ─────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

QUICK=false
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
  esac
done

ERRORS=0

if $QUICK; then
  # ── Quick mode: just warn about workspace: in source package.json ──
  echo -e "${BOLD}Checking source package.json files for workspace: references...${RESET}"
  for pkg_json in packages/*/package.json tooling/rebase-agent-skills/package.json; do
    [ -f "$pkg_json" ] || continue

    # Skip private packages
    is_private=$(node -e "console.log(require('./$pkg_json').private || false)" 2>/dev/null)
    [ "$is_private" = "true" ] && continue

    if grep -q '"workspace:' "$pkg_json" 2>/dev/null; then
      pkg_name=$(node -e "console.log(require('./$pkg_json').name)" 2>/dev/null)
      echo -e "${YELLOW}⚠${RESET}  $pkg_name ($pkg_json) has workspace: references (expected in source)"
    fi
  done
  echo -e "${GREEN}✓${RESET}  Quick check done. Use without --quick to validate packed tarballs."
  exit 0
fi

# ── Full mode: pack each package and verify the tarball ──────
PACK_DIR=$(mktemp -d)
trap 'rm -rf "$PACK_DIR"' EXIT

echo -e "${BOLD}Packing and validating all publishable packages...${RESET}"
echo ""

# Get list of publishable package directories
PUBLISHABLE_DIRS=()
for pkg_json in packages/*/package.json tooling/rebase-agent-skills/package.json; do
  [ -f "$pkg_json" ] || continue
  is_private=$(node -e "console.log(require('./$pkg_json').private || false)" 2>/dev/null)
  [ "$is_private" = "true" ] && continue
  PUBLISHABLE_DIRS+=("$(dirname "$pkg_json")")
done

for pkg_dir in "${PUBLISHABLE_DIRS[@]}"; do
  pkg_json="$pkg_dir/package.json"
  pkg_name=$(node -e "console.log(require('./$pkg_json').name)" 2>/dev/null)

  # Pack the package (pnpm pack resolves workspace: protocols)
  pack_output=$(cd "$pkg_dir" && pnpm pack --pack-destination "$PACK_DIR" 2>&1) || {
    echo -e "${RED}✗${RESET}  $pkg_name — pnpm pack failed"
    echo "    $pack_output"
    ERRORS=$((ERRORS + 1))
    continue
  }

  # Find the tarball
  tarball=$(ls -t "$PACK_DIR"/*.tgz 2>/dev/null | head -1)
  if [ -z "$tarball" ]; then
    echo -e "${RED}✗${RESET}  $pkg_name — no tarball produced"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  # Extract package.json from tarball and check for workspace:
  packed_pkg_json=$(tar -xzf "$tarball" -O package/package.json 2>/dev/null)
  if echo "$packed_pkg_json" | grep -q '"workspace:'; then
    echo -e "${RED}✗${RESET}  $pkg_name — ${RED}WORKSPACE: REFERENCES FOUND IN PACKED TARBALL${RESET}"
    echo "    Offending entries:"
    echo "$packed_pkg_json" | grep '"workspace:' | while IFS= read -r line; do
      echo "      $line"
    done
    ERRORS=$((ERRORS + 1))
  else
    echo -e "${GREEN}✓${RESET}  $pkg_name"
  fi

  # Clean up tarball for next iteration
  rm -f "$tarball"
done

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo -e "${RED}${BOLD}✗ $ERRORS package(s) have workspace: references in their packed output.${RESET}"
  echo -e "${RED}  DO NOT PUBLISH until this is fixed.${RESET}"
  exit 1
else
  echo -e "${GREEN}${BOLD}✓ All packages are clean — no workspace: references in packed tarballs.${RESET}"
  exit 0
fi
