#!/usr/bin/env bash
# Facts for the loop's morning brief. Read-only: prints sections, changes nothing.
# Usage: tooling/scripts/loop/brief.sh
set -u
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
SAAS="$REPO/saas"
REPORTS="$HOME/.rebase-audits/loop"

section() { printf '\n## %s\n' "$1"; }

section "GitHub CI on main"
for r in rebasepro/rebase rebasepro/saas; do
  printf '%s: ' "$r"
  gh -R "$r" run list --branch main --limit 1 --json conclusion,status,workflowName,headSha,createdAt \
    --jq '.[0] | "\(.workflowName) \(.status)/\(.conclusion // "-") \(.headSha[0:10]) \(.createdAt)"' 2>&1
  # When it is red, name the first failed job so the brief can say what broke.
  gh -R "$r" run list --branch main --limit 1 --json databaseId,conclusion \
    --jq '.[0] | select(.conclusion=="failure") | .databaseId' 2>/dev/null |
    while read -r id; do
      gh -R "$r" run view "$id" --json jobs --jq '.jobs[] | select(.conclusion=="failure") | "  failed job: \(.name)"' 2>/dev/null | head -5
    done
done

section "Local main vs origin"
for d in "$REPO" "$SAAS"; do
  [ -d "$d/.git" ] || [ -f "$d/.git" ] || continue
  git -C "$d" fetch -q origin main 2>/dev/null
  ahead=$(git -C "$d" rev-list --count origin/main..main 2>/dev/null)
  behind=$(git -C "$d" rev-list --count main..origin/main 2>/dev/null)
  dirty=$(git -C "$d" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  echo "$(basename "$d"): ahead $ahead, behind $behind, $dirty modified paths"
done

section "Unmerged local branches (rebase)"
git -C "$REPO" branch --no-merged main --format='%(refname:short) %(committerdate:short)' 2>/dev/null | head -30

section "npm"
echo "@rebasepro/cli latest: $(npm view @rebasepro/cli version 2>/dev/null)"
echo "@rebasepro/cli next:   $(npm view @rebasepro/cli dist-tags.next 2>/dev/null)"
echo "last release tag: $(git -C "$REPO" describe --tags --abbrev=0 main 2>/dev/null)"

section "Disk and debris"
df -h / | tail -1
for p in "$REPO/test-cli-init-project" "$REPO/.claude/worktrees"; do
  [ -e "$p" ] && echo "$(du -sh "$p" 2>/dev/null | cut -f1) $p"
done
git -C "$REPO" worktree list 2>/dev/null | wc -l | xargs echo "worktrees:"
docker system df 2>/dev/null | tail -n +2 | awk '{print "docker " $1 ": " $4 " (" $5 " reclaimable)"}'

section "Overnight loop reports (last 24h)"
if [ -d "$REPORTS" ]; then
  find "$REPORTS" -maxdepth 1 -name '20*.md' -mtime -1 -print 2>/dev/null | sort | while read -r f; do
    echo "$(basename "$f"): $(head -1 "$f")"
  done
fi
