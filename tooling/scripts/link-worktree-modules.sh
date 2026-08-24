#!/usr/bin/env bash
# Wire a worktree's node_modules to the primary checkout's install, WITHOUT
# letting workspace packages resolve back into the primary.
#
# `pnpm install` must never run in a worktree (it prunes importers the worktree
# cannot see — see docs), so a worktree borrows the primary's node_modules. The
# naive way, one symlink per importer, silently defeats the whole exercise: the
# `@rebasepro/*` entries pnpm wrote are *relative* links, so resolving them
# through a symlinked node_modules lands in the PRIMARY's packages/ and the
# worktree's own edits are invisible to vite, tsx and jest alike.
#
# So each importer gets a real node_modules directory whose entries are absolute
# links into the primary's install, except `@rebasepro`, which is rebuilt to
# point at this worktree's packages/.
set -euo pipefail

PRIMARY="${1:-}"
if [ -z "$PRIMARY" ]; then
    echo "usage: $0 <path-to-primary-checkout>" >&2
    exit 2
fi
WORKTREE="$(cd "$(dirname "$0")/../.." && pwd)"

if [ "$PRIMARY" = "$WORKTREE" ]; then
    echo "refusing to run against the primary checkout itself" >&2
    exit 2
fi

link_importer() {
    local rel="$1"
    local src="$PRIMARY/$rel/node_modules"
    local dst="$WORKTREE/$rel/node_modules"
    [ -d "$src" ] || return 0
    [ -d "$WORKTREE/$rel" ] || return 0

    rm -rf "$dst"
    mkdir -p "$dst"
    for entry in "$src"/* "$src"/.bin "$src"/.pnpm; do
        [ -e "$entry" ] || continue
        local name
        name="$(basename "$entry")"
        [ "$name" = "@rebasepro" ] && continue
        ln -s "$entry" "$dst/$name"
    done

    if [ -d "$src/@rebasepro" ]; then
        mkdir -p "$dst/@rebasepro"
        for entry in "$src"/@rebasepro/*; do
            [ -e "$entry" ] || continue
            local name
            name="$(basename "$entry")"
            if [ -d "$WORKTREE/packages/$name" ]; then
                ln -s "$WORKTREE/packages/$name" "$dst/@rebasepro/$name"
            else
                ln -s "$entry" "$dst/@rebasepro/$name"
            fi
        done
    fi
    echo "linked $rel"
}

link_importer "."
for p in "$WORKTREE"/packages/*/; do
    link_importer "packages/$(basename "$p")"
done
# Keep this list in step with `packages:` in pnpm-workspace.yaml. `e2e` used to
# be here and is gone — it moved under tests/ and is no longer an importer.
# `saas/*` is deliberately absent: it is gitignored, so a worktree never has it.
for p in app app/frontend app/backend app/config website tooling/videos tooling/rebase-agent-skills; do
    link_importer "$p"
done
for p in "$WORKTREE"/examples/*/; do
    [ -d "$p" ] && link_importer "examples/$(basename "$p")"
done
