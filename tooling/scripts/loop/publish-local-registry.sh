#!/usr/bin/env bash
# Publish this checkout's @rebasepro/* packages to a LOCAL registry (Verdaccio),
# under a fresh prerelease version, then put every package.json back.
#
#   tooling/scripts/loop/publish-local-registry.sh [registry-url]
#
# Prints the version it published on the last line. The packages must already
# be built (`pnpm --filter './packages/*' -r run build`).
#
# Why a new version every time: pnpm treats name@version as immutable, so a
# republish of the same version is silently ignored by `pnpm dlx` and installs
# through every cache purge. Why the per-file revert: a pathspec like
# 'packages/*/package.json' crosses directories in git and would also revert
# templates/**/package.json.
#
# Refuses any registry that is not on this machine: this script must never be
# able to publish to npm.
set -euo pipefail

REGISTRY="${1:-http://127.0.0.1:4873/}"
case "$REGISTRY" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) echo "refusing to publish to a non-local registry: $REGISTRY" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

if ! git diff --quiet -- 'packages/*/package.json' tooling/rebase-agent-skills/package.json; then
    echo "package.json files have uncommitted changes; refusing (the revert would discard them)" >&2
    exit 2
fi

BASE="$(node -p "require('./packages/cli/package.json').version")"
# Next patch, so the version sorts above the published release it is built from.
NEXT="$(node -p "const [a,b,c]='${BASE}'.split('-')[0].split('.').map(Number); [a,b,c+1].join('.')")"
VERSION="${NEXT}-loop.$(date +%Y%m%d%H%M%S)"

MANIFESTS=()
for f in packages/*/package.json tooling/rebase-agent-skills/package.json; do
    if node -e "const p=require('./$f'); process.exit(p.private ? 1 : 0)"; then
        MANIFESTS+=("$f")
    fi
done

revert() {
    for f in "${MANIFESTS[@]}"; do git checkout -- "$f"; done
}
trap revert EXIT

for f in "${MANIFESTS[@]}"; do
    node -e "
        const fs = require('fs');
        const p = JSON.parse(fs.readFileSync('$f', 'utf8'));
        p.version = '$VERSION';
        fs.writeFileSync('$f', JSON.stringify(p, null, 2) + '\n');
    "
done

REG_HOST="${REGISTRY#http://}"
REG_HOST="${REG_HOST%/}"
NPMRC="$(mktemp)"
printf '//%s/:_authToken=%s\n' "$REG_HOST" "${LOCAL_REGISTRY_TOKEN:-local}" > "$NPMRC"

FILTERS=()
for f in "${MANIFESTS[@]}"; do FILTERS+=(--filter "./$(dirname "$f")"); done

NPM_CONFIG_USERCONFIG="$NPMRC" pnpm "${FILTERS[@]}" -r publish \
    --registry "$REGISTRY" --no-git-checks --tag latest --access public >&2
rm -f "$NPMRC"

echo "$VERSION"
