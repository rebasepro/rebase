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
# Every `npm trust` call is an account write, so npm demands a one-time
# password. Its browser flow prints an auth URL that npm's own redactor masks
# to `***` — the URL carries the session id, npm cannot tell "secret to hide"
# from "secret to click", and the debug log is redacted too. So the URL flow is
# unusable and the code is passed directly instead.
#
# Codes rotate every ~30s and this loop makes 2 calls per package, so a single
# code will not survive the whole run. Each call is retried with a freshly
# prompted code when npm reports EOTP.
#
#   ./scripts/setup-trusted-publishers.sh --otp 123456
#   NPM_OTP=123456 ./scripts/setup-trusted-publishers.sh
#   ./scripts/setup-trusted-publishers.sh            # prompts when needed
OTP="${NPM_OTP:-}"
ASSUME_YES=false
DRY_RUN=false
CONFLICTS=()  # packages that already had a trusted publisher; see trust_call

while [ $# -gt 0 ]; do
  case "$1" in
    --otp) OTP="${2:-}"; shift 2 ;;
    --otp=*) OTP="${1#*=}"; shift ;;
    -y|--yes) ASSUME_YES=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--otp <code>] [--dry-run] [-y]"
      echo ""
      echo "Configures npm Trusted Publishers (OIDC) for every publishable"
      echo "package, for both the stable and canary workflows."
      echo ""
      echo "  --otp <code>  2FA code. Prompted for when omitted or expired."
      echo "  --dry-run     Print what would be configured; contact no registry."
      echo "  -y, --yes     Skip the confirmation prompt."
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Ask for a fresh code. Reads the terminal directly so it still works when the
# script's stdin is a pipe. Re-asks on an empty line rather than giving up, and
# keeps only the digits, since authenticators display the code as "123 456".
prompt_for_otp() {
  local code=""
  if [ -t 0 ] || [ -r /dev/tty ]; then
    for _ in 1 2 3; do
      read -rp "$1" code < /dev/tty || { code=""; break; }  # real EOF: give up
      code="${code//[^0-9]/}"
      [ -n "$code" ] && break
    done
  fi
  echo "$code"
}

# One `npm trust` call, retried once with a fresh code if the code has expired.
# Prints nothing on success; returns non-zero with the error on the stdout of
# the caller's command substitution otherwise.
trust_call() {
  local pkg="$1" workflow="$2" out=""
  local -a cmd=(npm trust github "$pkg" --file "$workflow" --repo "$REPO" --allow-publish -y)

  if $DRY_RUN; then
    echo "     (dry run) ${cmd[*]} --otp=****"
    return 0
  fi

  for attempt in 1 2 3; do
    if [ -n "$OTP" ]; then
      out=$("${cmd[@]}" --otp="$OTP" 2>&1) && return 0
    else
      out=$("${cmd[@]}" 2>&1) && return 0
    fi

    # A package already has a trusted publisher. npm permits only one, and the
    # 409 does not say which workflow it names — an older publish-stable.yml
    # config conflicts here exactly like a correct publish.yml one. Reported,
    # not swallowed: silently calling this success is how a package ends up
    # trusting a workflow that no longer exists.
    if echo "$out" | grep -q "409 Conflict"; then
      echo "     ⚠️  A trusted publisher already exists for $pkg."
      echo "        npm allows only one and will not say which workflow it names."
      echo "        Confirm it is '$WORKFLOW' at:"
      echo "        https://www.npmjs.com/package/$pkg/access"
      CONFLICTS+=("$pkg")
      return 0
    fi

    # Expired or missing code: ask for another and retry. A code can expire
    # while it is being typed, so the last attempt is not the first one.
    if echo "$out" | grep -qE "EOTP|one-time password|OTP"; then
      if [ "$attempt" -lt 3 ]; then
        echo "     🔑 npm wants a 2FA code (they rotate every ~30s)."
        OTP=$(prompt_for_otp "     Enter your current npm 2FA code: ")
        if [ -z "$OTP" ]; then
          echo "     ✗ No code supplied." >&2
          echo "$out" >&2
          return 1
        fi
        continue
      fi
    fi

    echo "$out" >&2
    return 1
  done
  return 1
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

echo "📦 Found publishable packages:"
for pkg in $PACKAGES; do
  echo "  - $pkg"
done
echo ""

echo "⚠️  Before running, make sure you:"
echo "   1. Are logged into npm locally (run 'npm login' if needed)"
echo "   2. Have 2FA enabled on npm"
echo "   3. Have npm v11.10.0 or higher installed (you have: $(npm --version))"
echo ""
if $DRY_RUN; then
  echo "🧪 Dry run — no registry calls will be made."
else
  echo "⚠️  Each call needs a 2FA code. Pass one with --otp, or this will ask."
  echo "   Codes rotate every ~30s, so it re-asks whenever one expires."
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

for pkg in $PACKAGES; do
  echo "------------------------------------------------------------"
  echo "🔐 Configuring OIDC trust for $pkg..."
  echo "  🔹 Publish workflow ($WORKFLOW) — covers stable and canary..."
  if ! trust_call "$pkg" "$WORKFLOW"; then
    echo "❌ Failed configuring $pkg ($WORKFLOW)" >&2
    exit 1
  fi
done

echo ""
if [ ${#CONFLICTS[@]} -gt 0 ]; then
  echo "⚠️  Finished, but ${#CONFLICTS[@]} package(s) already had a trusted publisher"
  echo "   that npm would not let this script replace or inspect:"
  for pkg in "${CONFLICTS[@]}"; do
    echo "     - $pkg → https://www.npmjs.com/package/$pkg/access"
  done
  echo ""
  echo "   Check each one names '$WORKFLOW'. If it names an old workflow"
  echo "   (publish-stable.yml, publish-canary.yml), edit it there — publishing"
  echo "   will fail otherwise."
else
  echo "✅ Success! All trusted publisher configurations have been set up on npmjs.com."
fi
