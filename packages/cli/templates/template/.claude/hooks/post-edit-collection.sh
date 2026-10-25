#!/usr/bin/env bash
# Rebase guardrail for Claude Code, installed by `rebase init` and `rebase skills --hooks`.
#
# After Claude Code edits a collection file — under config/collections/, or
# <config>/collections/ when rebase.json moves the backend's config — this runs
# `rebase verify --quiet` and hands any problem straight back to the agent:
# an option that does not exist, a UI widget written outside `admin: { ... }`,
# a collection with no `securityRules`, a migration the collections have moved
# past. Exit code 2 is how a PostToolUse hook talks to the agent: Claude Code
# shows it what this prints on stderr, and the agent fixes it before going on.
#
# Edits anywhere else return at once. Safe to delete; `rebase skills --hooks`
# puts it back.
set -u

input="$(cat)"

# The edited file, from the tool call Claude Code passes on stdin, and the
# backend's config directory, from rebase.json (`apps.<backend>.config`, by
# default `config`) — the runtime and `rebase verify` read the collections from
# there, so a project that moved them is still checked. Node rather than jq:
# every Rebase project has Node, not every machine has jq.
parsed="$(printf '%s' "$input" | node -e '
let raw = "";
process.stdin.on("data", chunk => { raw += chunk; });
process.stdin.on("end", () => {
    let config = "config";
    try {
        const manifest = JSON.parse(require("fs").readFileSync(require("path").join(process.env.CLAUDE_PROJECT_DIR || ".", "rebase.json"), "utf8"));
        const backend = Object.values(manifest.apps || {}).find(app => app && app.type === "backend");
        if (backend && typeof backend.config === "string" && backend.config) config = backend.config.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    } catch {
        // No rebase.json, or one this cannot read: the conventional layout.
    }
    let file = "";
    try {
        const toolInput = JSON.parse(raw).tool_input || {};
        // Forward slashes on every OS: on Windows the path arrives as
        // C:\Users\me\shop\config\collections\posts.ts, which the case below never matched.
        file = String(toolInput.file_path || toolInput.notebook_path || "").replace(/\\/g, "/");
    } catch {
        // Not a tool call this hook understands: nothing to check.
    }
    process.stdout.write(config + "\n" + file);
});
')"
config_dir="${parsed%%$'\n'*}"
file="${parsed#*$'\n'}"

case "$file" in
    */"$config_dir"/collections/* | "$config_dir"/collections/*) ;;
    *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# The project's own CLI, pinned with the rest of its @rebasepro packages.
if [ -x node_modules/.bin/rebase ]; then
    output="$(node_modules/.bin/rebase verify --quiet 2>&1)"
else
    output="$(npx --no rebase verify --quiet 2>&1)"
fi
status=$?

if [ "$status" -eq 0 ]; then
    exit 0
fi

# A project pinned to a CLI from before `rebase verify` answers "Unknown
# command", and one with no CLI installed cannot run it at all. Neither is a
# problem in the collections the agent just edited, so neither blocks the edit:
# say why the check was skipped, and go on.
case "$output" in
    *"Unknown command"*verify*)
        echo "Rebase guardrail skipped: this project's @rebasepro/cli predates \`rebase verify\`. Upgrade it with \`rebase upgrade\` to check collections after each edit." >&2
        exit 0
        ;;
esac
if [ "$status" -eq 127 ]; then
    echo "Rebase guardrail skipped: no rebase CLI found in this project. Install @rebasepro/cli to check collections after each edit." >&2
    exit 0
fi

{
    project_dir="${CLAUDE_PROJECT_DIR:-}"
    echo "rebase verify failed after editing ${file#"${project_dir//\\//}/"}:"
    echo ""
    echo "$output"
    echo ""
    echo "Each problem names its file, the path inside the collection config, and the fix."
    echo "Fix them in ${config_dir}/collections/ before moving on; run \`rebase verify\` for the full report."
} >&2
exit 2
