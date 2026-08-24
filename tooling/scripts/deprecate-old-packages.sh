#!/bin/bash
#
# Deprecate every @rebasepro package on npm that this repo no longer publishes.
#
# The scope holds 43 packages; the repo publishes 21. The other 22 are still
# installable and still serve code, and `@rebasepro/server-core@0.9.0` is a
# perfectly working install of a package that is no longer built. Deprecating
# puts a pointer to the replacement in front of anyone who installs one.
#
#   ./tooling/scripts/deprecate-old-packages.sh --dry-run   # audit; writes nothing
#   ./tooling/scripts/deprecate-old-packages.sh             # npm opens a browser once
#
# Deprecation is reversible: `npm deprecate <pkg>@'*' ""` clears it.

set -e

DRY_RUN=false
ASSUME_YES=false

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    -y|--yes) ASSUME_YES=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [-y]"
      echo ""
      echo "Deprecates the @rebasepro packages this repo no longer publishes,"
      echo "each pointing at what replaced it. npm opens a browser for the"
      echo "passkey; no code is needed. Already-deprecated packages are skipped."
      echo ""
      echo "  --dry-run   Read each package's state and print what would change."
      echo "  -y, --yes   Skip the confirmation prompt."
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Removed name -> what replaced it.
#
# This mirrors RENAMED in tooling/scripts/headless-guard/check-package-names.mjs, which
# is the reference. It is duplicated rather than imported because that file runs
# its check at import time and exits. The two must agree: a name here that the
# guard does not know is a name the guard will not stop from creeping back into
# the source.
#
# The trailing entries are not renames. They are early prototypes from Mar-Apr
# 2026 that only ever had canary builds and were abandoned, not superseded, so
# they point at nothing.
# All 22 names in the @rebasepro scope that this repo no longer publishes.
# data_export, data_import and editor are already deprecated; they stay listed so
# this is a complete audit of the scope rather than of the work outstanding.
RENAMED_KEYS=(
  server-core server-postgresql server-mongodb client-postgresql client-firebase
  plugin-data-enhancement schema-inference sdk-generator mcp-server formex core auth
  schema_inference data_enhancement mongodb
  backend cms datatalk data_import_export
  data_export data_import editor
)
renamed_to() {
  case "$1" in
    server-core)              echo "server" ;;
    server-postgresql)        echo "server-postgres" ;;
    server-mongodb)           echo "server-mongo" ;;
    client-postgresql)        echo "client-postgres" ;;
    client-firebase)          echo "firebase" ;;
    plugin-data-enhancement)  echo "plugin-ai" ;;
    schema-inference)         echo "inference" ;;
    sdk-generator)            echo "codegen" ;;
    mcp-server)               echo "mcp" ;;
    formex)                   echo "forms" ;;
    core)                     echo "app" ;;
    auth)                     echo "app" ;;
    # Underscore-era duplicates of the same moves.
    schema_inference)         echo "inference" ;;
    data_enhancement)         echo "plugin-ai" ;;
    mongodb)                  echo "server-mongo" ;;
    # Abandoned, never released: no successor to name.
    backend|cms|datatalk|data_import_export|data_export|data_import|editor) echo "" ;;
    *) echo "" ;;
  esac
}

message_for() {
  local old="$1" new
  new=$(renamed_to "$old")
  if [ -n "$new" ]; then
    echo "Renamed to @rebasepro/$new — install that instead. This package is no longer built or published."
  else
    echo "Never released — an early prototype that is not part of Rebase. See https://www.npmjs.com/org/rebasepro for the current packages."
  fi
}

# Every state read below is a curl against the public registry, so the audit
# needs no npm session at all — --dry-run works logged out. Only the writes need
# auth, and `npm deprecate` runs its own 2FA browser flow when it keeps the
# terminal (which is why its output is not captured either).
if ! $DRY_RUN; then
  if ! npm whoami >/dev/null 2>&1; then
    echo "❌ Not logged in to npm. Run 'npm login'." >&2
    exit 1
  fi
  echo "🔓 npm will open a browser once for your passkey."
  echo ""
fi

echo "🔍 Reading the current state of each package from npm..."
echo ""

TO_DO=()
for old in "${RENAMED_KEYS[@]}"; do
  state=$(curl -sS "https://registry.npmjs.org/@rebasepro%2f$old" 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j;
      try { j = JSON.parse(s) } catch { console.log("unreadable"); return }
      if (j.error) { console.log("absent"); return }
      const vers = Object.values(j.versions || {});
      if (vers.length === 0) { console.log("absent"); return }
      // Every version deprecated is the end state this script is for.
      console.log(vers.every((v) => v.deprecated) ? "done" : "todo");
    })')

  new=$(renamed_to "$old")
  label="@rebasepro/$old"
  case "$state" in
    done)      printf "  ✓ %-38s already deprecated\n" "$label" ;;
    absent)    printf "  ∅ %-38s not on npm\n" "$label" ;;
    todo)      if [ -n "$new" ]; then
                 printf "  → %-38s will point at @rebasepro/%s\n" "$label" "$new"
               else
                 printf "  → %-38s will be marked never-released\n" "$label"
               fi
               TO_DO+=("$old") ;;
    # A read that failed is not a package needing nothing. Say so and stop.
    *)         printf "  ✗ %-38s could not read its state from npm\n" "$label"
               echo "" >&2
               echo "❌ Aborting: npm's state for $label is unknown, and guessing" >&2
               echo "   would either skip a live package or re-deprecate a done one." >&2
               exit 1 ;;
  esac
done

echo ""
if [ ${#TO_DO[@]} -eq 0 ]; then
  echo "✅ Nothing to do — every stale package is already deprecated."
  exit 0
fi

echo "${#TO_DO[@]} package(s) to deprecate."
if $DRY_RUN; then
  echo "🧪 Dry run — nothing was written."
  exit 0
fi

if ! $ASSUME_YES; then
  echo ""
  read -p "Deprecate these ${#TO_DO[@]} package(s)? (y/N) " -r < /dev/tty
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo ""
FAILED=()
for old in "${TO_DO[@]}"; do
  echo "------------------------------------------------------------"
  echo "🚫 @rebasepro/$old"
  echo "   $(message_for "$old")"
  # Not captured: npm must keep the terminal to run its own 2FA. '*' covers
  # every published version, not just latest — an install of any of them should
  # say so.
  if ! npm deprecate "@rebasepro/$old@*" "$(message_for "$old")" < /dev/tty; then
    echo "   ✗ Failed." >&2
    FAILED+=("$old")
  fi
done

echo ""
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "⚠️  ${#FAILED[@]} of ${#TO_DO[@]} failed:"
  for p in "${FAILED[@]}"; do
    echo "     - @rebasepro/$p"
  done
  echo "   Re-running is safe: deprecated packages are skipped."
  exit 1
fi
echo "✅ Deprecated ${#TO_DO[@]} package(s). Re-run with --dry-run to confirm."
