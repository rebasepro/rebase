#!/bin/bash
#
# Rebuilds and deploys rebase.pro from committed `origin/main`, on a schedule.
#
# It exists because blog posts are date-gated (see src/utils/blog.ts): a post
# with a future `pubDate` is not built at all until a build runs past that date.
# Nothing publishes itself on a static site — something has to rebuild. This is
# that something.
#
# WHAT IT PUBLISHES: whatever is committed on origin/main. Not the working tree.
# That distinction is the whole reason for the worktree below — a scheduled
# `pnpm deploy` in the main checkout would publish whatever half-finished work
# happened to be sitting there at 09:00 on a Tuesday.
#
# Run it by hand any time:  website/scripts/scheduled-publish.sh
# Dry run (build, no deploy):  DRY_RUN=1 website/scripts/scheduled-publish.sh
# Logs:  ~/.rebase-publish/publish.log
# Disable:  launchctl unload ~/Library/LaunchAgents/pro.rebase.website-publish.plist
#
# ON FAILURE it notifies three ways, because a job nobody watches that fails
# quietly is the same as no job at all: a desktop notification, a marker file on
# the Desktop, and the log. The marker exists because a notification can be
# suppressed by macOS without saying so — `osascript` exits 0 either way — and a
# channel whose failure is invisible is not a channel.

set -euo pipefail

# launchd starts jobs with a near-empty environment, so every binary is either
# absolute or on a PATH we set ourselves. Nothing here may rely on the
# interactive shell's profile.
export PATH="/Users/francesco/.nvm/versions/node/v22.23.2/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="/Users/francesco/rebase"
PUBLISH_ROOT="$HOME/.rebase-publish"
WT="$PUBLISH_ROOT/worktree"
LOG="$PUBLISH_ROOT/publish.log"

# `git` on PATH here is 2.23.0 (2019) and has no `sparse-checkout`. This one is
# 2.39.5. Naming it explicitly also keeps the job independent of PATH order.
GIT="/usr/bin/git"
PNPM="/opt/homebrew/bin/pnpm"
FIREBASE="/opt/homebrew/bin/firebase"

mkdir -p "$PUBLISH_ROOT"
exec >> "$LOG" 2>&1

NOTIFIER="/opt/homebrew/bin/terminal-notifier"
MARKER="$HOME/Desktop/REBASE-PUBLISH-FAILED.txt"
NOTIFIED=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Three channels, deliberately. terminal-notifier registers as its own app and
# is the one most likely to actually appear; osascript is the fallback; the
# Desktop marker is the one that cannot be silently dropped by notification
# settings, and it is what you will actually see on a Tuesday.
notify() {
	local msg="$1"
	if [ -x "$NOTIFIER" ]; then
		"$NOTIFIER" -title "Rebase publish failed" -message "$msg" \
			-sound Basso -open "file://$LOG" >/dev/null 2>&1 || true
	fi
	/usr/bin/osascript -e "display notification \"$msg\" with title \"Rebase publish failed\" sound name \"Basso\"" >/dev/null 2>&1 || true
	{
		echo "Rebase scheduled publish FAILED"
		echo "$(date '+%Y-%m-%d %H:%M:%S')"
		echo
		echo "$msg"
		echo
		echo "Full log: $LOG"
		echo "Re-run by hand: /Users/francesco/rebase/website/scripts/scheduled-publish.sh"
		echo "This file is deleted automatically by the next successful run."
	} > "$MARKER" 2>/dev/null || true
	NOTIFIED=1
}

fail() { log "FAILED: $*"; notify "$*"; exit 1; }

# Covers the failures that do not go through fail(): `set -e` aborts, a killed
# build, a syntax error added later. Without this, exactly the unexpected
# failures — the ones worth hearing about — would be the silent ones.
on_exit() {
	local code=$?
	if [ "$code" -ne 0 ] && [ "$NOTIFIED" -eq 0 ]; then
		log "FAILED: unexpected exit $code"
		notify "Unexpected exit $code. See the log."
	fi
}
trap on_exit EXIT

log "──────── scheduled publish starting ────────"

for bin in "$GIT" "$PNPM" "$FIREBASE"; do
	[ -x "$bin" ] || fail "missing binary: $bin"
done

# The worktree is a checkout of origin/main with `packages/` sparse-excluded and
# symlinked to the main checkout instead. Two copies of the same package break
# resolution: the website resolves @rebasepro/app through website/node_modules,
# which realpaths into the main checkout, while a second copy of the same source
# sits in the worktree — and rolldown cannot reconcile them. One copy, always.
if [ ! -d "$WT/.git" ] && [ ! -f "$WT/.git" ]; then
	log "creating publish worktree at $WT"
	"$GIT" -C "$REPO" -c core.fsmonitor=false worktree add --detach "$WT" origin/main >/dev/null
	"$GIT" -C "$WT" -c core.fsmonitor=false sparse-checkout init --cone >/dev/null
	"$GIT" -C "$WT" -c core.fsmonitor=false sparse-checkout set website docs app examples contracts tooling tests >/dev/null
fi

log "fetching origin/main"
"$GIT" -C "$REPO" -c core.fsmonitor=false fetch origin main --quiet || fail "fetch failed"

# Discard anything left in the worktree and match origin/main exactly. The
# worktree is disposable by design; it is never a place to edit.
"$GIT" -C "$WT" -c core.fsmonitor=false reset --hard origin/main --quiet || fail "reset failed"

# Re-establish the symlinks: `reset --hard` can restore real directories over
# them, and a stale symlink here silently builds the wrong tree.
ln -sfn "$REPO/packages" "$WT/packages"
ln -sfn "$REPO/node_modules" "$WT/node_modules"
ln -sfn "$REPO/website/node_modules" "$WT/website/node_modules"

COMMIT=$("$GIT" -C "$WT" -c core.fsmonitor=false rev-parse --short HEAD)
log "building rebase.pro at origin/main ($COMMIT)"

cd "$WT/website"
"$PNPM" build || fail "site build failed"

# What the build decided to publish. Recorded every run, because the failure
# this job can have that looks most like success is building a site whose date
# gate never opened.
POSTS=$(ls dist/blog 2>/dev/null | grep -v '^index.html$' | tr '\n' ' ')
log "posts live in this build: $POSTS"

# The silent failure this job can have: the build succeeds, deploys, and reports
# nothing wrong, while a post whose date has arrived was never rendered. Nothing
# above would notice — a date gate that never opens looks exactly like a date
# gate with nothing due. So compare what SHOULD be live against what is.
TODAY=$(date '+%Y-%m-%d')
MISSING=""
for md in src/content/blog/*.md; do
	[ -e "$md" ] || continue
	head -n 12 "$md" | grep -q '^draft: true' && continue
	pub=$(head -n 12 "$md" | sed -n 's/^pubDate: *//p' | head -1 | cut -c1-10)
	[ -n "$pub" ] || continue
	# String compare is safe on zero-padded YYYY-MM-DD.
	[ "$pub" \> "$TODAY" ] && continue
	slug=$(basename "$md" .md)
	[ -d "dist/blog/$slug" ] || MISSING="$MISSING $slug"
done
if [ -n "$MISSING" ]; then
	fail "post(s) due but not built:$MISSING — the date gate did not open. Nothing was deployed."
fi

if [ "${DRY_RUN:-0}" = "1" ]; then
	rm -f "$MARKER" 2>/dev/null || true
	log "DRY_RUN=1 — built but not deployed"
	log "──────── done (dry run) ────────"
	exit 0
fi

log "deploying to firebase hosting (rebase-578f2)"
"$FIREBASE" deploy --only hosting --project rebase-578f2 --non-interactive \
	|| fail "firebase deploy failed — check that 'firebase login:list' still shows an account"

rm -f "$MARKER" 2>/dev/null || true
log "──────── deployed $COMMIT ────────"
