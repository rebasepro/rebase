#!/usr/bin/env bash
# Rebuild everything design-sync consumes from packages/ui.
#
# Two steps, and the order matters: the package build starts with `rm -rf dist`,
# which deletes the compiled Tailwind stylesheet, so the CSS compile must follow
# it. @rebasepro/ui ships no compiled CSS of its own (see tailwind-entry.css).
#
# Run from anywhere: `bash tooling/design-sync/rebuild.sh`
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

if [ "${1:-}" != "--css-only" ]; then
  echo "==> building @rebasepro/ui"
  pnpm --filter @rebasepro/ui build
fi

echo "==> compiling Tailwind utilities for the design system"
node .ds-sync/node_modules/@tailwindcss/cli/dist/index.mjs \
  -i tooling/design-sync/tailwind-entry.css \
  -o packages/ui/dist/_design-sync-compiled.css

ls -la packages/ui/dist/_design-sync-compiled.css
