#!/bin/bash

# Ensure we exit on error
set -e

# Verify npm version (requires 11.10.0+)
NPM_VER=$(npm --version)
IFS='.' read -r MAJOR MINOR PATCH <<< "$NPM_VER"
if [ "$MAJOR" -lt 11 ] || { [ "$MAJOR" -eq 11 ] && [ "$MINOR" -lt 10 ]; }; then
  echo "❌ Error: Your active npm version ($NPM_VER) is older than 11.10.0."
  echo "The 'npm trust' command is only supported on npm v11.10.0 and higher."
  echo ""
  echo "Please do one of the following to update your active environment:"
  echo "  1. Switch to Node 22+ (which includes npm 11+) using a version manager:"
  echo "     nvm use 22"
  echo "  2. Or update npm globally in your current terminal session:"
  echo "     npm install -g npm@latest"
  echo ""
  exit 1
fi

REPO="rebasepro/rebase"
# npm allows exactly one trusted publisher per package, and `npm trust github`
# takes exactly one --file. Stable and canary therefore live as two jobs in one
# workflow: trusting two files was never possible, and asking for it made npm
# answer the second call with a 409 that this script read as "already done".
WORKFLOW="publish.yml"

# ─────────────────────────────────────────────────────────────
# 2FA
# ─────────────────────────────────────────────────────────────
# Every `npm trust` call is a 2FA-gated account write, and npm handles that
# itself: it opens the browser, you approve with the passkey, and the session is
# reused for the packages that follow. This script's job is to stay out of its
# way — see trust_call for why that is harder than it sounds.
#
# --otp exists only as an escape hatch. There is no authenticator app on this
# account and there cannot be one (npm ended TOTP enrolment), so the only code
# that can be passed here is an unused single-use recovery code. Do not reach
# for it unless npm's own browser flow is unavailable.
#
#   ./tooling/scripts/setup-trusted-publishers.sh              # npm asks, via browser
#   ./tooling/scripts/setup-trusted-publishers.sh --otp <recovery-code>
OTP="${NPM_OTP:-}"
ASSUME_YES=false
DRY_RUN=false
FAILED=()  # packages npm refused; see the summary at the end

while [ $# -gt 0 ]; do
  case "$1" in
    --otp) OTP="${2:-}"; shift 2 ;;
    --otp=*) OTP="${1#*=}"; shift ;;
    -y|--yes) ASSUME_YES=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--otp <code>] [--dry-run] [-y]"
      echo ""
      echo "Points every publishable package's npm trusted publisher at this"
      echo "repo's $WORKFLOW, which runs both the stable and canary jobs."
      echo "npm opens a browser for the passkey; no code is needed."
      echo ""
      echo "  --otp <code>  Escape hatch. This account has no authenticator app,"
      echo "                so the only valid code is an unused recovery code."
      echo "  --dry-run     Audit: read what each package trusts, change nothing."
      echo "  -y, --yes     Skip the confirmation prompt."
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# One `npm trust` call, with npm left connected to the terminal.
#
# npm's output is deliberately NOT captured. `out=$(npm trust ... 2>&1)` makes
# npm's stdout a pipe; npm reads a non-TTY stdout as "nobody is watching", and
# so instead of opening the browser for the passkey it prints its auth URL and
# exits with EOTP. The redactor then masks that URL to `***` — which looked like
# npm making the browser flow unusable, and cost this script a detour into
# --otp, a code that cannot exist on a passkey-only account.
#
# The capture was the bug. Given a terminal, npm runs its own web auth once and
# reuses the session for the packages that follow.
#
# Each failure is recorded and the loop continues rather than aborting on the
# first one, so one refusal cannot strand the rest.
trust_call() {
  local pkg="$1" workflow="$2" rc=0

  # npm permits exactly one trusted publisher per package and `npm trust github`
  # will not replace an existing one — it answers 409. So read before writing:
  # a package configured before the workflows were merged still names
  # publish-stable.yml, a file that no longer exists, and would fail to publish.
  #
  # `list` is a read, so capturing it is safe. The writes below must NOT be
  # captured — see the note above about npm and a non-TTY stdout.
  local current parsed file id
  current=$(npm trust list "$pkg" --json 2>/dev/null || true)
  # Single-quoted so the JS may use double quotes. Emits "<file> <id>", or
  # "! <code>" when npm reported an error rather than a config.
  parsed=$(printf '%s' "$current" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j;
      try { j = JSON.parse(s) } catch { console.log("! unparseable"); return }
      if (j.error) { console.log("! " + (j.error.code || "unknown")); return }
      console.log((j.file || "-") + " " + (j.id || "-"));
    })')
  file=${parsed%% *}
  id=${parsed##* }

  # An error is not "no config". npm answers EOTP once the browser session has
  # lapsed, and reading that as "nothing is configured" would report every
  # already-correct package as needing one — which is exactly how this script
  # once claimed all 21 were unconfigured minutes after OIDC published all 21.
  if [ "$file" = "!" ]; then
    echo "     ✗ Could not read $pkg's trust config (npm said: $id)." >&2
    return 1
  fi

  if [ "$file" = "$workflow" ]; then
    echo "     ✓ Already trusts $workflow — nothing to do."
    return 0
  fi

  if $DRY_RUN; then
    if [ "$id" = "-" ]; then
      echo "     (dry run) would ADD    → --file $workflow"
    else
      echo "     (dry run) would REVOKE → '$file' (id $id), then ADD → '$workflow'"
    fi
    return 0
  fi

  # Stale config: revoke it, since only one may exist and it names a workflow
  # that is gone.
  if [ "$id" != "-" ]; then
    echo "     ↻ Trusts '$file', which no longer exists — revoking it first."
    npm trust revoke "$pkg" --id="$id" < /dev/tty || {
      echo "     ✗ Could not revoke $pkg's existing trust." >&2
      return 1
    }
  fi

  local -a cmd=(npm trust github "$pkg" --file "$workflow" --repo "$REPO" --allow-publish -y)
  [ -n "$OTP" ] && cmd+=(--otp="$OTP")
  "${cmd[@]}" < /dev/tty || rc=$?
  return $rc
}

echo "🔍 Finding publishable packages in the workspace..."
# Exactly the set release.sh publishes:
#   pnpm --filter './packages/*' --filter './rebase-agent-skills' -r publish
#
# Not a recursive hunt for package.json. That walked into a leftover git
# worktree under .claude/ and offered to configure trust for 43 "packages",
# 11 of them names that no longer exist. Trust must be configured for what
# actually gets published, so both read the same source.
PACKAGES=$(node -e '
const fs = require("fs");
const path = require("path");
const roots = ["packages", "rebase-agent-skills"];
const names = [];
for (const root of roots) {
  const dirs = fs.existsSync(root) && fs.statSync(root).isDirectory() && !fs.existsSync(path.join(root, "package.json"))
    ? fs.readdirSync(root).map((d) => path.join(root, d))
    : [root];
  for (const dir of dirs) {
    const manifest = path.join(dir, "package.json");
    if (!fs.existsSync(manifest)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (pkg.private) continue;
      if (!pkg.name || !pkg.name.startsWith("@rebasepro/")) continue;
      names.push(pkg.name);
    } catch { /* unreadable manifest — not publishable */ }
  }
}
console.log([...new Set(names)].sort().join("\n"));
')

if [ -z "$PACKAGES" ]; then
  echo "❌ No publishable @rebasepro/ packages found."
  exit 1
fi

PKG_COUNT=$(echo "$PACKAGES" | grep -c .)

echo "📦 Found publishable packages:"
for pkg in $PACKAGES; do
  echo "  - $pkg"
done
echo ""

echo "⚠️  Before running, make sure you:"
echo "   1. Are logged into npm locally (run 'npm login' if needed)"
echo "   2. Have npm v11.10.0 or higher installed (you have: $(npm --version))"
echo ""
if $DRY_RUN; then
  echo "🧪 Dry run — reads each package's current trust from npm and prints what"
  echo "   would change. Writes nothing. Use it to audit what each package trusts."
else
  echo "🔐 Each 'npm trust' call is a 2FA-gated account write. npm handles that"
  echo "   itself: it will open your browser, you approve with your passkey, and"
  echo "   the session carries the remaining packages. Nothing to look up here."
fi
echo ""
if ! $ASSUME_YES; then
  # Reads the whole line, not one character: a bare `-n 1` takes the "y" and
  # leaves the Enter behind, and the next read of /dev/tty consumes that stale
  # newline as an empty answer instead of waiting for the 2FA code.
  read -p "Proceed to configure Trusted Publishers for these packages? (y/N) " -r < /dev/tty
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# Authenticate once, here, with npm connected to the terminal.
#
# npm's 2FA browser flow needs a TTY on stdout, and every `npm trust list` in
# the loop below is captured — a pipe. npm would answer those with EOTP instead
# of opening the browser, and each would read as "nothing configured": the run
# would then try to add a config to packages that already have a correct one and
# report the resulting 409s as failures. Priming the session here is what makes
# the reads in the loop meaningful.
echo "🔓 Checking npm access — a browser may open for your passkey..."
FIRST_PKG=$(printf '%s\n' "$PACKAGES" | head -n1)
if ! npm trust list "$FIRST_PKG" < /dev/tty; then
  echo ""
  echo "❌ npm would not authenticate, so what each package trusts cannot be read." >&2
  echo "   Run 'npm login' and try again." >&2
  exit 1
fi
echo ""

for pkg in $PACKAGES; do
  echo "------------------------------------------------------------"
  echo "🔐 Configuring OIDC trust for $pkg..."
  echo "  🔹 Publish workflow ($WORKFLOW) — covers stable and canary..."
  # Not fatal: one package npm refuses (often a 409 — it already has a trusted
  # publisher, and only one is allowed) must not strand the other 20.
  if ! trust_call "$pkg" "$WORKFLOW"; then
    echo "     ⚠️  npm refused $pkg — its output is above."
    FAILED+=("$pkg")
  fi
done

echo ""
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "⚠️  Finished, but npm refused ${#FAILED[@]} of $PKG_COUNT package(s):"
  for pkg in "${FAILED[@]}"; do
    echo "     - $pkg → https://www.npmjs.com/package/$pkg/access"
  done
  echo ""
  echo "   A 409 means the package already has a trusted publisher — npm allows"
  echo "   only one and will not say which workflow it names. Open the links and"
  echo "   confirm each names '$WORKFLOW'; a config still naming a workflow that"
  echo "   no longer exists (publish-stable.yml, publish-canary.yml) will fail to"
  echo "   publish. Re-running is safe: configured packages just 409 again."
  exit 1
fi
echo "✅ Success! All $PKG_COUNT packages now trust $REPO's $WORKFLOW."
