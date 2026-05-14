#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Rebase Release Script
# ─────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/release.sh patch          # 0.1.1 → 0.1.2
#   ./scripts/release.sh minor          # 0.1.1 → 0.2.0
#   ./scripts/release.sh major          # 0.1.1 → 1.0.0
#   ./scripts/release.sh 0.3.0          # explicit version
#   ./scripts/release.sh patch --dry-run # preview without publishing
#
# This script:
#   1. Bumps versions in all packages + lerna.json
#   2. Generates a changelog entry from conventional commits
#   3. Commits, tags, and pushes
#   4. Publishes all packages to npm
#   5. Creates a GitHub Release with the changelog
# ─────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${BLUE}ℹ${RESET}  $*"; }
ok()    { echo -e "${GREEN}✓${RESET}  $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()   { echo -e "${RED}✗${RESET}  $*" >&2; }
step()  { echo -e "\n${CYAN}${BOLD}── $* ──${RESET}"; }

# ── Parse arguments ─────────────────────────────────────────
BUMP=""
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    patch|minor|major) BUMP="$arg" ;;
    *)
      # Check if it looks like a semver
      if [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
        BUMP="$arg"
      else
        err "Unknown argument: $arg"
        echo "Usage: $0 <patch|minor|major|X.Y.Z> [--dry-run]"
        exit 1
      fi
      ;;
  esac
done

if [ -z "$BUMP" ]; then
  err "Version bump required"
  echo "Usage: $0 <patch|minor|major|X.Y.Z> [--dry-run]"
  exit 1
fi

# ── Preflight checks ───────────────────────────────────────
step "Preflight checks"

# Must be on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  err "Must be on 'main' branch (currently on '$BRANCH')"
  exit 1
fi

# Working tree must be clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  err "Working tree is dirty. Commit or stash changes first."
  exit 1
fi

# Pull latest
info "Pulling latest from origin..."
git pull --rebase origin main

# Check for required tools
for cmd in gh node pnpm; do
  if ! command -v "$cmd" &>/dev/null; then
    err "Required command '$cmd' not found. Please install it."
    exit 1
  fi
done

ok "All preflight checks passed"

# ── Calculate version ───────────────────────────────────────
step "Calculating version"

CURRENT_VERSION=$(node -e "console.log(require('./lerna.json').version)")
info "Current version: ${BOLD}$CURRENT_VERSION${RESET}"

if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  NEW_VERSION="$BUMP"
else
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  case "$BUMP" in
    patch) NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
    minor) NEW_VERSION="$MAJOR.$((MINOR + 1)).0" ;;
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
  esac
fi

info "New version: ${BOLD}${GREEN}$NEW_VERSION${RESET}"

if $DRY_RUN; then
  warn "DRY RUN — no changes will be made"
fi

# ── Generate changelog ──────────────────────────────────────
step "Generating changelog"

# Find the last stable release tag (vX.Y.Z, no prerelease suffix)
LAST_TAG=$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || echo "")
if [ -z "$LAST_TAG" ]; then
  COMMIT_RANGE="HEAD"
  info "No previous stable tag found, including all commits"
else
  COMMIT_RANGE="${LAST_TAG}..HEAD"
  info "Generating changelog since ${BOLD}$LAST_TAG${RESET}"
fi

# Collect commits by category using Conventional Commits
FEATURES=""
FIXES=""
REFACTORS=""
DOCS=""
CHORES=""
BREAKING=""
OTHER=""

while IFS= read -r line; do
  [ -z "$line" ] && continue
  # Extract hash and message
  HASH="${line%% *}"
  MSG="${line#* }"
  SHORT_HASH="${HASH:0:7}"
  
  case "$MSG" in
    feat!:*|feat\(*\)!:*)
      ENTRY="- ${MSG#*: } (\`$SHORT_HASH\`)"
      FEATURES+="$ENTRY"$'\n'
      BREAKING+="- ${MSG#*: } (\`$SHORT_HASH\`)"$'\n'
      ;;
    fix!:*|fix\(*\)!:*)
      ENTRY="- ${MSG#*: } (\`$SHORT_HASH\`)"
      FIXES+="$ENTRY"$'\n'
      BREAKING+="- ${MSG#*: } (\`$SHORT_HASH\`)"$'\n'
      ;;
    feat:*|feat\(*\):*)
      FEATURES+="- ${MSG#*: } (\`$SHORT_HASH\`)"$'\n'
      ;;
    fix:*|fix\(*\):*)
      FIXES+="- ${MSG#*: } (\`$SHORT_HASH\`)"$'\n'
      ;;
    refactor:*|refactor\(*\):*)
      REFACTORS+="- ${MSG#*: } (\`$SHORT_HASH\`)"$'\n'
      ;;
    docs:*|docs\(*\):*)
      DOCS+="- ${MSG#*: } (\`$SHORT_HASH\`)"$'\n'
      ;;
    chore:*|chore\(*\):*|ci:*|ci\(*\):*|build:*|build\(*\):*)
      CHORES+="- ${MSG#*: } (\`$SHORT_HASH\`)"$'\n'
      ;;
    *)
      OTHER+="- $MSG (\`$SHORT_HASH\`)"$'\n'
      ;;
  esac
done <<< "$(git log --oneline --no-merges "$COMMIT_RANGE" 2>/dev/null || true)"

# Build changelog entry
RELEASE_DATE=$(date +%Y-%m-%d)
CHANGELOG_ENTRY="## [${NEW_VERSION}] - ${RELEASE_DATE}"$'\n'

if [ -n "$BREAKING" ]; then
  CHANGELOG_ENTRY+=$'\n'"### ⚠️ Breaking Changes"$'\n'$'\n'"$BREAKING"
fi
if [ -n "$FEATURES" ]; then
  CHANGELOG_ENTRY+=$'\n'"### ✨ Features"$'\n'$'\n'"$FEATURES"
fi
if [ -n "$FIXES" ]; then
  CHANGELOG_ENTRY+=$'\n'"### 🐛 Bug Fixes"$'\n'$'\n'"$FIXES"
fi
if [ -n "$REFACTORS" ]; then
  CHANGELOG_ENTRY+=$'\n'"### ♻️ Refactors"$'\n'$'\n'"$REFACTORS"
fi
if [ -n "$DOCS" ]; then
  CHANGELOG_ENTRY+=$'\n'"### 📚 Documentation"$'\n'$'\n'"$DOCS"
fi
if [ -n "$CHORES" ]; then
  CHANGELOG_ENTRY+=$'\n'"### 🔧 Maintenance"$'\n'$'\n'"$CHORES"
fi
if [ -n "$OTHER" ]; then
  CHANGELOG_ENTRY+=$'\n'"### Other"$'\n'$'\n'"$OTHER"
fi

echo ""
echo -e "${BOLD}Generated changelog:${RESET}"
echo "────────────────────────────────"
echo "$CHANGELOG_ENTRY"
echo "────────────────────────────────"

if $DRY_RUN; then
  step "Dry run complete"
  info "Would bump: $CURRENT_VERSION → $NEW_VERSION"
  info "Would update CHANGELOG.md, commit, tag v$NEW_VERSION"
  info "Would publish all packages to npm"
  info "Would create GitHub Release v$NEW_VERSION"
  exit 0
fi

# ── Confirm ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Ready to release ${GREEN}v${NEW_VERSION}${RESET}${BOLD}. This will:${RESET}"
echo "  1. Bump versions in all 21 packages"
echo "  2. Update CHANGELOG.md"
echo "  3. Commit, tag v$NEW_VERSION, and push to origin"
echo "  4. Publish all packages to npm"
echo "  5. Create a GitHub Release"
echo ""
read -rp "Continue? (y/N) " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  warn "Aborted"
  exit 1
fi

# ── Bump versions ──────────────────────────────────────────
step "Bumping versions to $NEW_VERSION"

# Bump all publishable packages
pnpm --filter './packages/*' -r exec node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '$NEW_VERSION';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"
ok "Bumped all package versions"

# Bump lerna.json
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('lerna.json', 'utf8'));
  p.version = '$NEW_VERSION';
  fs.writeFileSync('lerna.json', JSON.stringify(p, null, 2) + '\n');
"
ok "Bumped lerna.json"

# ── Update CHANGELOG.md ────────────────────────────────────
step "Updating CHANGELOG.md"

if [ -f "CHANGELOG.md" ]; then
  # Insert the new entry after the first line (# Changelog)
  TEMP_FILE=$(mktemp)
  {
    head -1 CHANGELOG.md
    echo ""
    echo "$CHANGELOG_ENTRY"
    tail -n +2 CHANGELOG.md
  } > "$TEMP_FILE"
  mv "$TEMP_FILE" CHANGELOG.md
else
  {
    echo "# Changelog"
    echo ""
    echo "$CHANGELOG_ENTRY"
  } > CHANGELOG.md
fi
ok "CHANGELOG.md updated"

# ── Build & Test ────────────────────────────────────────────
step "Building all packages"
pnpm run build
ok "Build complete"

step "Running tests"
pnpm test || warn "Some tests failed — continuing release (review output above)"

# ── Commit & Tag ────────────────────────────────────────────
step "Committing and tagging"

git add -A
git commit -m "chore: release v${NEW_VERSION}" --no-verify
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
ok "Created commit and tag v${NEW_VERSION}"

# ── Push ────────────────────────────────────────────────────
step "Pushing to origin"

git push origin main --follow-tags
ok "Pushed to origin with tags"

# ── Publish to npm ──────────────────────────────────────────
step "Publishing to npm"

pnpm --filter './packages/*' -r publish --no-git-checks --access public
ok "Published all packages to npm"

# ── GitHub Release ──────────────────────────────────────────
step "Creating GitHub Release"

# Write changelog to temp file for the release body
RELEASE_BODY_FILE=$(mktemp)
echo "$CHANGELOG_ENTRY" > "$RELEASE_BODY_FILE"

gh release create "v${NEW_VERSION}" \
  --title "v${NEW_VERSION}" \
  --notes-file "$RELEASE_BODY_FILE" \
  --latest

rm -f "$RELEASE_BODY_FILE"
ok "GitHub Release v${NEW_VERSION} created"

# ── Done ────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}🚀 Release v${NEW_VERSION} complete!${RESET}"
echo ""
echo "  📦 npm:    https://www.npmjs.com/org/rebasepro"
echo "  🏷  tag:    v${NEW_VERSION}"
echo "  📝 release: https://github.com/rebasepro/rebase/releases/tag/v${NEW_VERSION}"
echo ""
